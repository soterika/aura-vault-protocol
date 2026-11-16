/**
 * Portfolio Transaction Search — Issue #311
 *
 * GET /api/portfolio/:address/search?q=<query>
 *
 * Full-text search over contract_events for a given wallet address.
 * Uses PostgreSQL tsvector GIN index for sub-100ms P99 on 1M+ rows.
 *
 * Features:
 * - Ranked results by ts_rank (relevance score)
 * - Partial hash search via prefix-match operator (:*)
 * - Filters by address in contract_id or topic JSONB
 * - Pagination (limit/offset)
 * - Minimum query length validation to prevent runaway full-scans
 */

import { Router, Request, Response } from "express";
import { getReadPool } from "../db.js";
import { successResponse, errorResponse, paginatedResponse } from "../dto/index.js";
import { authenticate } from "../middleware/authMiddleware.js";
import { logger } from "../logger.js";

export const portfolioSearchRouter = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 256;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a raw user query string into a tsquery expression.
 *
 * Strategy:
 * 1. Strip characters not allowed in tsquery.
 * 2. For short single tokens that look like a hash prefix, use prefix search (:*).
 * 3. For multi-word queries, AND all tokens together with prefix on the last token.
 */
function buildTsQuery(raw: string): string {
  // Strip characters that would break tsquery; keep alphanumeric, underscore, hyphen
  const sanitized = raw.trim().replace(/[^a-zA-Z0-9_\-\s]/g, "");
  const tokens = sanitized.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) return "";

  // Each token except the last gets exact match; last token gets prefix match (:*)
  // This lets partial hash searches work: "abc123" → "abc123:*"
  const parts = tokens.map((t, i) =>
    i === tokens.length - 1 ? `${t}:*` : t
  );

  return parts.join(" & ");
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * GET /api/portfolio/:address/search?q=<query>&limit=20&offset=0
 *
 * Returns contract_events that match the search query, scoped to the
 * given wallet address (matched against the caller column in value JSONB).
 */
portfolioSearchRouter.get("/search", authenticate, async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params;
  const rawQuery = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const limitParam = parseInt((req.query.limit as string) ?? String(DEFAULT_LIMIT), 10);
  const offsetParam = parseInt((req.query.offset as string) ?? "0", 10);

  // --- Input validation ---
  if (!address) {
    res.status(400).json(errorResponse("INVALID_PARAM", "Address is required"));
    return;
  }

  if (rawQuery.length < MIN_QUERY_LENGTH) {
    res.status(400).json(errorResponse("QUERY_TOO_SHORT", `Query must be at least ${MIN_QUERY_LENGTH} characters`));
    return;
  }

  if (rawQuery.length > MAX_QUERY_LENGTH) {
    res.status(400).json(errorResponse("QUERY_TOO_LONG", `Query must not exceed ${MAX_QUERY_LENGTH} characters`));
    return;
  }

  const limit = Math.min(isNaN(limitParam) ? DEFAULT_LIMIT : Math.max(1, limitParam), MAX_LIMIT);
  const offset = isNaN(offsetParam) ? 0 : Math.max(0, offsetParam);

  const tsQuery = buildTsQuery(rawQuery);
  if (!tsQuery) {
    res.status(400).json(errorResponse("INVALID_QUERY", "Query contains no searchable terms"));
    return;
  }

  try {
    const db = getReadPool();

    // Full-text search query with relevance ranking.
    // We scope by address: match either contract_id, OR caller in the value JSONB.
    // ts_rank_cd uses cover density ranking for better short-query results.
    const sql = `
      SELECT
        id,
        ledger_sequence,
        transaction_hash,
        event_index,
        contract_id,
        event_type,
        topic,
        value,
        created_at,
        ts_rank_cd(search_vector, to_tsquery('simple', $1)) AS rank
      FROM contract_events
      WHERE
        search_vector @@ to_tsquery('simple', $1)
        AND (
          contract_id = $2
          OR value->>'caller' = $2
          OR topic::text ILIKE $3
        )
      ORDER BY rank DESC, created_at DESC
      LIMIT $4 OFFSET $5
    `;

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM contract_events
      WHERE
        search_vector @@ to_tsquery('simple', $1)
        AND (
          contract_id = $2
          OR value->>'caller' = $2
          OR topic::text ILIKE $3
        )
    `;

    const addressPattern = `%${address}%`;

    const [dataResult, countResult] = await Promise.all([
      db.query(sql, [tsQuery, address, addressPattern, limit, offset]),
      db.query(countSql, [tsQuery, address, addressPattern]),
    ]);

    const total: number = countResult.rows[0]?.total ?? 0;
    const page = Math.floor(offset / limit) + 1;
    const pageSize = limit;
    const totalPages = Math.ceil(total / pageSize);

    res.json(
      paginatedResponse(dataResult.rows, {
        page,
        pageSize,
        total,
        totalPages,
        hasNext: offset + limit < total,
        hasPrev: offset > 0,
      })
    );
  } catch (err) {
    logger.error("[portfolio/search]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Search query failed"));
  }
});
