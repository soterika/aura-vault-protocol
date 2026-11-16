/**
 * Centralised Zod validation schemas for Stellar addresses.
 * Import these schemas in any route that accepts a user wallet address.
 */

import { z } from "zod";
import {
  stellarAddressRefine,
  INVALID_STELLAR_ADDRESS_MESSAGE,
} from "./stellarAddress.js";

/**
 * Zod schema for a single Stellar user address (G-address only).
 * Rejects empty strings, non-base32 characters, wrong checksums,
 * and contract addresses (C-addresses).
 */
export const stellarAddressSchema = z
  .string()
  .min(1, "Stellar address is required")
  .refine(stellarAddressRefine, INVALID_STELLAR_ADDRESS_MESSAGE);

/**
 * Schema for request bodies that include a walletAddress field.
 */
export const walletAddressBodySchema = z.object({
  walletAddress: stellarAddressSchema,
});

/**
 * Schema for route params that include an :address field.
 */
export const addressParamSchema = z.object({
  address: stellarAddressSchema,
});
