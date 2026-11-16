/**
 * Horizon Event Stream Listener & Governance Event Indexer
 *
 * 1. Connects to the Stellar Horizon SSE /events endpoint, parses vault
 *    contract events (deposit, harvest), stores them in the database, and
 *    invalidates the relevant Redis cache keys on harvest.
 * 2. Indexes governance lifecycle events emitted by the Aura Vault Soroban contract.
 *
 * Resilience features:
 *  – Automatic reconnect with exponential back-off (cursor preserved)
 *  – Duplicate-event guard (idempotent upsert on event_id)
 *  – Malformed-event logging without crashing
 *  – Skips reverted contract events without storing or invalidating cache
 */

import { EventEmitter } from "events";
import { getWritePool } from "../db.js";

// ---------------------------------------------------------------------------
// Vault Event Listener Types
// ---------------------------------------------------------------------------

export interface RawHorizonEvent {
  id: string;       // SSE id (Horizon paging token)
  event: string;    // SSE event type field
  data: string;     // SSE data field (JSON string)
}

export interface ParsedVaultEvent {
  id: string;
  type: "deposit" | "harvest" | "unknown";
  inSuccessfulContractCall?: boolean;
  caller?: string;
  amount?: number;
  shares?: number;
  timestamp: number;
  raw: RawHorizonEvent;
}

export interface EventStore {
  /** Store an event; return false if it was a duplicate (already stored). */
  save(event: ParsedVaultEvent): Promise<boolean>;
}

export interface CacheInvalidator {
  /** Invalidate all cache keys affected by a harvest event. */
  invalidateOnHarvest(): Promise<void>;
}

export interface Logger {
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
}

export interface HorizonSSESource {
  /** Returns an EventEmitter that emits 'message' and 'error' events. */
  connect(cursor: string): EventEmitter;
}

export interface HorizonListenerOptions {
  reconnectDelayMs?: number;   // initial back-off (default 1_000)
  maxReconnectDelayMs?: number; // max back-off cap (default 30_000)
}

// ---------------------------------------------------------------------------
// Vault Event Parser
// ---------------------------------------------------------------------------

export function parseHorizonEvent(raw: RawHorizonEvent): ParsedVaultEvent {
  const base: ParsedVaultEvent = {
    id: raw.id,
    type: "unknown",
    timestamp: Date.now(),
    raw,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.data);
  } catch {
    return base; // malformed JSON → unknown
  }

  if (typeof parsed !== "object" || parsed === null) return base;
  const obj = parsed as Record<string, unknown>;
  const successfulContractCall =
    obj["inSuccessfulContractCall"] ?? obj["in_successful_contract_call"];
  if (typeof successfulContractCall === "boolean") {
    base.inSuccessfulContractCall = successfulContractCall;
  }

  const eventType = obj["type"] as string | undefined;
  if (eventType === "deposit") {
    return {
      ...base,
      type: "deposit",
      caller: typeof obj["caller"] === "string" ? obj["caller"] : undefined,
      amount: typeof obj["amount"] === "number" ? obj["amount"] : undefined,
      shares: typeof obj["shares"] === "number" ? obj["shares"] : undefined,
    };
  }

  if (eventType === "harvest") {
    return {
      ...base,
      type: "harvest",
      caller: typeof obj["caller"] === "string" ? obj["caller"] : undefined,
      amount: typeof obj["amount"] === "number" ? obj["amount"] : undefined,
    };
  }

  return base;
}

// ---------------------------------------------------------------------------
// Vault Event Listener Factory
// ---------------------------------------------------------------------------

export function createHorizonEventListener(
  source: HorizonSSESource,
  store: EventStore,
  cache: CacheInvalidator,
  logger: Logger,
  opts: HorizonListenerOptions = {}
) {
  const reconnectDelayMs = opts.reconnectDelayMs ?? 1_000;
  const maxReconnectDelayMs = opts.maxReconnectDelayMs ?? 30_000;

  let cursor = "0";
  let running = false;
  let currentDelay = reconnectDelayMs;

  async function handleMessage(raw: RawHorizonEvent): Promise<void> {
    // Advance cursor so reconnects resume from here
    cursor = raw.id;

    const parsed = parseHorizonEvent(raw);

    if (parsed.inSuccessfulContractCall === false) {
      logger.info("Unsuccessful contract event — skipping", { id: raw.id });
      return;
    }

    if (parsed.type === "unknown") {
      logger.warn("Malformed or unknown vault event — skipping", { id: raw.id, data: raw.data });
      return;
    }

    let stored: boolean;
    try {
      stored = await store.save(parsed);
    } catch (err) {
      logger.error("Failed to store event", { id: raw.id, err });
      return;
    }

    if (!stored) {
      logger.info("Duplicate event ignored", { id: raw.id });
      return;
    }

    if (parsed.type === "harvest") {
      try {
        await cache.invalidateOnHarvest();
      } catch (err) {
        logger.error("Cache invalidation failed after harvest", { id: raw.id, err });
      }
    }
  }

  function connect(): void {
    const emitter = source.connect(cursor);

    emitter.on("message", (raw: RawHorizonEvent) => {
      handleMessage(raw).catch((err) =>
        logger.error("Unhandled error in handleMessage", { err })
      );
    });

    emitter.on("error", (err: Error) => {
      logger.warn("SSE stream error — scheduling reconnect", { cursor, err: err.message });
      scheduleReconnect();
    });
  }

  function scheduleReconnect(): void {
    if (!running) return;
    setTimeout(() => {
      currentDelay = Math.min(currentDelay * 2, maxReconnectDelayMs);
      connect();
    }, currentDelay);
  }

  return {
    start() {
      running = true;
      currentDelay = reconnectDelayMs;
      connect();
    },
    stop() {
      running = false;
    },
    getCursor() {
      return cursor;
    },
  };
}

