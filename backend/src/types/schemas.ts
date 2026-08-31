/**
 * Centralized Zod validation schemas — Issue #867
 * 
 * Comprehensive request validation schemas for all API endpoints.
 * Schemas are shared between backend validation and frontend code generation.
 * 
 * Validation rules:
 * - Stellar addresses validated with StrKey.isValidEd25519PublicKey
 * - Amounts validated as positive integers (in stroops/base units)
 * - Pagination parameters with sensible bounds
 * - 400 response with structured error details on validation failure
 */

import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";

// ─────────────────────────────────────────────────────────────────────────────
// Base Schemas — Reusable Primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a Stellar public key (G-address format).
 * Uses StrKey.isValidEd25519PublicKey for RFC 4648 base32 compliance.
 */
export const stellarAddressSchema = z
  .string({ required_error: "Stellar address is required" })
  .min(56, "Stellar address must be 56 characters")
  .max(56, "Stellar address must be 56 characters")
  .refine(
    (addr) => StrKey.isValidEd25519PublicKey(addr),
    "Invalid Stellar address format. Must start with 'G' and be a valid public key."
  );

/**
 * Validates a positive amount in stroops (base units).
 * Amounts must be positive integers for on-chain compatibility.
 */
export const amountSchema = z
  .number({ required_error: "Amount is required" })
  .int("Amount must be an integer (expressed in stroops/base units)")
  .positive("Amount must be greater than 0")
  .max(Number.MAX_SAFE_INTEGER, "Amount exceeds maximum value");

/**
 * Validates a decimal string representation of an amount.
 * Used for user-facing amounts with up to 7 decimal places (Stellar asset limit).
 * Examples: "1000", "1000.50", "0.0000001"
 */
export const decimalAmountSchema = z
  .string({ required_error: "Amount is required" })
  .regex(
    /^[0-9]+(\.[0-9]{1,7})?$/,
    "Amount must be a non-negative number with up to 7 decimal places"
  )
  .refine(
    (val) => parseFloat(val) > 0,
    "Amount must be greater than 0"
  );

/**
 * Validates pagination parameters.
 */
export const paginationSchema = z.object({
  page: z
    .number()
    .int("Page must be an integer")
    .min(1, "Page must be at least 1")
    .default(1),
  pageSize: z
    .number()
    .int("Page size must be an integer")
    .min(1, "Page size must be at least 1")
    .max(100, "Page size cannot exceed 100")
    .default(20),
});

/**
 * Validates an ISO 8601 datetime string.
 */
export const isoDatetimeSchema = z
  .string()
  .datetime({ message: "Must be a valid ISO 8601 datetime (e.g., 2025-01-15T10:30:00Z)" });

/**
 * Validates a UUID v4.
 */
export const uuidSchema = z
  .string()
  .uuid("Must be a valid UUID v4");

// ─────────────────────────────────────────────────────────────────────────────
// Authentication Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const authLoginSchema = z.object({
  walletAddress: stellarAddressSchema,
  deviceId: z
    .string()
    .max(128, "Device ID too long")
    .optional(),
  tier: z
    .enum(["free", "paid"])
    .default("free")
    .optional(),
});

export const authRefreshSchema = z.object({
  refreshToken: z
    .string({ required_error: "Refresh token is required" })
    .min(1, "Refresh token is required"),
});

export const authLogoutSchema = z.object({
  refreshToken: z
    .string()
    .optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Vault Transaction Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const vaultDepositSchema = z.object({
  signedXdr: z
    .string({ required_error: "Signed transaction XDR is required" })
    .min(1, "Signed XDR is required"),
  address: stellarAddressSchema,
});

export const vaultWithdrawSchema = z.object({
  signedXdr: z
    .string({ required_error: "Signed transaction XDR is required" })
    .min(1, "Signed XDR is required"),
  address: stellarAddressSchema,
  shares: decimalAmountSchema,
});

export const vaultHarvestSchema = z.object({
  signedXdr: z
    .string({ required_error: "Signed transaction XDR is required" })
    .min(1, "Signed XDR is required"),
  yieldAmount: decimalAmountSchema,
});

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio & Analytics Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const portfolioPaginationSchema = paginationSchema;

export const portfolioPositionSchema = z.object({
  id: z.string().optional(),
  amount: amountSchema,
  entryPrice: z.number().nonnegative().optional(),
});

export const portfolioSourceSchema = z.object({
  id: z.string().optional(),
  apy: z
    .number({ required_error: "APY is required" })
    .min(0, "APY cannot be negative")
    .max(100, "APY cannot exceed 100"),
});

export const yieldCalculateSchema = z.object({
  positions: z
    .array(portfolioPositionSchema, {
      required_error: "Positions array is required",
      invalid_type_error: "Positions must be an array",
    })
    .min(1, "At least one position is required"),
  sources: z
    .array(portfolioSourceSchema, {
      required_error: "Sources array is required",
      invalid_type_error: "Sources must be an array",
    })
    .min(1, "At least one source is required"),
  calcDate: isoDatetimeSchema.optional(),
});

export const backfillSchema = z.object({
  positions: z
    .array(
      z.object({ id: z.string().optional() }),
      { required_error: "Positions array is required" }
    )
    .min(1, "At least one position is required"),
  sources: z
    .array(
      z.object({ id: z.string().optional() }),
      { required_error: "Sources array is required" }
    )
    .min(1, "At least one source is required"),
  startDate: isoDatetimeSchema,
  endDate: isoDatetimeSchema,
});

// ─────────────────────────────────────────────────────────────────────────────
// Vault Stats & Query Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const vaultStatsQuerySchema = z.object({
  vaultId: z
    .string()
    .optional()
    .refine((val) => !val || /^\d+$/.test(val), "Vault ID must be a numeric ID"),
});

