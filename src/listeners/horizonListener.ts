/**
 * Horizon SSE Event Listener — Issue #943
 *
 * Streams on-chain events from the Stellar Horizon API and persists them
 * to the contract_events table via EventRepository.
 *
 * Improvements over original implementation:
 *   ✅ Exponential backoff reconnect: 1s → 2s → 4s → … → 60s max
 *   ✅ WARN-level logging on every reconnect attempt with a correlation ID
 *   ✅ Prometheus counter `horizon_listener_reconnects_total` incremented
 *      on each reconnect
 *   ✅ After 5 consecutive reconnect failures the counter-based
 *      HorizonListenerDown alert fires (see indexer-alerts.yml)
 *   ✅ Replaces console.log with the structured Winston logger
 */

import EventSource from 'eventsource';
import { v4 as uuidv4 } from 'uuid';
import { Registry, Counter } from 'prom-client';
import { EventParser } from '../parsers/index.js';
import { EventRepository } from '../repositories/eventRepository.js';
import { VaultEvent } from '../types/events.js';

// ---------------------------------------------------------------------------
// Prometheus metrics — Issue #943
// ---------------------------------------------------------------------------

/** Shared registry for horizon-listener metrics. */
export const horizonListenerRegistry = new Registry();

/**
 * Total number of reconnect attempts made by the HorizonListener since startup.
 * Used by the HorizonListenerDown alert rule in indexer-alerts.yml:
 *
 *   alert: HorizonListenerDown
 *   expr: increase(horizon_listener_reconnects_total[5m]) >= 5
 */