// ---------------------------------------------------------------------------
// Governance Event Types
// ---------------------------------------------------------------------------

export type GovernanceEventName =
  | "proposal_created"
  | "vote_cast"
  | "timelock_started"
  | "proposal_executed"
  | "proposal_expired";

export interface HorizonEventEnvelope {
  contractId: string;
  /** Decoded Soroban topics, with the event name in the first position. */
  topics: unknown[];
  /** Decoded Soroban event value. */
  value: unknown;
  ledgerTimestamp?: number;
}

export interface ParsedGovernanceEvent {
  name: GovernanceEventName;
  contractId: string;
  proposalId: string;
  proposer?: string;
  voter?: string;
  voteCount?: number;
  expiresAt?: number;
  ledgerTimestamp?: number;
}

function scalar(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return undefined;
}

function tuple(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Normalize the lifecycle event topics and data emitted by governance.rs. */
export function parseGovernanceEvent(event: HorizonEventEnvelope): ParsedGovernanceEvent | null {
  const name = scalar(event.topics[0]) as GovernanceEventName | undefined;
  const supported: GovernanceEventName[] = [
    "proposal_created", "vote_cast", "timelock_started", "proposal_executed", "proposal_expired",
  ];
  if (!name || !supported.includes(name)) return null;

  const proposalId = scalar(event.topics[1]);
  if (!proposalId || !/^\d+$/.test(proposalId)) return null;
  const data = tuple(event.value);
  const parsed: ParsedGovernanceEvent = {
    name,
    contractId: event.contractId,
    proposalId,
    ledgerTimestamp: event.ledgerTimestamp,
  };
  if (name === "proposal_created") {
    parsed.proposer = scalar(data[0]);
    const expires = scalar(data[1]);
    if (expires && /^\d+$/.test(expires)) parsed.expiresAt = Number(expires);
  }
  if (name === "vote_cast") {
    parsed.voter = scalar(data[0]);
    const count = scalar(data[1]);
    if (count && /^\d+$/.test(count)) parsed.voteCount = Number(count);
  }
  return parsed;
}

/** Persist one decoded event; repeated Horizon deliveries are idempotent. */
export async function handleHorizonGovernanceEvent(
  event: HorizonEventEnvelope,
): Promise<boolean> {
  const parsed = parseGovernanceEvent(event);
  if (!parsed) return false;

  const pool = getWritePool();
  const expiresAt = parsed.expiresAt ? new Date(parsed.expiresAt * 1000) : null;
  if (parsed.name === "proposal_created") {
    await pool.query(
      `INSERT INTO governance_proposals (contract_id, proposal_id, proposer, status, expires_at)
       VALUES ($1, $2, $3, 'created', $4)
       ON CONFLICT (contract_id, proposal_id) DO UPDATE SET
         proposer = COALESCE(EXCLUDED.proposer, governance_proposals.proposer),
         expires_at = COALESCE(EXCLUDED.expires_at, governance_proposals.expires_at),
         updated_at = NOW()`,
      [parsed.contractId, parsed.proposalId, parsed.proposer ?? null, expiresAt],
    );
    return true;
  }

  if (parsed.name === "vote_cast") {
    await pool.query(
      `UPDATE governance_proposals SET status = 'voting', updated_at = NOW()
       WHERE contract_id = $1 AND proposal_id = $2 AND status = 'created'`,
      [parsed.contractId, parsed.proposalId],
    );
    if (parsed.voter) {
      await pool.query(
        `INSERT INTO governance_proposal_votes (contract_id, proposal_id, voter, vote_count)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (contract_id, proposal_id, voter) DO UPDATE SET vote_count = EXCLUDED.vote_count`,
        [parsed.contractId, parsed.proposalId, parsed.voter, parsed.voteCount ?? null],
      );
    }
    return true;
  }

  const transition = parsed.name === "timelock_started"
    ? "timelock"
    : parsed.name === "proposal_executed"
      ? "executed"
      : "expired";
  await pool.query(
    `UPDATE governance_proposals SET status = $3, updated_at = NOW(),
       executed_at = CASE WHEN $3 = 'executed' THEN COALESCE($4, NOW()) ELSE executed_at END,
       expired_at = CASE WHEN $3 = 'expired' THEN COALESCE($4, NOW()) ELSE expired_at END
     WHERE contract_id = $1 AND proposal_id = $2`,
    [parsed.contractId, parsed.proposalId, transition,
      parsed.ledgerTimestamp ? new Date(parsed.ledgerTimestamp * 1000) : null],
  );
  return true;
}
