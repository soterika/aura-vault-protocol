/**
 * Standardized API Response DTOs — Issue #854
 *
 * Provides typed interfaces and factory functions for consistent response
 * shaping across all Express routes. No NestJS or class-validator dependencies.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared meta shape
// ─────────────────────────────────────────────────────────────────────────────

export interface ResponseMeta {
  requestId?: string;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core response interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: ResponseMeta;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown[];
  };
  meta?: ResponseMeta;
}

/** Discriminated union covering both outcome types. */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ─────────────────────────────────────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────────────────────────────────────

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResponse<T> extends ApiSuccessResponse<T[]> {
  data: T[];
  pagination: PaginationInfo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a successful payload in a standardized envelope.
 *
 * @example
 * res.json(successResponse({ totalAssets: "1000000" }));
 */
export function successResponse<T>(
  data: T,
  meta?: Partial<ResponseMeta>,
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

/**
 * Wrap an error in a standardized envelope. Matches the shape produced by
 * errorMiddleware.ts so all error paths look identical to clients.
 *
 * @example
 * res.status(400).json(errorResponse("INVALID_ADDRESS", "Invalid Stellar address format"));
 */
export function errorResponse(
  code: string,
  message: string,
  details?: unknown[],
  meta?: Partial<ResponseMeta>,
): ApiErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

/**
 * Wrap a page of items in a standardized paginated envelope.
 *
 * @param items   - The slice of results for the current page.
 * @param page     - Current page number (1-based).
 * @param pageSize - Number of items per page.
 * @param total    - Total number of items across all pages.
 * @param meta     - Optional request metadata (requestId, custom timestamp).
 *
 * @example
 * res.json(paginatedResponse(rows, 1, 20, 150));
 */
export function paginatedResponse<T>(
  items: T[],
  page: number,
  pageSize: number,
  total: number,
  meta?: Partial<ResponseMeta>,
): PaginatedResponse<T> {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;

  return {
    success: true,
    data: items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}
