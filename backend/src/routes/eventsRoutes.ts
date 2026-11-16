import { Router, type Request, type Response } from "express";
import { logger } from "../logger.js";
import { authenticate } from "../middleware/authMiddleware.js";
import { requireOperations } from "../middleware/operationsMiddleware.js";
import { searchEvents } from "../services/eventSearchService.js";
import { recordHorizonRateLimit } from "../metrics.js";

export const eventsRouter = Router();

// ── Search & Filter Endpoint (Issue #936) ────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;

function singleString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function validIsoDate(value: string): boolean {
  const dateMatch = ISO_DATE.exec(value);
  const dateTimeMatch = ISO_DATE_TIME.exec(value);
  const match = dateMatch ?? dateTimeMatch;
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year === 0 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return false;
  const offset = /([+-])14:(\d{2})$/.exec(value);
  if (offset && offset[2] !== "00") return false;
  if (dateTimeMatch && Number.isNaN(Date.parse(value))) return false;
  return true;
}

function normalizeDate(value: string, endOfDate = false): string {
  if (!ISO_DATE.test(value)) return value;
  return endOfDate ? `${value}T23:59:59.999999Z` : `${value}T00:00:00.000000Z`;
}

function parsePositiveDecimalInteger(value: unknown, fallback: number): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

eventsRouter.get(
  "/search",
  authenticate,
  requireOperations,
  async (req: Request, res: Response): Promise<void> => {
    const rawQuery = singleString(req.query.q);
    const q = rawQuery?.trim();
    if (!q || q.length > 200) {
      res.status(400).json({ error: "q must be a non-empty string of at most 200 characters" });
      return;
    }

    const page = parsePositiveDecimalInteger(req.query.page, 1);
    const pageSize = parsePositiveDecimalInteger(req.query.pageSize, 20);
    if (page === undefined || pageSize === undefined || pageSize > 100) {
      res.status(400).json({ error: "page must be positive and pageSize must be between 1 and 100" });
      return;
    }
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) {
      res.status(400).json({ error: "page and pageSize produce an unsafe pagination offset" });
      return;
    }

    const rawType = singleString(req.query.type);
    const type = rawType?.trim();
    if ((req.query.type !== undefined && (!type || type.length > 100)) ||
        (req.query.type !== undefined && rawType === undefined)) {
      res.status(400).json({ error: "type must be a string of at most 100 characters" });
      return;
    }

    const rawFrom = singleString(req.query.from);
    const rawTo = singleString(req.query.to);
    if ((req.query.from !== undefined && rawFrom === undefined) ||
        (req.query.to !== undefined && rawTo === undefined) ||
        (rawFrom !== undefined && !validIsoDate(rawFrom)) ||
        (rawTo !== undefined && !validIsoDate(rawTo))) {
      res.status(400).json({ error: "from and to must be ISO dates or ISO date-times with a timezone" });
      return;
    }

    const from = rawFrom ? normalizeDate(rawFrom) : undefined;
    const to = rawTo ? normalizeDate(rawTo, true) : undefined;
    if (from && to && Date.parse(from) > Date.parse(to)) {
      res.status(400).json({ error: "from must be before or equal to to" });
      return;
    }

    try {
      const result = await searchEvents({
        q,
        type,
        from,
        to,
        page,
        pageSize,
      });
      res.json(result);
    } catch (error) {
      console.error("[events/search]", error);
      res.status(500).json({ error: "Unable to search contract events" });
    }
  }
);

/**
 * Contract Event Stream — Issue #285
 *
 * Server-Sent Events (SSE) endpoint that proxies the Horizon event stream for
 * the configured vault contract ID.  Clients subscribe once and receive
 * real-time deposit / withdraw / harvest / pause events without polling.
 *
 * Route:  GET /api/v1/events/stream
 *
 * Reconnect:
 *   The browser EventSource API reconnects automatically using the
 *   `Last-Event-ID` header that the server sends on every message.
 *   When the underlying Horizon stream errors the server reconnects with
 *   exponential back-off (1 s → 30 s cap) and forwards a `reconnecting`
 *   comment to all connected clients so the UI can show a banner.
 *
 * Fallback:
 *   If HORIZON_URL is not configured or the stream is unavailable, a
 *   `polling-fallback` event is sent so the frontend can switch to
 *   30-second polling.
 */

import { Router, Request, Response } from "express";
import { config } from "../config/index.js";


// ── Types ─────────────────────────────────────────────────────────────────────

interface SseClient {
  id: string;
  res: Response;
}

// ── In-process fan-out bus ────────────────────────────────────────────────────

const clients = new Map<string, SseClient>();
let clientIdSeq = 0;

