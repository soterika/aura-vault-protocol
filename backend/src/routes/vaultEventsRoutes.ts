/**
 * Vault Events SSE Route — Issue #1271
 *
 * GET /api/v1/vault/events
 * Accept: text/event-stream
 *
 * Streams real-time vault events (deposit, withdraw, harvest) to subscribed
 * clients using Server-Sent Events.
 *
 * Protocol:
 *   - Content-Type: text/event-stream
 *   - Heartbeat comment every 30 s: ": ping"
 *   - Named events:          event: vault_update
 *   - Missed event replay:   client sends Last-Event-ID header → up to 100 events replayed
 *   - Connection limit:      MAX_SSE_CONNECTIONS (default 1000), configurable via env
 *   - 429 when at capacity
 *
 * Event format:
 *   event: vault_update
 *   id: <event-id>
 *   data: {"type":"harvest","amount":"50000","newTotalAssets":"1050000","timestamp":"..."}
 *
 * Closes #1271
 */

import { Router, type Request, type Response } from "express";
import { getReadPool } from "../db.js";
import { logger } from "../logger.js";
import { errorResponse } from "../dto/ApiResponseDto.js";

export const vaultEventsRouter = Router();

// ── Configuration ─────────────────────────────────────────────────────────────

const MAX_SSE_CONNECTIONS = parseInt(
  process.env.MAX_SSE_CONNECTIONS ?? "1000",
  10,
);
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 s keepalive comment
const REPLAY_LIMIT = 100; // max missed events to replay on reconnect

// ── In-process client registry ────────────────────────────────────────────────

interface SseClient {
  id: string;
  res: Response;
}

const clients = new Set<SseClient>();
let clientIdSeq = 0;

// ── Public fan-out function ───────────────────────────────────────────────────

/**
 * Push a vault_update event to all connected SSE clients.
 * Called by the horizonEventListener / eventIndexer whenever a new vault
 * event is written to the vault_events table.
 */
