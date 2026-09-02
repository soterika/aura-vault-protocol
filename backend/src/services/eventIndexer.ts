/**
 * Optimised Event Indexer for Aura Vault
 *
 * Processes on-chain Soroban events (deposit, withdraw, harvest, pause,
 * unpause, suspicious) during high-volume harvest periods.
 *
 * Optimisations implemented:
 *  1. Batch database inserts — events are buffered and flushed in batches
 *     of BATCH_SIZE (100) to minimise round-trips.
 *  2. Parallel processing — independent event types are processed
 *     concurrently using Promise.allSettled().
 *  3. Indexer lag metric — the time between the event's on-chain ledger
 *     timestamp and its insertion time is tracked as a Prometheus gauge
 *     (indexer_lag_seconds).  An alert fires when lag > 10 s.
 *
 * Architecture:
 *  ┌──────────────┐   push    ┌──────────────┐   flush(batch)  ┌─────┐
 *  │ Horizon/RPC  │ ────────> │  EventBuffer │ ──────────────> │  DB │
 *  └──────────────┘           └──────────────┘                 └─────┘
 *                                     │ lag sample
 *                                     ▼
 *                             ┌──────────────────┐
 *                             │  IndexerMetrics   │
 *                             └──────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All event types emitted by the AuraVault Soroban contract. */
export type VaultEventType =
  | "deposit"
  | "withdraw"
  | "harvest"
  | "pause"
  | "unpause"
  | "suspicious"
  | "upgrade";

export interface VaultEvent {
  /** Unique on-chain event identifier (ledger_seq:tx_index:op_index:event_index) */
  id: string;
  /** Ledger sequence number where the event was recorded */
  ledgerSequence: number;
  /**
   * Unix timestamp (seconds) when the ledger was closed on-chain.
   * Used to compute indexer lag.
   */
  ledgerTimestamp: number;
  /** Event type */
  type: VaultEventType;
  /** Contract address that emitted the event */
  contractId: string;
  /** Caller / relevant address for the event */
  callerAddress: string;
  /** Numeric value associated with the event (amount, shares, etc.) */
  amount: bigint;
  /** Raw event payload for debugging */
  rawPayload: unknown;
}