export const depositSimulateSchema = z.object({
  amount: amountSchema.describe("Amount in stroops to simulate depositing"),
});

// ─────────────────────────────────────────────────────────────────────────────
// User Preferences Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const userPreferencesSchema = z.object({
  emailNotifications: z
    .boolean()
    .default(true)
    .optional(),
  pushNotifications: z
    .boolean()
    .default(true)
    .optional(),
  language: z
    .enum(["en", "es", "fr", "de", "ja", "zh"])
    .default("en")
    .optional(),
  currency: z
    .enum(["USD", "EUR", "GBP", "JPY", "CNY"])
    .default("USD")
    .optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Email Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const emailSendSchema = z.object({
  to: z
    .string({ required_error: "Recipient email is required" })
    .email("Invalid email address"),
  subject: z
    .string({ required_error: "Subject is required" })
    .min(1, "Subject cannot be empty")
    .max(255, "Subject too long"),
  templateId: z
    .string({ required_error: "Template ID is required" })
    .min(1, "Template ID is required"),
  context: z
    .record(z.any())
    .optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Queue Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const queueJobSchema = z.object({
  jobType: z
    .string({ required_error: "Job type is required" })
    .min(1, "Job type is required"),
  data: z
    .record(z.any())
    .optional(),
  priority: z
    .enum(["low", "normal", "high"])
    .default("normal")
    .optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Query Parameter Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const queryPaginationSchema = z.object({
  page: z
    .string()
    .default("1")
    .pipe(z.coerce.number().int().min(1)),
  pageSize: z
    .string()
    .default("20")
    .pipe(z.coerce.number().int().min(1).max(100)),
});

export const queryDateRangeSchema = z.object({
  startDate: isoDatetimeSchema.optional(),
  endDate: isoDatetimeSchema.optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Type Exports — Zod inferred types for strong typing
// ─────────────────────────────────────────────────────────────────────────────

export type StellarAddress = z.infer<typeof stellarAddressSchema>;
export type Amount = z.infer<typeof amountSchema>;
export type DecimalAmount = z.infer<typeof decimalAmountSchema>;
export type Pagination = z.infer<typeof paginationSchema>;

export type AuthLoginInput = z.infer<typeof authLoginSchema>;
export type AuthRefreshInput = z.infer<typeof authRefreshSchema>;
export type AuthLogoutInput = z.infer<typeof authLogoutSchema>;

export type VaultDepositInput = z.infer<typeof vaultDepositSchema>;
export type VaultWithdrawInput = z.infer<typeof vaultWithdrawSchema>;
export type VaultHarvestInput = z.infer<typeof vaultHarvestSchema>;

export type PortfolioPaginationInput = z.infer<typeof portfolioPaginationSchema>;
export type YieldCalculateInput = z.infer<typeof yieldCalculateSchema>;
export type BackfillInput = z.infer<typeof backfillSchema>;

export type VaultStatsQueryInput = z.infer<typeof vaultStatsQuerySchema>;
export type DepositSimulateInput = z.infer<typeof depositSimulateSchema>;

export type UserPreferencesInput = z.infer<typeof userPreferencesSchema>;

export type EmailSendInput = z.infer<typeof emailSendSchema>;

export type QueueJobInput = z.infer<typeof queueJobSchema>;

export type QueryPagination = z.infer<typeof queryPaginationSchema>;
export type QueryDateRange = z.infer<typeof queryDateRangeSchema>;
