import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getReadPool } from "../db.js";
import { getRedis } from "../redis.js";
import { enqueueEmail } from "./emailQueue.js";
import { logger } from "../logger.js";

const EXPORT_QUEUE = "gdpr:export:queue";
const EXPORT_TTL_SECONDS = 48 * 60 * 60;
const RATE_LIMIT_SECONDS = 24 * 60 * 60;

interface ExportQueueJob {
  id: string;
  walletAddress: string;
  email: string;
}

interface ExportJobRecord {
  walletAddress: string;
  status: "queued" | "processing" | "ready" | "failed";
  createdAt: string;
  expiresAt: string;
}

export class ExportRateLimitError extends Error {}
export class ExportEmailRequiredError extends Error {}

const jobKey = (id: string) => `gdpr:export:job:${id}`;
const dataKey = (id: string) => `gdpr:export:data:${id}`;
const tokenKey = (id: string) => `gdpr:export:token:${id}`;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requestUserExport(
  walletAddress: string
): Promise<{ id: string; status: "queued"; expiresAt: string }> {
  const pool = getReadPool();
  const { rows } = await pool.query<{ email: string }>(
    `SELECT email
       FROM alert_subscriptions
      WHERE wallet_address = $1 AND active = TRUE
      ORDER BY updated_at DESC
      LIMIT 1`,
    [walletAddress]
  );
  const email = rows[0]?.email;
  if (!email) throw new ExportEmailRequiredError();

  const redis = getRedis();
  const id = randomBytes(18).toString("hex");
  const rateKey = `gdpr:export:rate:${tokenHash(walletAddress)}`;
  const allowed = await redis.set(rateKey, id, "EX", RATE_LIMIT_SECONDS, "NX");
  if (allowed !== "OK") throw new ExportRateLimitError();

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + EXPORT_TTL_SECONDS * 1000);
  const job: ExportJobRecord = {
    walletAddress,
    status: "queued",
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  try {
    await redis.set(jobKey(id), JSON.stringify(job), "EX", EXPORT_TTL_SECONDS);
    await redis.lpush(
      EXPORT_QUEUE,
      JSON.stringify({ id, walletAddress, email } satisfies ExportQueueJob)
    );
  } catch (err) {
    if ((await redis.get(rateKey)) === id) await redis.del(rateKey);
    await redis.del(jobKey(id));
    throw err;
  }

  return { id, status: "queued", expiresAt: expiresAt.toISOString() };
}

async function buildExport(walletAddress: string): Promise<Record<string, unknown>> {
  const pool = getReadPool();
  const [transactions, preferences, auditLogs, referrals] = await Promise.all([
    pool.query(
      `SELECT id, tx_type, wallet_address, amount, status, attempts, result,
              error, meta, created_at, updated_at
         FROM transaction_jobs
        WHERE wallet_address = $1
        ORDER BY created_at DESC`,
      [walletAddress]
    ),
    pool.query(
      `SELECT id, wallet_address, email, threshold, event_types, active,
              created_at, updated_at
         FROM alert_subscriptions
        WHERE wallet_address = $1
        ORDER BY created_at`,
      [walletAddress]
    ),
    pool.query(
      `SELECT id, actor, entity_type, entity_id, action, metadata, created_at
         FROM audit_logs
        WHERE actor = $1 OR entity_id = $1
        ORDER BY created_at DESC`,
      [walletAddress]
    ),
    pool.query(
      `SELECT id, referrer_address, referred_address, registered_at,
              deposit_volume, pending_reward, claimed_reward
         FROM referrals
        WHERE referrer_address = $1 OR referred_address = $1
        ORDER BY registered_at DESC`,
      [walletAddress]
    ),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    walletAddress,
    transactions: transactions.rows,
    preferences: preferences.rows,
    auditLogs: auditLogs.rows,
    referrals: referrals.rows,
  };
}

async function processExport(job: ExportQueueJob): Promise<void> {
  const redis = getRedis();
  const rawJob = await redis.get(jobKey(job.id));
  if (!rawJob) return;

  const record = JSON.parse(rawJob) as ExportJobRecord;
  record.status = "processing";
  await redis.set(jobKey(job.id), JSON.stringify(record), "EX", EXPORT_TTL_SECONDS);

  try {
    const data = await buildExport(job.walletAddress);
    const token = randomBytes(32).toString("base64url");
    record.expiresAt = new Date(
      Date.now() + EXPORT_TTL_SECONDS * 1000
    ).toISOString();
    await redis.set(dataKey(job.id), JSON.stringify(data), "EX", EXPORT_TTL_SECONDS);
    await redis.set(tokenKey(job.id), tokenHash(token), "EX", EXPORT_TTL_SECONDS);

    const baseUrl = (process.env.APP_BASE_URL ?? "https://auravault.io").replace(/\/$/, "");
    await enqueueEmail({
      to: job.email,
      template: "gdpr-data-export-ready",
      data: {
        userName: job.walletAddress.slice(0, 8),
        downloadUrl: `${baseUrl}/api/users/export/${job.id}/download?token=${encodeURIComponent(token)}`,
        expiresAt: record.expiresAt,
      },
      priority: "high",
    });

    record.status = "ready";
    await redis.set(jobKey(job.id), JSON.stringify(record), "EX", EXPORT_TTL_SECONDS);
  } catch (err) {
    record.status = "failed";
    await redis.set(jobKey(job.id), JSON.stringify(record), "EX", EXPORT_TTL_SECONDS);
    logger.error({ err, exportId: job.id }, "GDPR data export failed");
  }
}

export async function downloadUserExport(
  id: string,
  token: string
): Promise<{ status: "pending" | "failed" | "expired" | "ready"; data?: string }>{
  const redis = getRedis();
  const [rawJob, storedHash, data] = await Promise.all([
    redis.get(jobKey(id)),
    redis.get(tokenKey(id)),
    redis.get(dataKey(id)),
  ]);
  if (!rawJob) return { status: "expired" };

  const job = JSON.parse(rawJob) as ExportJobRecord;
  if (job.status === "failed") return { status: "failed" };
  if (job.status !== "ready") return { status: "pending" };
  if (!storedHash || !data) return { status: "expired" };

  const expected = Buffer.from(storedHash);
  const actual = Buffer.from(tokenHash(token));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { status: "expired" };
  }
  return { status: "ready", data };
}

let workerRunning = false;

async function exportWorkerLoop(): Promise<void> {
  const redis = getRedis();
  while (workerRunning) {
    try {
      const queued = await redis.brpop(EXPORT_QUEUE, 2);
      if (!queued) continue;
      await processExport(JSON.parse(queued[1]) as ExportQueueJob);
    } catch (err) {
      logger.error({ err }, "GDPR export worker failed to process a job");
      await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

export function startUserExportWorker(): void {
  if (workerRunning) return;
  workerRunning = true;
  void exportWorkerLoop().catch((err) => {
    logger.error({ err }, "GDPR export worker stopped unexpectedly");
    workerRunning = false;
  });
}

export function stopUserExportWorker(): void {
  workerRunning = false;
}