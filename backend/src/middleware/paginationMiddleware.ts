import type { Request } from "express";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export interface PaginationMeta {
  limit: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
}

/**
 * Parse a limit/cursor pair from the request query string.
 *
 * Query contract:
 * - limit: integer, default DEFAULT_LIMIT, clamped to MAX_LIMIT
 * - cursor: opaque string offset used for sequential pagination
 */
export function parsePagination(req: Request): PaginationMeta {
  const rawLimit = req.query.limit;
  const limitValue = typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : DEFAULT_LIMIT;
  const limit = Number.isFinite(limitValue)
    ? Math.min(Math.max(limitValue, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const rawCursor = req.query.cursor;
  const cursor = typeof rawCursor === "string" ? rawCursor : undefined;

  return { limit, cursor };
}

/**
 * Apply cursor-based pagination to an array of items.
 *
 * The cursor is treated as a zero-based offset into the original array, and it
 * is returned as the next offset when more results remain.
 */
export function paginateArray<T, U = T>(
  items: T[],
  mapper: (item: T, index: number) => U,
  limit: number,
  cursor?: string,
): PaginatedResult<U> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT;

  const start = (() => {
    if (typeof cursor !== "string") return 0;
    const parsed = Number.parseInt(cursor, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  })();

  const end = start + safeLimit;
  const slice = items.slice(start, end);
  const data = slice.map(mapper);
  const nextCursor = end < items.length ? String(end) : null;

  return { data, nextCursor };
}
