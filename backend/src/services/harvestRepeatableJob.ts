/**
 * Harvest Repeatable Job — Issue #944
 *
 * Registers a BullMQ repeatable job that triggers vault harvest on a cron
 * schedule derived from HARVEST_INTERVAL_HOURS (default: every 6 hours).
 *
 * Job responsibilities:
 *   1. Reads the keeper private key from AWS Secrets Manager
 *   2. Signs and submits the harvest transaction to Stellar via the Horizon SDK
 *   3. Records the harvest attempt in the contract_events table
 *   4. On failure: retries up to 3 times, then increments a Prometheus counter
 *      that feeds the HarvestJobFailed alert
 *
 * Configurable env vars:
 *   HARVEST_INTERVAL_HOURS   — interval between harvests (default: 6)
 *   HARVEST_KEEPER_SECRET_ID — AWS Secrets Manager secret name
 *   VAULT_CONTRACT_ID        — Soroban vault contract address
 *   HORIZON_URL              — Stellar Horizon API base URL
 *   REDIS_URL                — Redis connection string for BullMQ
 */

import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import { Registry, Counter, collectDefaultMetrics } from "prom-client";
import { logger } from "../logger.js";
import { getKeeperKeypair } from "./keeperKeypair.js";
import { getWritePool } from "../db.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Converts HARVEST_INTERVAL_HOURS to a cron expression. */
function buildCronExpression(intervalHours: number): string {
  if (intervalHours <= 0 || !Number.isFinite(intervalHours)) {
    throw new Error(
      `[HarvestRepeatableJob] HARVEST_INTERVAL_HOURS must be a positive number, got: ${intervalHours}`
    );
  }
  // For intervals that divide evenly into 24: "0 */N * * *"
  // For arbitrary values, fall back to every N hours from midnight.
  return `0 */${intervalHours} * * *`;
}

const HARVEST_INTERVAL_HOURS = (() => {
  const raw = process.env.HARVEST_INTERVAL_HOURS;
  if (!raw) return 6;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[HarvestRepeatableJob] HARVEST_INTERVAL_HOURS must be a positive integer, got: ${JSON.stringify(raw)}`);
  }
  return n;
})();

const HARVEST_CRON = buildCronExpression(HARVEST_INTERVAL_HOURS);

const VAULT_CONTRACT_ID = process.env.VAULT_CONTRACT_ID ?? "";
const KEEPER_SECRET_ID = process.env.HARVEST_KEEPER_SECRET_ID ?? "aura-vault/keeper-keypair";
const HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const MAX_RETRIES = 3;
const QUEUE_NAME = "harvest-repeatable";

// ---------------------------------------------------------------------------
// Redis connection (BullMQ)
// ---------------------------------------------------------------------------

function buildRedisConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  // BullMQ expects { host, port } or a full URL via `url` property
  return { url } as ConnectionOptions & { url: string };
}

// ---------------------------------------------------------------------------
// Prometheus metrics
// ---------------------------------------------------------------------------

/** Isolated registry so we can export metrics without polluting the default. */
export const harvestJobRegistry = new Registry();

export const harvestJobSuccessCounter = new Counter({
  name: "harvest_job_success_total",
  help: "Total number of successful BullMQ harvest jobs",
  registers: [harvestJobRegistry],
});

export const harvestJobFailureCounter = new Counter({
  name: "harvest_job_failure_total",
  help: "Total number of BullMQ harvest jobs that failed all retries",
  registers: [harvestJobRegistry],
});

export const harvestJobRetriesCounter = new Counter({
  name: "harvest_job_retries_total",
  help: "Total number of BullMQ harvest job retry attempts",
  registers: [harvestJobRegistry],
});

// ---------------------------------------------------------------------------
// Job data types
// ---------------------------------------------------------------------------

export interface HarvestJobPayload {
  vaultContractId: string;
  triggeredAt: string;
  correlationId: string;
}

// ---------------------------------------------------------------------------
// Harvest executor
// ---------------------------------------------------------------------------

/**
 * Signs and submits the harvest transaction to Stellar.
 *
 * Delegates to @stellar/stellar-sdk for transaction construction.
 * Records the attempt in contract_events regardless of outcome.
 */
async function executeHarvest(job: Job<HarvestJobPayload>): Promise<string> {
  const { vaultContractId, triggeredAt, correlationId } = job.data;

  logger.info("[HarvestRepeatableJob] Executing harvest", {
    jobId: job.id,
    attempt: (job.attemptsMade ?? 0) + 1,
    vaultContractId,
    triggeredAt,
    correlationId,
  });

  // 1. Load keeper keypair from AWS Secrets Manager (cached)
  const keypair = await getKeeperKeypair(KEEPER_SECRET_ID);

  // 2. Submit harvest transaction to Stellar
  let txHash: string;
  try {
    const { Keypair, SorobanRpc, Contract, TransactionBuilder, Networks, BASE_FEE, xdr } =
      await import("@stellar/stellar-sdk");

    const keeperKeypair = Keypair.fromSecret(keypair.secretKey);
    const server = new SorobanRpc.Server(HORIZON_URL, { allowHttp: HORIZON_URL.startsWith("http://") });

    const account = await server.getAccount(keeperKeypair.publicKey());
    const contract = new Contract(vaultContractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: HORIZON_URL.includes("testnet")
        ? Networks.TESTNET
        : Networks.PUBLIC,
    })
      .addOperation(
        contract.call("harvest", ...[])
      )
      .setTimeout(30)
      .build();

    const preparedTx = await server.prepareTransaction(tx);
    preparedTx.sign(keeperKeypair);

    const result = await server.sendTransaction(preparedTx);
    txHash = result.hash;

    logger.info("[HarvestRepeatableJob] Harvest transaction submitted", {
      jobId: job.id,
      txHash,
      vaultContractId,
      correlationId,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    // Increment retry counter on non-final attempts
    if ((job.attemptsMade ?? 0) + 1 < MAX_RETRIES) {
      harvestJobRetriesCounter.inc();
    }

    logger.warn("[HarvestRepeatableJob] Harvest transaction failed", {
      jobId: job.id,
      attempt: (job.attemptsMade ?? 0) + 1,
      error,
      vaultContractId,
      correlationId,
    });

    // Record failed attempt in contract_events
    await recordContractEvent({
      vaultContractId,
      triggeredAt,
      correlationId,
      status: "failed",
      error,
      txHash: null,
    });

    throw err; // Let BullMQ handle retry
  }

  // 3. Record successful harvest in contract_events
  await recordContractEvent({
    vaultContractId,
    triggeredAt,
    correlationId,
    status: "success",
    error: null,
    txHash,
  });

  harvestJobSuccessCounter.inc();

  return txHash;
}

// ---------------------------------------------------------------------------
// contract_events persistence
// ---------------------------------------------------------------------------

interface ContractEventRecord {
  vaultContractId: string;
  triggeredAt: string;
  correlationId: string;
  status: "success" | "failed";
  txHash: string | null;
  error: string | null;
}

async function recordContractEvent(rec: ContractEventRecord): Promise<void> {
  try {
    const db = getWritePool();
    await db.query(
      `INSERT INTO contract_events
         (event_type, contract_id, tx_hash, data, occurred_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [
        "harvest",
        rec.vaultContractId,
        rec.txHash,
        JSON.stringify({
          status: rec.status,
          correlationId: rec.correlationId,
          triggeredAt: rec.triggeredAt,
          ...(rec.error ? { error: rec.error } : {}),
        }),
        new Date(rec.triggeredAt).toISOString(),
      ]
    );
  } catch (err) {
    // Non-fatal — log and continue; don't let DB errors abort the harvest result
    logger.error("[HarvestRepeatableJob] Failed to record contract event", {
      err,
      correlationId: rec.correlationId,
    });
  }
}