export function broadcastVaultEvent(event: VaultUpdatePayload, id: string): void {
  const payload = buildEventFrame("vault_update", event, id);
  for (const client of clients) {
    try {
      client.res.write(payload);
    } catch {
      // Client disconnected mid-write; the "close" handler will remove it.
    }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VaultUpdatePayload {
  type: "deposit" | "withdraw" | "harvest" | "pause" | "unpause" | "suspicious" | "upgrade";
  amount?: string;
  newTotalAssets?: string;
  callerAddress?: string;
  contractId?: string;
  ledgerSequence?: number;
  timestamp: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildEventFrame(
  eventName: string,
  data: unknown,
  id?: string,
): string {
  const idLine = id ? `id: ${id}\n` : "";
  return `event: ${eventName}\n${idLine}data: ${JSON.stringify(data)}\n\n`;
}

function buildCommentFrame(comment: string): string {
  return `: ${comment}\n\n`;
}

// ── Heartbeat timer ───────────────────────────────────────────────────────────

// Send a ": ping" comment every 30 s to prevent proxy/firewall idle timeouts.
const heartbeatTimer = setInterval(() => {
  const frame = buildCommentFrame("ping");
  for (const client of clients) {
    try {
      client.res.write(frame);
    } catch {
      // Disconnected; cleanup handled by "close" event.
    }
  }
}, HEARTBEAT_INTERVAL_MS);

// Do not block process exit on this timer.
heartbeatTimer.unref();

// ── Replay missed events from DB ──────────────────────────────────────────────

/**
 * Queries vault_events for rows added after the given event ID.
 * The vault_events primary key is a compound text ID (ledger_seq:tx_idx:…)
 * which sorts lexicographically by insertion order, so we use indexed_at
 * to find events newer than the one the client last saw.
 */
async function replayMissedEvents(
  res: Response,
  lastEventId: string,
): Promise<void> {
  try {
    const pool = getReadPool();

    // Find the indexed_at timestamp of the last event the client received.
    const pivot = await pool.query<{ indexed_at: Date }>(
      `SELECT indexed_at FROM vault_events WHERE id = $1`,
      [lastEventId],
    );

    if (pivot.rowCount === 0) {
      // Unknown event ID — skip replay to avoid sending everything
      logger.debug(
        { lastEventId },
        "[vaultEvents/replay] Last-Event-ID not found, skipping replay",
      );
      return;
    }

    const since = pivot.rows[0].indexed_at;

    const missed = await pool.query<{
      id: string;
      event_type: string;
      amount: string;
      caller_address: string;
      contract_id: string;
      ledger_sequence: number;
      ledger_timestamp: Date;
      raw_payload: Record<string, unknown>;
    }>(
      `SELECT id, event_type, amount::text, caller_address, contract_id,
              ledger_sequence, ledger_timestamp, raw_payload
       FROM vault_events
       WHERE indexed_at > $1
       ORDER BY indexed_at ASC
       LIMIT $2`,
      [since, REPLAY_LIMIT],
    );

    if (missed.rowCount === 0) {
      return;
    }

    logger.info(
      { lastEventId, count: missed.rowCount },
      "[vaultEvents/replay] replaying missed events",
    );

    for (const row of missed.rows) {
      const payload: VaultUpdatePayload = {
        type: row.event_type as VaultUpdatePayload["type"],
        amount: row.amount,
        callerAddress: row.caller_address,
        contractId: row.contract_id,
        ledgerSequence: row.ledger_sequence,
        timestamp: new Date(row.ledger_timestamp).toISOString(),
        ...row.raw_payload,
      };
      res.write(buildEventFrame("vault_update", payload, row.id));
    }
  } catch (err) {
    logger.warn({ err, lastEventId }, "[vaultEvents/replay] replay failed");
    // Non-fatal: the client is live-connected; missed events are best-effort.
  }
}

// ── SSE Endpoint ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/vault/events
 *
 * Opens an SSE connection. On reconnect the client sends Last-Event-ID and
 * receives up to REPLAY_LIMIT missed events before the live stream begins.
 *
 * Returns 429 when MAX_SSE_CONNECTIONS is reached.
 */
vaultEventsRouter.get(
  "/events",
  async (req: Request, res: Response): Promise<void> => {
    // ── Connection limit ──────────────────────────────────────────────────────
    if (clients.size >= MAX_SSE_CONNECTIONS) {
      res
        .status(429)
        .json(
          errorResponse(
            "SSE_CAPACITY_EXCEEDED",
            `Maximum concurrent SSE connections (${MAX_SSE_CONNECTIONS}) reached. Try again later.`,
          ),
        );
      return;
    }

    // ── SSE response headers ──────────────────────────────────────────────────
    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx response buffering
      "Transfer-Encoding": "chunked",
    });
    res.flushHeaders();

    // ── Register client ───────────────────────────────────────────────────────
    const clientId = `ve-${++clientIdSeq}`;
    const client: SseClient = { id: clientId, res };
    clients.add(client);

    logger.info(
      { clientId, total: clients.size },
      "[vaultEvents] client connected",
    );

    // ── Send connection acknowledgement ───────────────────────────────────────
    res.write(
      buildEventFrame("connected", {
        clientId,
        connectedClients: clients.size,
        replayLimit: REPLAY_LIMIT,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      }),
    );

    // ── Replay missed events (Last-Event-ID) ──────────────────────────────────
    const lastEventId = req.headers["last-event-id"];
    if (lastEventId && typeof lastEventId === "string" && lastEventId.trim()) {
      await replayMissedEvents(res, lastEventId.trim());
    }

    // ── Cleanup on client disconnect ──────────────────────────────────────────
    req.on("close", () => {
      clients.delete(client);
      logger.info(
        { clientId, total: clients.size },
        "[vaultEvents] client disconnected",
      );
    });
  },
);

// ── Status Endpoint ───────────────────────────────────────────────────────────

/**
 * GET /api/v1/vault/events/status
 *
 * Public health endpoint — returns connected client count and config.
 * Useful for load testing and operational monitoring.
 */
vaultEventsRouter.get(
  "/events/status",
  (_req: Request, res: Response): void => {
    res.json({
      success: true,
      data: {
        connectedClients: clients.size,
        maxConnections: MAX_SSE_CONNECTIONS,
        replayLimit: REPLAY_LIMIT,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        timestamp: new Date().toISOString(),
      },
    });
  },
);