/** Broadcast a named SSE event to all connected clients. */
function broadcast(event: string, data: unknown, id?: string): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}${id ? `\nid: ${id}` : ""}\n\n`;
  for (const client of clients.values()) {
    client.res.write(payload);
  }
}

/** Send a comment (keepalive / status) to all clients. */
function broadcastComment(comment: string): void {
  const payload = `: ${comment}\n\n`;
  for (const client of clients.values()) {
    client.res.write(payload);
  }
}

// ── Keepalive timer ───────────────────────────────────────────────────────────

// Send a SSE comment every 20 s so proxies / firewalls don't drop idle connections.
setInterval(() => {
  broadcastComment("keepalive");
}, 20_000);

// ── Horizon stream connection ─────────────────────────────────────────────────

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RATE_LIMIT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;
const RATE_LIMIT_WINDOW_MS = 5 * 60_000;
const rateLimitEvents: number[] = [];
let consecutiveRateLimits = 0;
let rateLimitTotal = 0;

let horizonStreamReady = false;
let reconnectDelay = RECONNECT_BASE_MS;
let lastEventId: string | null = null;

/**
 * Start (or re-start) the Horizon event stream and pipe events to all SSE
 * clients.  Reconnects automatically on error using exponential back-off.
 */
async function connectHorizonStream(): Promise<void> {
  const { horizonUrl, vaultContractId } = config.stellar;

  if (!horizonUrl || !vaultContractId) {
    logger.warn(
      "[eventsStream] HORIZON_URL or VAULT_CONTRACT_ID not configured — sending polling-fallback"
    );
    broadcast("polling-fallback", {
      message: "Event stream unavailable — use 30-second polling",
      pollIntervalMs: 30_000,
    });
    return;
  }

  const streamUrl = `${horizonUrl}/contracts/${vaultContractId}/events`;
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "Cache-Control": "no-cache",
  };
  if (lastEventId) {
    headers["Last-Event-ID"] = lastEventId;
  }

  logger.info({ streamUrl, lastEventId }, "[eventsStream] connecting to Horizon");

  try {
    const response = await fetch(streamUrl, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 429) {
      rateLimitTotal += 1;
      consecutiveRateLimits += 1;
      const now = Date.now();
      recordHorizonRateLimit(now);
      rateLimitEvents.push(now);
      while (rateLimitEvents[0] !== undefined && rateLimitEvents[0] < now - RATE_LIMIT_WINDOW_MS) {
        rateLimitEvents.shift();
      }
      const degraded = consecutiveRateLimits >= RATE_LIMIT_BACKOFF_MS.length;
      const retryIndex = Math.min(consecutiveRateLimits - 1, RATE_LIMIT_BACKOFF_MS.length - 1);
      const baseDelay = RATE_LIMIT_BACKOFF_MS[retryIndex];
      const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
      horizonStreamReady = false;
      logger.warn({ attempt: consecutiveRateLimits, delay, rateLimitTotal }, "[eventsStream] Horizon rate limited");
      if (rateLimitEvents.length === 6) {
        logger.error({ horizonRateLimitEvents5m: rateLimitEvents.length }, "[eventsStream] alert: Horizon exceeded five rate limits in five minutes");
      }
      broadcast("rate-limited", { attempt: consecutiveRateLimits, retryInMs: delay, degraded });
      if (degraded) broadcast("polling-fallback", { message: "Horizon is rate limiting requests — use reduced polling", pollIntervalMs: 60_000 });
      setTimeout(() => void connectHorizonStream(), delay);
      return;
    }
    if (!response.ok || !response.body) {
      throw new Error(`Horizon stream returned ${response.status}`);
    }

    horizonStreamReady = true;
    reconnectDelay = RECONNECT_BASE_MS; // reset back-off on success
    consecutiveRateLimits = 0;
    broadcastComment("connected");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep incomplete last line

      let event = "message";
      let data = "";
      let id = "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data += line.slice(5).trim();
        } else if (line.startsWith("id:")) {
          id = line.slice(3).trim();
        } else if (line === "") {
          // dispatch
          if (data) {
            try {
              const parsed = JSON.parse(data);
              if (id) lastEventId = id;
              broadcast(event, parsed, id || undefined);
              logger.debug({ event, id }, "[eventsStream] forwarded event");
            } catch {
              logger.warn({ raw: data }, "[eventsStream] could not parse event data");
            }
          }
          event = "message";
          data = "";
          id = "";
        }
      }
    }
  } catch (err) {
    horizonStreamReady = false;
    logger.error({ err, reconnectDelay }, "[eventsStream] stream error, will reconnect");
    broadcastComment(`reconnecting in ${reconnectDelay}ms`);
  }

  // Schedule reconnect with back-off
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    void connectHorizonStream();
  }, reconnectDelay);
}

// Start the Horizon stream in the background when the module loads.
void connectHorizonStream();

// ── SSE endpoint ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/events/stream
 *
 * Opens a Server-Sent Events connection.  The client can pass a
 * `Last-Event-ID` header to resume from a specific event.
 *
 * Response headers instruct every caching layer not to buffer this stream.
 */
eventsRouter.get("/stream", (req: Request, res: Response): void => {
  const clientId = String(++clientIdSeq);

  // Honour Last-Event-ID from reconnecting client
  const resumeId = req.headers["last-event-id"];
  if (resumeId && typeof resumeId === "string") {
    lastEventId = resumeId;
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable nginx buffering
  });
  res.flushHeaders();

  // Register client
  clients.set(clientId, { id: clientId, res });
  logger.info({ clientId, total: clients.size }, "[eventsStream] client connected");

  // Send immediate status so the client knows the stream is alive
  res.write(
    `event: status\ndata: ${JSON.stringify({
      connected: true,
      horizonStreamReady,
      clientId,
    })}\n\n`
  );

  // If Horizon stream is not available, send polling-fallback immediately
  if (!horizonStreamReady) {
    res.write(
      `event: polling-fallback\ndata: ${JSON.stringify({
        message: "Horizon stream unavailable — use 30-second polling",
        pollIntervalMs: 30_000,
      })}\n\n`
    );
  }

  // Clean up on client disconnect
  req.on("close", () => {
    clients.delete(clientId);
    logger.info({ clientId, total: clients.size }, "[eventsStream] client disconnected");
  });
});
/**
 * GET /api/v1/events/status
 *
 * Public health endpoint — returns connection counts and Horizon stream state.
 */
eventsRouter.get("/status", (_req: Request, res: Response): void => {
  res.json({
    horizonStreamReady,
    connectedClients: clients.size,
    lastEventId,
    timestamp: new Date().toISOString(),
  });
});
