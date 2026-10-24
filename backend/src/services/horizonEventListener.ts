/**
 * Horizon Event Stream Listener
 *
 * Connects to the Stellar Horizon SSE /events endpoint, parses vault
 * contract events (deposit, harvest), stores them in the database, and
 * invalidates the relevant Redis cache keys on harvest.
 *
 * Resilience features:
 *  – Automatic reconnect with exponential back-off (cursor preserved)
 *  – Duplicate-event guard (idempotent upsert on event_id)
 *  – Malformed-event logging without crashing
 */

import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Types
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
// Parser
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
      caller: obj["caller"] as string | undefined,
      amount: Number(obj["amount"]),
      shares: Number(obj["shares"]),
    };
  }
  if (eventType === "harvest") {
    return {
      ...base,
      type: "harvest",
      caller: obj["caller"] as string | undefined,
      amount: Number(obj["amount"]),
    };
  }

  return base;
}

// ---------------------------------------------------------------------------
// Listener
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