export const horizonReconnectsCounter = new Counter({
  name: 'horizon_listener_reconnects_total',
  help: 'Total number of Horizon SSE reconnect attempts made by the listener',
  labelNames: ['contract_id'] as const,
  registers: [horizonListenerRegistry],
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HorizonEvent {
  id: string;
  type: string;
  contract_id: string;
  tx_hash: string;
  ledger: number;
  occurred_at: string;
  data: unknown;
}

// ---------------------------------------------------------------------------
// Logger adapter
// ---------------------------------------------------------------------------

/**
 * Thin wrapper so the listener uses the backend Winston logger when run inside
 * the backend process, and falls back to console in standalone / test contexts.
 */
async function getLogger() {
  try {
    const mod = await import('../logger.js');
    return mod.logger;
  } catch {
    return {
      info: (msg: unknown, meta?: unknown) => console.log('[INFO]', msg, meta ?? ''),
      warn: (msg: unknown, meta?: unknown) => console.warn('[WARN]', msg, meta ?? ''),
      error: (msg: unknown, meta?: unknown) => console.error('[ERROR]', msg, meta ?? ''),
      debug: (msg: unknown, meta?: unknown) => console.debug('[DEBUG]', msg, meta ?? ''),
    };
  }
}

// ---------------------------------------------------------------------------
// HorizonListener
// ---------------------------------------------------------------------------

export class HorizonListener {
  private eventSource: EventSource | null = null;
  private readonly contractId: string;
  private readonly horizonUrl: string;

  // Backoff state
  private reconnectDelay: number = 1_000;       // starts at 1 s
  private readonly minReconnectDelay = 1_000;   // 1 s
  private readonly maxReconnectDelay = 60_000;  // 60 s cap (issue #943)
  private consecutiveFailures: number = 0;

  private isConnected: boolean = false;
  private isReconnecting: boolean = false;
  private isStopped: boolean = false;

  private lastEventId: string | null = null;
  private lastLedger: number | null = null;

  /** Correlation ID for log correlation across reconnect cycles. */
  private sessionCorrelationId: string = uuidv4();

  constructor(contractId: string, horizonUrl: string = 'https://horizon.stellar.org') {
    this.contractId = contractId;
    this.horizonUrl = horizonUrl;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    const log = await getLogger();
    log.info('[HorizonListener] Starting', {
      contractId: this.contractId,
      correlationId: this.sessionCorrelationId,
    });

    this.isStopped = false;

    // Load cursor from database
    const cursor = await EventRepository.getCursor(this.contractId);
    if (cursor) {
      this.lastEventId = cursor.last_event_id;
      this.lastLedger = cursor.last_ledger;
      log.info('[HorizonListener] Resuming from stored cursor', {
        lastEventId: this.lastEventId ?? 'none',
        lastLedger: this.lastLedger,
        correlationId: this.sessionCorrelationId,
      });
    }

    // Backfill missed events
    if (this.lastLedger) {
      await this.backfillEvents();
    }

    this.connect();
  }

  async stop(): Promise<void> {
    const log = await getLogger();
    this.isStopped = true;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.isConnected = false;
    log.info('[HorizonListener] Stopped', {
      contractId: this.contractId,
      correlationId: this.sessionCorrelationId,
    });
  }

  getStatus(): {
    connected: boolean;
    contractId: string;
    lastEventId: string | null;
    lastLedger: number | null;
    consecutiveFailures: number;
    currentReconnectDelayMs: number;
  } {
    return {
      connected: this.isConnected,
      contractId: this.contractId,
      lastEventId: this.lastEventId,
      lastLedger: this.lastLedger,
      consecutiveFailures: this.consecutiveFailures,
      currentReconnectDelayMs: this.reconnectDelay,
    };
  }

  // -------------------------------------------------------------------------
  // SSE connection
  // -------------------------------------------------------------------------

  private connect(): void {
    if (this.isStopped) return;

    const url = `${this.horizonUrl}/contracts/${this.contractId}/events`;
    const options: Record<string, unknown> = {};

    if (this.lastEventId) {
      options.headers = { 'Last-Event-ID': this.lastEventId };
    }

    this.eventSource = new EventSource(url, options as ConstructorParameters<typeof EventSource>[1]);

    this.eventSource.onopen = () => {
      this.isConnected = true;
      this.isReconnecting = false;
      // Reset backoff on successful connection
      this.reconnectDelay = this.minReconnectDelay;
      this.consecutiveFailures = 0;
      // Issue a new correlation ID for the new session
      this.sessionCorrelationId = uuidv4();
      void getLogger().then((log) =>
        log.info('[HorizonListener] SSE connection established', {
          contractId: this.contractId,
          url,
          correlationId: this.sessionCorrelationId,
        })
      );
    };

    this.eventSource.onmessage = (event: MessageEvent) => {
      void this.handleEvent(event);
    };

    this.eventSource.onerror = () => {
      this.isConnected = false;
      void this.handleDisconnect();
    };

    // Typed event listeners for each Soroban vault event type
    for (const eventType of ['deposit', 'withdraw', 'harvest', 'pause', 'suspicious', 'share_price_snapshot']) {
      this.eventSource.addEventListener(eventType, (event: MessageEvent) => {
        void this.handleEvent(event);
      });
    }
  }

  // -------------------------------------------------------------------------
  // Exponential backoff reconnect — Issue #943
  // -------------------------------------------------------------------------

  private async handleDisconnect(): Promise<void> {
    if (this.isStopped || this.isReconnecting) return;

    this.isReconnecting = true;
    this.consecutiveFailures += 1;

    const log = await getLogger();

    // Increment Prometheus counter — alert rule watches for >= 5 in a window
    horizonReconnectsCounter.inc({ contract_id: this.contractId });

    // WARN log with correlation ID on every reconnect attempt (issue #943)
    log.warn('[HorizonListener] SSE connection lost — scheduling reconnect', {
      contractId: this.contractId,
      correlationId: this.sessionCorrelationId,
      consecutiveFailures: this.consecutiveFailures,
      reconnectDelayMs: this.reconnectDelay,
      note:
        this.consecutiveFailures >= 5
          ? 'HorizonListenerDown alert threshold reached (5 consecutive failures)'
          : undefined,
    });

    if (this.consecutiveFailures >= 5) {
      log.error(
        '[HorizonListener] 5 or more consecutive failures — HorizonListenerDown alert should fire',
        {
          contractId: this.contractId,
          correlationId: this.sessionCorrelationId,
          consecutiveFailures: this.consecutiveFailures,
        }
      );
    }

    // Close the broken EventSource before scheduling a new one
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    const delay = this.reconnectDelay;

    // Advance backoff for next failure (cap at maxReconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);

    setTimeout(() => {
      this.isReconnecting = false;
      this.connect();
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Event handling
  // -------------------------------------------------------------------------

  private async handleEvent(event: MessageEvent): Promise<void> {
    const log = await getLogger();
    try {
      const rawEvent = JSON.parse(event.data as string) as HorizonEvent;

      const parsedData = EventParser.parseEvent(rawEvent.type, rawEvent.data);

      const vaultEvent: VaultEvent = {
        id: rawEvent.id,
        type: rawEvent.type as VaultEvent['type'],
        contract_id: rawEvent.contract_id,
        tx_hash: rawEvent.tx_hash,
        ledger: rawEvent.ledger,
        occurred_at: new Date(rawEvent.occurred_at),
        data: rawEvent.data,
        parsed_data: parsedData,
      };

      await EventRepository.saveEvent(vaultEvent);

      this.lastEventId = rawEvent.id;
      this.lastLedger = rawEvent.ledger;
      await EventRepository.updateCursor(
        this.contractId,
        rawEvent.id,
        rawEvent.ledger
      );

      log.info('[HorizonListener] Event processed', {
        eventType: rawEvent.type,
        eventId: rawEvent.id,
        correlationId: this.sessionCorrelationId,
      });
    } catch (error) {
      log.error('[HorizonListener] Failed to process event', {
        error,
        correlationId: this.sessionCorrelationId,
      });
      await this.handleFailedEvent(event, error as Error);
    }
  }

  private async handleFailedEvent(event: MessageEvent, error: Error): Promise<void> {
    const log = await getLogger();
    try {
      const rawEvent = JSON.parse(event.data as string) as HorizonEvent;
      await EventRepository.saveDeadLetter(
        rawEvent.id,
        rawEvent.contract_id,
        rawEvent,
        error
      );
    } catch (deadLetterError) {
      log.error('[HorizonListener] Failed to save dead letter', {
        error: deadLetterError,
        correlationId: this.sessionCorrelationId,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Backfill
  // -------------------------------------------------------------------------

  private async backfillEvents(): Promise<void> {
    const log = await getLogger();
    log.info('[HorizonListener] Backfilling missed events', {
      contractId: this.contractId,
      fromLedger: this.lastLedger,
      correlationId: this.sessionCorrelationId,
    });

    try {
      const events = await EventRepository.backfillEvents(
        this.contractId,
        this.lastLedger ?? 0
      );

      if (events.length > 0) {
        log.info('[HorizonListener] Backfill complete', {
          eventsRestored: events.length,
          correlationId: this.sessionCorrelationId,
        });
      }
    } catch (error) {
      log.error('[HorizonListener] Backfill failed', {
        error,
        correlationId: this.sessionCorrelationId,
      });
    }
  }
}
