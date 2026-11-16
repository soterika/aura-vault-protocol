/**
 * OpenTelemetry Tracing — Issue #304
 *
 * Initialises the OTel SDK at application startup and exports helpers for
 * creating manual spans around HTTP requests, DB queries, Redis operations,
 * and Stellar contract calls.
 *
 * Configuration via environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — OTLP/HTTP collector URL
 *                                   (default: http://localhost:4318/v1/traces)
 *   OTEL_SERVICE_NAME            — service name tag (default: aura-vault-backend)
 *   OTEL_SAMPLING_RATE           — head-based sampling ratio 0.0–1.0 (default: 0.1)
 *   OTEL_ENABLED                 — set to "false" to disable tracing (default: true)
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  trace,
  context,
  SpanStatusCode,
  type Tracer,
  type Span,
  type Context,
} from '@opentelemetry/api';
import {
  OTLPTraceExporter,
} from '@opentelemetry/exporter-trace-otlp-http';
import {
  TraceIdRatioBasedSampler,
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes, defaultResource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ?? 'aura-vault-backend';

const SERVICE_VERSION =
  process.env.npm_package_version ?? '0.1.0';

const OTLP_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
  'http://localhost:4318/v1/traces';

/** Head-based sampling rate: 0.0 (no traces) – 1.0 (all traces). Default 10 %. */
const SAMPLING_RATE = Math.min(
  1.0,
  Math.max(
    0.0,
    parseFloat(process.env.OTEL_SAMPLING_RATE ?? '0.1'),
  ),
);

const OTEL_ENABLED = process.env.OTEL_ENABLED !== 'false';

// ---------------------------------------------------------------------------
// SDK initialisation
// ---------------------------------------------------------------------------

let sdk: NodeSDK | null = null;

/**
 * Initialise and start the OpenTelemetry NodeSDK.
 * Must be called as early as possible at application startup, before any
 * other imports that should be auto-instrumented.
 */
export function initTracing(): void {
  if (!OTEL_ENABLED) {
    logger.info('[OTel] Tracing disabled (OTEL_ENABLED=false)');
    return;
  }

  const resource = defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    }),
  );

  // Primary exporter: OTLP/HTTP (compatible with Jaeger ≥ 1.35, Grafana Tempo,
  // OpenTelemetry Collector, and any OTLP-capable backend)
  const otlpExporter = new OTLPTraceExporter({
    url: OTLP_ENDPOINT,
    headers: {},
  });

  // In development also log spans to stdout for debugging
  const isDev = process.env.NODE_ENV !== 'production';

  sdk = new NodeSDK({
    resource,
    sampler: new TraceIdRatioBasedSampler(SAMPLING_RATE),
    spanProcessors: [
      new BatchSpanProcessor(otlpExporter),
      ...(isDev ? [new BatchSpanProcessor(new ConsoleSpanExporter())] : []),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable FS instrumentation — too noisy
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  logger.info(
    `[OTel] Tracing started — service="${SERVICE_NAME}" ` +
    `endpoint="${OTLP_ENDPOINT}" samplingRate=${SAMPLING_RATE}`,
  );

  // Flush spans on graceful shutdown
  process.on('SIGTERM', () => shutdownTracing());
  process.on('SIGINT',  () => shutdownTracing());
}

/**
 * Flush pending spans and shut down the SDK.
 * Called automatically on SIGTERM/SIGINT; also exported for programmatic use.
 */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
    logger.info('[OTel] Tracing shut down');
  } catch (err) {
    logger.error('[OTel] Shutdown error:', err);
  }
}

// ---------------------------------------------------------------------------
// Tracer accessor
// ---------------------------------------------------------------------------

/** Returns the tracer for the aura-vault-backend instrumentation scope. */
export function getTracer(): Tracer {
  return trace.getTracer(SERVICE_NAME, SERVICE_VERSION);
}

// ---------------------------------------------------------------------------
// Span helpers
// ---------------------------------------------------------------------------

