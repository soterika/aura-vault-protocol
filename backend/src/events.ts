/**
 * events.ts — Aura Vault off-chain event listener
 *
 * Polls the Soroban RPC `getEvents` endpoint for `parameter_changed` events
 * emitted by the AuraVault contract.  For every matched event the listener:
 *
 *   1. Logs structured JSON to stdout (consumed by Promtail → Loki).
 *   2. Increments an in-process Prometheus counter that Prometheus scrapes via
 *      the /metrics endpoint on the backend HTTP server.
 *
 * Event structure (emitted by set_fees, set_treasury, set_harvest_minimum,
 * set_tvl_cap):
 *
 *   topics : [ Symbol("parameter_changed") ]
 *   data   : ( Symbol(param_name), old_value, new_value, Address(admin) )
 *
 * Usage:
 *   import { startParameterChangedListener } from "./events.js";
 *   startParameterChangedListener();
 *
 * Environment variables:
 *   SOROBAN_RPC_URL   — e.g. https://soroban-testnet.stellar.org  (required)
 *   CONTRACT_ID       — deployed AuraVault contract ID             (required)
 *   POLL_INTERVAL_MS  — how often to poll in ms          (default 5000)
 *   START_LEDGER      — ledger to start scanning from    (default 0)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single Soroban event as returned by the RPC `getEvents` endpoint. */
export interface SorobanEvent {
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  id: string;
  pagingToken: string;
  topic: string[];   // base64-encoded XDR SCVal for each topic element
  value: string;     // base64-encoded XDR SCVal for the event data
}

/** Decoded payload for a `parameter_changed` event. */
export interface ParameterChangedEvent {
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  paramName: string;
  // old_value and new_value are kept as raw strings because the Soroban XDR
  // type depends on the parameter (u32 for fees, i128 for amounts, Address
  // for treasury).  Consumers should decode with @stellar/stellar-sdk.
  oldValueRaw: string;
  newValueRaw: string;
  admin: string;
  eventId: string;
}

/** Response shape from the Soroban RPC `getEvents` call. */
interface GetEventsResponse {
  result?: {
    events: SorobanEvent[];
    latestLedger: number;
  };
  error?: {
    code: number;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Prometheus counter (simple in-memory implementation)
// ---------------------------------------------------------------------------
// We avoid a hard dependency on the `prom-client` package so the backend
// compiles without additional npm installs.  The /metrics HTTP endpoint in
// index.ts should expose `parameterChangesTotal` via its own Prometheus client.

/** Total number of `parameter_changed` events indexed since process start. */
export let parameterChangesTotal = 0;

/** Per-parameter change counts, keyed by param_name. */
export const parameterChangesByName: Record<string, number> = {};

/**
 * Reset counters (used in tests).
 */
export function resetCounters(): void {
  parameterChangesTotal = 0;
  for (const key of Object.keys(parameterChangesByName)) {
    delete parameterChangesByName[key];
  }
}

// ---------------------------------------------------------------------------
// Core listener logic
// ---------------------------------------------------------------------------

/**
 * Fetch the next page of Soroban contract events from the RPC endpoint.
 *
 * @param rpcUrl     - Soroban RPC base URL.
 * @param contractId - AuraVault contract ID.
 * @param cursor     - Pagination cursor (empty string for first page).
 * @param limit      - Max events per page (1–10 000).
 */
async function fetchEvents(
  rpcUrl: string,
  contractId: string,
  cursor: string,
  limit = 100,
): Promise<GetEventsResponse> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getEvents",
    params: {
      filters: [
        {
          type: "contract",
          contractIds: [contractId],
          topics: [
            // Match events whose first topic is exactly Symbol("parameter_changed").
            // XDR encoding of Symbol("parameter_changed") as a base64 string.
            // The Soroban RPC accepts wildcard "*" per topic position.
            // Using "*" for all positions and filtering client-side is simpler
            // without a full XDR library dependency.
            ["*"],
          ],
        },
      ],
      pagination: {
        limit,
        ...(cursor ? { cursor } : {}),
      },
    },
  };

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<GetEventsResponse>;
}

