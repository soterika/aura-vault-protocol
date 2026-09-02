/**
 * Input validation using Zod — OWASP A03 Injection Prevention
 *
 * Usage:
 *   app.post('/route', validate(mySchema), handler)
 *   app.get('/route', validateQuery(mySchema), handler)
 *   app.get('/route', validateHeaders(mySchema), handler)
 *
 * All schemas are centralized in types/schemas.ts for reuse and frontend code generation.
 */

import { z, type ZodSchema } from "zod";
import { type Request, type Response, type NextFunction } from "express";

// Re-export schemas for backwards compatibility
export {
  authLoginSchema as loginSchema,
  authRefreshSchema as refreshSchema,
  portfolioPaginationSchema,
  yieldCalculateSchema,
  backfillSchema,
  depositSimulateSchema,
  // Additional schemas from types/schemas.ts
  stellarAddressSchema,
  amountSchema,
  decimalAmountSchema,
  vaultDepositSchema,
  vaultWithdrawSchema,
  vaultHarvestSchema,
  queryPaginationSchema,
  emailSendSchema,
  userPreferencesSchema,
  // Types
  type AuthLoginInput as LoginInput,
  type AuthRefreshInput as RefreshInput,
  type PortfolioPaginationInput,
  type YieldCalculateInput,
  type DepositSimulateInput,
  type VaultDepositInput,
  type VaultWithdrawInput,
  type VaultHarvestInput,
  type StellarAddress,
  type Amount,
} from "./types/schemas.js";

// ── Middleware Factories ──────────────────────────────────────────────────────

/**
 * Validates req.body against a Zod schema.
 * On failure returns 400 with structured error detail.
 *
 * @example
 * app.post('/route', validate(mySchema), handler);
 */
export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues;
      const firstField = issues[0]?.path.join(".") ?? "input";
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `Validation failed: ${firstField} — ${issues[0]?.message ?? "invalid"}`,
          details: issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
            code: i.code,
          })),
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validates req.query against a Zod schema.
 * On failure returns 400 with structured error detail.
 *
 * @example
 * app.get('/route', validateQuery(mySchema), handler);
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid query parameters",
          details: result.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
            code: i.code,
          })),
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    (req as Request & { validatedQuery: T }).validatedQuery = result.data;
    next();
  };
}

/**
 * Validates req.headers against a Zod schema.
 * On failure returns 400 with structured error detail.
 *
 * @example
 * app.post('/route', validateHeaders(mySchema), handler);
 */
export function validateHeaders<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.headers);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request headers",
          details: result.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
            code: i.code,
          })),
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    (req as Request & { validatedHeaders: T }).validatedHeaders = result.data;
    next();
  };
}

/**
 * Combine multiple Zod schemas into a single validation middleware.
 * Validates body, query, and headers in a single pass.
 *
 * @example
 * app.post('/route', validateAll({ body: schema1, query: schema2 }), handler);
 */
export function validateAll<
  TBody = unknown,
  TQuery = unknown,
  THeaders = unknown
>(schemas: {
  body?: ZodSchema<TBody>;
  query?: ZodSchema<TQuery>;
  headers?: ZodSchema<THeaders>;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: Array<{ section: string; details: Array<{ field: string; message: string; code: string }> }> = [];

    // Validate body
    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        errors.push({
          section: "body",
          details: result.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
            code: i.code,
          })),
        });
      } else {
        req.body = result.data;
      }
    }

    // Validate query
    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        errors.push({
          section: "query",
          details: result.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
            code: i.code,
          })),
        });
      } else {
        (req as Request & { validatedQuery: TQuery }).validatedQuery = result.data;
      }
    }

    // Validate headers
    if (schemas.headers) {
      const result = schemas.headers.safeParse(req.headers);
      if (!result.success) {
        errors.push({
          section: "headers",
          details: result.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
            code: i.code,
          })),
        });
      } else {
        (req as Request & { validatedHeaders: THeaders }).validatedHeaders = result.data;
      }
    }

    if (errors.length > 0) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed across multiple sections",
          details: errors,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    next();
  };
}