/**
 * Wrap an async function in a named span.
 * Automatically sets the span status to ERROR and records the exception on
 * throw, then re-throws.
 *
 * @example
 * const result = await withSpan('redis.get', async (span) => {
 *   span.setAttribute('db.key', key);
 *   return redis.get(key);
 * });
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  parentContext?: Context,
): Promise<T> {
  const tracer = getTracer();
  const ctx = parentContext ?? context.active();

  return tracer.startActiveSpan(name, {}, ctx, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

// ---------------------------------------------------------------------------
// Domain-specific span factories
// ---------------------------------------------------------------------------

/**
 * Trace an HTTP outbound request (e.g. Horizon submission).
 *
 * @example
 * const result = await traceHttpRequest('POST', horizonUrl, async (span) => {
 *   return fetch(horizonUrl, { method: 'POST', body });
 * });
 */
export async function traceHttpRequest<T>(
  method: string,
  url: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(`http.${method.toLowerCase()}`, async (span) => {
    span.setAttribute('http.method', method.toUpperCase());
    span.setAttribute('http.url', url);
    return fn(span);
  });
}

/**
 * Trace a Redis operation.
 *
 * @example
 * const value = await traceRedisOp('GET', key, () => redis.get(key));
 */
export async function traceRedisOp<T>(
  command: string,
  key: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(`redis.${command.toLowerCase()}`, async (span) => {
    span.setAttribute('db.system', 'redis');
    span.setAttribute('db.operation', command.toUpperCase());
    span.setAttribute('db.redis.key', key);
    return fn(span);
  });
}

/**
 * Trace a Stellar contract call.
 *
 * @example
 * const tx = await traceContractCall('deposit', contractId, async (span) => {
 *   span.setAttribute('stellar.amount', amount);
 *   return submitToHorizon(xdr);
 * });
 */
export async function traceContractCall<T>(
  operation: string,
  contractId: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(`contract.${operation}`, async (span) => {
    span.setAttribute('stellar.contract_id', contractId);
    span.setAttribute('stellar.operation', operation);
    return fn(span);
  });
}

/**
 * Trace a database query.
 *
 * @example
 * const rows = await traceDbQuery('SELECT', 'transactions', async (span) => {
 *   span.setAttribute('db.statement', sql);
 *   return db.query(sql, params);
 * });
 */
export async function traceDbQuery<T>(
  operation: string,
  table: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(`db.${operation.toLowerCase()}`, async (span) => {
    span.setAttribute('db.system', 'postgresql');
    span.setAttribute('db.operation', operation.toUpperCase());
    span.setAttribute('db.sql.table', table);
    return fn(span);
  });
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from "./logger.js";

/**
 * Express middleware that:
 *  1. Creates an HTTP server span for every incoming request
 *  2. Attaches the W3C trace-id and a correlation-id to the response headers
 *  3. Logs trace-id and correlation-id to the console (alongside existing logs)
 *
 * Mount this early in the middleware chain (after cors/json body parsing).
 */
export function tracingMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!OTEL_ENABLED) { next(); return; }

    const correlationId = (req.headers['x-correlation-id'] as string | undefined) ?? uuidv4();
    req.headers['x-correlation-id'] = correlationId;

    const tracer = getTracer();
    const spanName = `${req.method} ${req.path}`;

    const span = tracer.startSpan(spanName);
    const ctx = trace.setSpan(context.active(), span);

    span.setAttribute('http.method', req.method);
    span.setAttribute('http.target', req.originalUrl);
    span.setAttribute('http.route', req.path);
    span.setAttribute('http.user_agent', req.headers['user-agent'] ?? '');
    span.setAttribute('correlation_id', correlationId);

    // Propagate trace-id and correlation-id to the response
    res.on('finish', () => {
      const traceId = span.spanContext().traceId;
      span.setAttribute('http.status_code', res.statusCode);
      if (res.statusCode >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      logger.info(
        `[trace] method=${req.method} path=${req.path} ` +
        `status=${res.statusCode} traceId=${traceId} correlationId=${correlationId}`,
      );
      span.end();
    });

    res.setHeader('X-Trace-Id', span.spanContext().traceId);
    res.setHeader('X-Correlation-Id', correlationId);

    context.with(ctx, next);
  };
}