/**
 * Heuristic check: is this event a `parameter_changed` event?
 *
 * The Soroban event `topic` array contains XDR-encoded SCVal values as
 * base64 strings.  Without a full XDR decoder we rely on the fact that
 * the Symbol "parameter_changed" encodes to a well-known string.  We
 * decode topic[0] as UTF-8 and look for the symbol name in it.
 *
 * For production use, replace this with proper XDR decoding via
 * `@stellar/stellar-sdk`'s `xdr.ScVal.fromXDR(topic, "base64")`.
 */
function isParameterChangedEvent(event: SorobanEvent): boolean {
  if (!event.topic || event.topic.length === 0) return false;
  try {
    // Base64-decode the first topic and search for the symbol text.
    const decoded = Buffer.from(event.topic[0], "base64").toString("utf8");
    return decoded.includes("parameter_changed");
  } catch {
    return false;
  }
}

/**
 * Extract human-readable field values from a raw `parameter_changed` event.
 *
 * Full XDR decoding requires `@stellar/stellar-sdk`.  This implementation
 * returns the raw base64 XDR for old_value and new_value so that downstream
 * consumers can decode them as needed.  param_name is extracted heuristically
 * from the topic or data payload.
 */
function decodeParameterChangedEvent(event: SorobanEvent): ParameterChangedEvent {
  // topic[0] = Symbol("parameter_changed")  (already validated by caller)
  // data     = ( Symbol(param_name), old_value, new_value, Address(admin) )
  //
  // Without a full XDR library we extract the param_name by scanning the
  // base64-decoded data bytes for known ASCII symbol names.
  const dataRaw = event.value ?? "";
  let paramName = "unknown";
  let oldValueRaw = dataRaw;
  let newValueRaw = dataRaw;
  let admin = "unknown";

  const knownParams = [
    "perf_fee_bps",
    "mgmt_fee_bps",
    "treasury",
    "harvest_minimum",
    "tvl_cap",
  ];

  try {
    const decoded = Buffer.from(dataRaw, "base64").toString("utf8");
    for (const name of knownParams) {
      if (decoded.includes(name)) {
        paramName = name;
        break;
      }
    }
  } catch {
    // leave paramName as "unknown"
  }

  // The topic array may contain [Symbol("parameter_changed"), Symbol(param_name)]
  // depending on how the contract was compiled; check topic[1] as a fallback.
  if (paramName === "unknown" && event.topic.length >= 2) {
    try {
      const t1 = Buffer.from(event.topic[1], "base64").toString("utf8");
      for (const name of knownParams) {
        if (t1.includes(name)) {
          paramName = name;
          break;
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    contractId: event.contractId,
    paramName,
    oldValueRaw,
    newValueRaw,
    admin,
    eventId: event.id,
  };
}

/**
 * Handle a single decoded `parameter_changed` event:
 *   - Log to stdout as structured JSON.
 *   - Update in-process Prometheus counters.
 *   - Optionally invoke an external alert webhook (future extension).
 */
function handleParameterChangedEvent(decoded: ParameterChangedEvent): void {
  // Structured log consumed by Promtail and forwarded to Loki.
  console.log(
    JSON.stringify({
      level: "info",
      event: "parameter_changed",
      ledger: decoded.ledger,
      ledgerClosedAt: decoded.ledgerClosedAt,
      contractId: decoded.contractId,
      paramName: decoded.paramName,
      oldValueRaw: decoded.oldValueRaw,
      newValueRaw: decoded.newValueRaw,
      admin: decoded.admin,
      eventId: decoded.eventId,
      timestamp: new Date().toISOString(),
    }),
  );

  // Update Prometheus counters (exposed via /metrics).
  parameterChangesTotal += 1;
  parameterChangesByName[decoded.paramName] =
    (parameterChangesByName[decoded.paramName] ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ListenerOptions {
  rpcUrl: string;
  contractId: string;
  pollIntervalMs?: number;
  /** Initial cursor / paging token to resume from after restart. */
  initialCursor?: string;
  /** Callback invoked for every decoded `parameter_changed` event. */
  onEvent?: (event: ParameterChangedEvent) => void;
}

/**
 * Start a long-running poll loop that indexes `parameter_changed` events.
 *
 * Returns a `stop()` function that halts the loop when called.
 *
 * @example
 * ```ts
 * const { stop } = startParameterChangedListener({
 *   rpcUrl:     process.env.SOROBAN_RPC_URL!,
 *   contractId: process.env.CONTRACT_ID!,
 * });
 * process.on("SIGTERM", stop);
 * ```
 */
export function startParameterChangedListener(options: ListenerOptions): {
  stop: () => void;
} {
  const {
    rpcUrl,
    contractId,
    pollIntervalMs = 5_000,
    initialCursor = "",
    onEvent,
  } = options;

  let running = true;
  let cursor = initialCursor;

  const poll = async (): Promise<void> => {
    if (!running) return;

    try {
      const response = await fetchEvents(rpcUrl, contractId, cursor);

      if (response.error) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "rpc_error",
            code: response.error.code,
            message: response.error.message,
            timestamp: new Date().toISOString(),
          }),
        );
      } else if (response.result) {
        const events = response.result.events ?? [];

        for (const raw of events) {
          if (!isParameterChangedEvent(raw)) continue;

          const decoded = decodeParameterChangedEvent(raw);
          handleParameterChangedEvent(decoded);
          onEvent?.(decoded);

          // Advance cursor so we don't re-process on the next poll.
          cursor = raw.pagingToken;
        }
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "poll_error",
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    }

    if (running) {
      setTimeout(poll, pollIntervalMs);
    }
  };

  // Start immediately.
  void poll();

  return {
    stop(): void {
      running = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Prometheus metrics text exposition (used by /metrics endpoint in index.ts)
// ---------------------------------------------------------------------------

/**
 * Return a Prometheus text-format metrics string for the parameter change
 * counters.  Integrate into the /metrics route handler in index.ts.
 *
 * @example
 * ```ts
 * import { getParameterChangeMetrics } from "./events.js";
 * app.get("/metrics", (_req, res) => {
 *   res.set("Content-Type", "text/plain; version=0.0.4");
 *   res.send(getParameterChangeMetrics());
 * });
 * ```
 */
export function getParameterChangeMetrics(): string {
  const lines: string[] = [
    "# HELP aura_vault_parameter_changes_total Total number of parameter_changed events indexed.",
    "# TYPE aura_vault_parameter_changes_total counter",
    `aura_vault_parameter_changes_total ${parameterChangesTotal}`,
  ];

  for (const [name, count] of Object.entries(parameterChangesByName)) {
    lines.push(
      `# HELP aura_vault_parameter_changes_by_name_total Events per parameter name.`,
      `# TYPE aura_vault_parameter_changes_by_name_total counter`,
      `aura_vault_parameter_changes_by_name_total{param="${name}"} ${count}`,
    );
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Standalone entry-point (run directly: tsx src/events.ts)
// ---------------------------------------------------------------------------

// When run as a script (not imported as a module) start the listener using
// environment variables.
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] != null &&
  // ESM __filename equivalent
  new URL(import.meta.url).pathname === process.argv[1];

if (isMain) {
  const rpcUrl = process.env["SOROBAN_RPC_URL"];
  const contractId = process.env["CONTRACT_ID"];

  if (!rpcUrl || !contractId) {
    console.error("SOROBAN_RPC_URL and CONTRACT_ID environment variables are required.");
    process.exit(1);
  }

  const { stop } = startParameterChangedListener({
    rpcUrl,
    contractId,
    pollIntervalMs: Number(process.env["POLL_INTERVAL_MS"] ?? 5_000),
  });

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  console.log(
    JSON.stringify({
      level: "info",
      event: "listener_started",
      rpcUrl,
      contractId,
      timestamp: new Date().toISOString(),
    }),
  );
}