// ---------------------------------------------------------------------------
// BullMQ Queue and Worker
// ---------------------------------------------------------------------------

let harvestQueue: Queue<HarvestJobPayload> | null = null;
let harvestWorker: Worker<HarvestJobPayload, string> | null = null;

/**
 * Start the BullMQ harvest queue and register the repeatable job.
 *
 * Safe to call multiple times — idempotent on the queue/worker.
 */
export async function startHarvestRepeatableJob(): Promise<void> {
  if (harvestQueue !== null) {
    logger.warn("[HarvestRepeatableJob] Already started — ignoring duplicate start()");
    return;
  }

  const connection = buildRedisConnection();

  // 1. Create queue
  harvestQueue = new Queue<HarvestJobPayload>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: MAX_RETRIES,
      backoff: {
        type: "exponential",
        delay: 5_000,          // 5s, 10s, 20s
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  });

  // 2. Register (or update) the repeatable job
  await harvestQueue.add(
    "auto-harvest",
    {
      vaultContractId: VAULT_CONTRACT_ID,
      triggeredAt: new Date().toISOString(),
      correlationId: "scheduled",
    },
    {
      repeat: { pattern: HARVEST_CRON },
    }
  );

  logger.info("[HarvestRepeatableJob] Repeatable job registered", {
    cron: HARVEST_CRON,
    intervalHours: HARVEST_INTERVAL_HOURS,
    vaultContractId: VAULT_CONTRACT_ID,
  });

  // 3. Create worker
  harvestWorker = new Worker<HarvestJobPayload, string>(
    QUEUE_NAME,
    async (job) => {
      // Stamp fresh triggeredAt and a new correlationId on each invocation
      job.data.triggeredAt = new Date().toISOString();
      job.data.correlationId = `harvest-${job.id ?? "unknown"}-${Date.now()}`;
      return executeHarvest(job);
    },
    {
      connection,
      concurrency: 1,   // only one harvest at a time
    }
  );

  // 4. Worker lifecycle events
  harvestWorker.on("completed", (job, result) => {
    logger.info("[HarvestRepeatableJob] Job completed", {
      jobId: job.id,
      result,
    });
  });

  harvestWorker.on("failed", (job, err) => {
    const isFinal = (job?.attemptsMade ?? 0) >= MAX_RETRIES;

    if (isFinal) {
      harvestJobFailureCounter.inc();
      logger.error("[HarvestRepeatableJob] Job exhausted all retries — Prometheus alert threshold may trigger", {
        jobId: job?.id,
        error: err.message,
      });
    } else {
      logger.warn("[HarvestRepeatableJob] Job failed, will retry", {
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        error: err.message,
      });
    }
  });

  harvestWorker.on("error", (err) => {
    logger.error("[HarvestRepeatableJob] Worker error", { error: err.message });
  });

  logger.info("[HarvestRepeatableJob] Worker started", { queue: QUEUE_NAME });
}

/**
 * Gracefully shut down the BullMQ worker and queue connection.
 */
export async function stopHarvestRepeatableJob(): Promise<void> {
  if (harvestWorker) {
    await harvestWorker.close();
    harvestWorker = null;
  }
  if (harvestQueue) {
    await harvestQueue.close();
    harvestQueue = null;
  }
  logger.info("[HarvestRepeatableJob] Stopped");
}

/** Expose the underlying queue for testing / admin introspection. */
export function getHarvestQueue(): Queue<HarvestJobPayload> | null {
  return harvestQueue;
}

/** Expose the cron string derived from HARVEST_INTERVAL_HOURS (for tests). */
export { HARVEST_CRON, HARVEST_INTERVAL_HOURS, buildCronExpression };
