/**
 * Event Indexer routes
 *
 * GET /api/v1/indexer/metrics  — JSON snapshot of indexer performance
 * POST /api/v1/indexer/events  — Ingest a batch of on-chain events
 *
 * The POST endpoint simulates what a Horizon streaming listener or a
 * dedicated ingestion worker would call after fetching events from the RPC.
 */

import { Router, Request, Response } from "express";
import {
  EventBuffer,
  NoopDbAdapter,
  processEventsParallel,
  getIndexerMetrics,
  renderIndexerMetricsText,
  LAG_ALERT_THRESHOLD_SECONDS,
  type VaultEvent,
} from "../services/eventIndexer.js";
import { logger } from "../logger.js";

export const indexerRouter = Router();

/** Shared buffer — in production this would be replaced with a real DB adapter. */
const sharedBuffer = new EventBuffer(new NoopDbAdapter());

/**
 * POST /api/v1/indexer/events
 *
 * Body: { events: VaultEvent[] }
 *
 * Ingests a batch of on-chain events using the optimised parallel processor.
 */
indexerRouter.post(
  "/events",
  async (req: Request, res: Response): Promise<void> => {
    const { events } = req.body as { events?: unknown };

    if (!Array.isArray(events) || events.length === 0) {
      res.status(400).json({ error: "events must be a non-empty array" });
      return;
    }

    // Basic shape validation
    const invalid = (events as VaultEvent[]).filter(
      (e) =>
        typeof e.id !== "string" ||
        typeof e.ledgerSequence !== "number" ||
        typeof e.ledgerTimestamp !== "number" ||
        typeof e.type !== "string"
    );
    if (invalid.length > 0) {
      res.status(400).json({
        error: "One or more events are missing required fields (id, ledgerSequence, ledgerTimestamp, type)",
        invalidCount: invalid.length,
      });
      return;
    }

    try {
      const summary = await processEventsParallel(
        events as VaultEvent[],
        new NoopDbAdapter()
      );

      const metrics = getIndexerMetrics();
      const lagExceeded =
        metrics.currentLagSeconds > LAG_ALERT_THRESHOLD_SECONDS;

      res.status(202).json({
        accepted: events.length,
        lagSeconds: metrics.currentLagSeconds,
        lagAlert: lagExceeded,
        byType: Object.fromEntries(
          [...summary.entries()].map(([type, result]) => [type, result.flushed])
        ),
      });
    } catch (err) {
      logger.error("[indexer-route]", err);
      res.status(500).json({ error: "Failed to process events" });
    }
  }
);

/**
 * GET /api/v1/indexer/metrics
 *
 * Returns indexer performance metrics as JSON.
 */
indexerRouter.get(
  "/metrics",
  (_req: Request, res: Response): void => {
    const metrics = getIndexerMetrics();
    res.json({
      ...metrics,
      lagAlertThresholdSeconds: LAG_ALERT_THRESHOLD_SECONDS,
      lagAlert: metrics.currentLagSeconds > LAG_ALERT_THRESHOLD_SECONDS,
    });
  }
);

/**
 * GET /api/v1/indexer/metrics/prometheus
 *
 * Prometheus text format metrics for the event indexer.
 */
indexerRouter.get(
  "/metrics/prometheus",
  (_req: Request, res: Response): void => {
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(renderIndexerMetricsText());
  }
);