/** Result of flushing a batch to the (mock) database. */
export interface FlushResult {
  flushed: number;
  lagSamples: number[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum events per batch insert.  Matches the acceptance criterion (100). */
export const BATCH_SIZE = 100;

/** Maximum lag (seconds) before the alert threshold is breached. */
export const LAG_ALERT_THRESHOLD_SECONDS = 10;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * In-memory lag samples (seconds).  Consumers (Prometheus endpoint, tests)
 * read from this store.
 */
const lagSamples: number[] = [];

/** Maximum number of lag samples retained in memory. */
const MAX_LAG_SAMPLES = 1000;

/** Current lag value for the Prometheus gauge (last flush average). */
let currentLagSeconds = 0;

/** Total events indexed since process start. */
let totalEventsIndexed = 0;

/** Total batches flushed since process start. */
let totalBatchesFlushed = 0;

export function getIndexerMetrics() {
  return {
    currentLagSeconds,
    totalEventsIndexed,
    totalBatchesFlushed,
    lagSamples: [...lagSamples],
  };
}

export function resetIndexerMetrics(): void {
  lagSamples.length = 0;
  currentLagSeconds = 0;
  totalEventsIndexed = 0;
  totalBatchesFlushed = 0;
}

function recordLag(lagSeconds: number): void {
  if (lagSamples.length >= MAX_LAG_SAMPLES) lagSamples.shift();
  lagSamples.push(lagSeconds);
  currentLagSeconds = lagSeconds;
}

// ---------------------------------------------------------------------------
// Database adapter (injectable for testing)
// ---------------------------------------------------------------------------

/**
 * Minimal database adapter interface.
 * Production code injects a real Postgres client; tests inject a mock.
 */
export interface DbAdapter {
  /**
   * Batch-inserts events into the vault_events table.
   * Must be atomic: either all events in the batch are inserted or none.
   */
  batchInsert(events: VaultEvent[]): Promise<void>;
}

/**
 * No-op adapter used when no real database is configured.
 * Logs events to stdout so they are not silently dropped.
 */
export class NoopDbAdapter implements DbAdapter {
  async batchInsert(events: VaultEvent[]): Promise<void> {
    console.log(
      `[event-indexer] noop-db: would insert ${events.length} event(s)`
    );
  }
}

// ---------------------------------------------------------------------------
// Event Buffer
// ---------------------------------------------------------------------------

/**
 * Buffers incoming events and flushes them in batches.
 *
 * Thread-safety note: Node.js runs on a single event-loop thread, so the
 * in-memory buffer requires no explicit locking.
 */
export class EventBuffer {
  private readonly buffer: VaultEvent[] = [];
  private readonly db: DbAdapter;
  private readonly batchSize: number;

  constructor(db: DbAdapter, batchSize = BATCH_SIZE) {
    this.db = db;
    this.batchSize = batchSize;
  }

  /**
   * Adds an event to the buffer.  If the buffer reaches `batchSize`,
   * a flush is triggered automatically.
   */
  async push(event: VaultEvent): Promise<void> {
    this.buffer.push(event);
    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  /**
   * Pushes a batch of events, triggering one or more flushes as needed.
   */
  async pushMany(events: VaultEvent[]): Promise<void> {
    for (const event of events) {
      await this.push(event);
    }
  }

  /**
   * Flushes all buffered events to the database in one batch insert.
   * Returns a FlushResult so callers can react to errors.
   */
  async flush(): Promise<FlushResult> {
    if (this.buffer.length === 0) {
      return { flushed: 0, lagSamples: [], errors: [] };
    }

    const batch = this.buffer.splice(0, this.batchSize);
    const now = Date.now() / 1000; // seconds
    const batchLagSamples: number[] = batch.map((e) =>
      Math.max(0, now - e.ledgerTimestamp)
    );

    const errors: string[] = [];
    try {
      await this.db.batchInsert(batch);
      totalEventsIndexed += batch.length;
      totalBatchesFlushed += 1;
    } catch (err) {
      errors.push(String(err));
      console.error(`[event-indexer] batch insert failed:`, err);
    }

    // Record average lag for this batch
    const avgLag =
      batchLagSamples.reduce((a, b) => a + b, 0) / batchLagSamples.length;
    recordLag(avgLag);

    return { flushed: batch.length, lagSamples: batchLagSamples, errors };
  }

  /** Returns the number of events currently in the buffer (not yet flushed). */
  get pendingCount(): number {
    return this.buffer.length;
  }
}

// ---------------------------------------------------------------------------
// Parallel event processor
// ---------------------------------------------------------------------------

/**
 * Groups events by type and processes each group concurrently.
 *
 * Independent event types (e.g. "deposit" vs "harvest") have no
 * interdependencies, so they can be flushed in parallel.
 *
 * Returns a map of type → aggregated FlushResult (summed across all
 * auto-flushes and the final explicit flush).
 */
export async function processEventsParallel(
  events: VaultEvent[],
  db: DbAdapter,
  batchSize = BATCH_SIZE
): Promise<Map<VaultEventType, FlushResult>> {
  // Group events by type
  const groups = new Map<VaultEventType, VaultEvent[]>();
  for (const event of events) {
    const group = groups.get(event.type) ?? [];
    group.push(event);
    groups.set(event.type, group);
  }

  // Process each group concurrently
  const entries = [...groups.entries()];
  const results = await Promise.allSettled(
    entries.map(async ([type, typeEvents]) => {
      // Accumulate results across all auto-flushes by intercepting the db adapter
      const accFlushed = { flushed: 0, lagSamples: [] as number[], errors: [] as string[] };
      const trackingDb: DbAdapter = {
        async batchInsert(batch: VaultEvent[]): Promise<void> {
          const now = Date.now() / 1000;
          const lagSamples = batch.map((e) => Math.max(0, now - e.ledgerTimestamp));
          accFlushed.flushed += batch.length;
          accFlushed.lagSamples.push(...lagSamples);
          try {
            await db.batchInsert(batch);
          } catch (err) {
            accFlushed.errors.push(String(err));
            throw err;
          }
        },
      };

      const buf = new EventBuffer(trackingDb, batchSize);
      await buf.pushMany(typeEvents);
      await buf.flush(); // flush any remaining events in the buffer

      return { type, result: accFlushed };
    })
  );

  const summary = new Map<VaultEventType, FlushResult>();
  for (const settled of results) {
    if (settled.status === "fulfilled") {
      summary.set(settled.value.type, settled.value.result);
    } else {
      console.error(
        "[event-indexer] parallel processor error:",
        settled.reason
      );
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Prometheus text rendering
// ---------------------------------------------------------------------------

/**
 * Renders the indexer Prometheus metrics in text exposition format.
 *
 * Metrics exposed:
 *   indexer_lag_seconds          — lag of the last flush (gauge)
 *   indexer_events_total         — cumulative events indexed (counter)
 *   indexer_batches_total        — cumulative batches flushed (counter)
 */
export function renderIndexerMetricsText(): string {
  const lines: string[] = [
    "# HELP indexer_lag_seconds Seconds between on-chain event and database insertion",
    "# TYPE indexer_lag_seconds gauge",
    `indexer_lag_seconds ${currentLagSeconds.toFixed(3)}`,
    "",
    "# HELP indexer_events_total Total vault events indexed",
    "# TYPE indexer_events_total counter",
    `indexer_events_total ${totalEventsIndexed}`,
    "",
    "# HELP indexer_batches_total Total batch inserts executed",
    "# TYPE indexer_batches_total counter",
    `indexer_batches_total ${totalBatchesFlushed}`,
  ];
  return lines.join("\n") + "\n";
}
