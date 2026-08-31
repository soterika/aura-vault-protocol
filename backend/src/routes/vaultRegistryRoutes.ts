/**
 * Vault Registry Routes — Issue #310
 *
 * Admin endpoints for managing vault contract registrations.
 * All write endpoints require authentication and admin role.
 *
 * GET  /api/v1/vaults              — list all active vaults
 * GET  /api/v1/vaults/:id          — get a single vault by ID
 * POST /api/v1/vaults              — register a new vault (admin)
 * PATCH /api/v1/vaults/:id         — update vault metadata (admin)
 * DELETE /api/v1/vaults/:id        — deactivate a vault (admin)
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  listVaults,
  getVaultById,
  createVault,
  updateVault,
  deactivateVault,
} from "../services/vaultRegistryService.js";
import { successResponse, errorResponse } from "../dto/index.js";
import { authenticate } from "../middleware/authMiddleware.js";

export const vaultRegistryRouter = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createVaultSchema = z.object({
  contract_id: z.string().min(1).max(256),
  name: z.string().min(1).max(128),
  underlying_token: z.string().min(1).max(256),
  network: z.enum(["testnet", "mainnet", "futurenet"]).optional().default("testnet"),
  description: z.string().max(512).optional(),
  is_default: z.boolean().optional().default(false),
});

const updateVaultSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  underlying_token: z.string().min(1).max(256).optional(),
  network: z.enum(["testnet", "mainnet", "futurenet"]).optional(),
  description: z.string().max(512).optional(),
  is_active: z.boolean().optional(),
  is_default: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Public: list vaults
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/vaults
 * Returns all active vaults, optionally filtered by ?network=testnet|mainnet
 */
vaultRegistryRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const network = typeof req.query.network === "string" ? req.query.network : undefined;
    const vaults = await listVaults(network);
    res.json(successResponse(vaults));
  } catch (err) {
    console.error("[vaults/list]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to list vaults"));
  }
});

/**
 * GET /api/v1/vaults/:id
 * Returns a single vault by ID (including inactive, for admin visibility).
 */
vaultRegistryRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json(errorResponse("INVALID_PARAM", "Invalid vault ID"));
    return;
  }

  try {
    const vault = await getVaultById(id);
    if (!vault) {
      res.status(404).json(errorResponse("NOT_FOUND", "Vault not found"));
      return;
    }
    res.json(successResponse(vault));
  } catch (err) {
    console.error("[vaults/get]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to retrieve vault"));
  }
});

// ---------------------------------------------------------------------------
// Admin: write operations (require authentication)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/vaults
 * Register a new vault contract in the registry.
 */
vaultRegistryRouter.post("/", authenticate, async (req: Request, res: Response): Promise<void> => {
  const parsed = createVaultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input"));
    return;
  }

  try {
    const vault = await createVault(parsed.data);
    res.status(201).json(successResponse(vault));
  } catch (err: unknown) {
    // Unique constraint on contract_id
    if (err instanceof Error && err.message.includes("unique")) {
      res.status(409).json(errorResponse("CONFLICT", "A vault with this contract_id already exists"));
      return;
    }
    console.error("[vaults/create]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to register vault"));
  }
});

/**
 * PATCH /api/v1/vaults/:id
 * Update vault metadata.
 */
vaultRegistryRouter.patch("/:id", authenticate, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json(errorResponse("INVALID_PARAM", "Invalid vault ID"));
    return;
  }

  const parsed = updateVaultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input"));
    return;
  }

  try {
    const vault = await updateVault(id, parsed.data);
    if (!vault) {
      res.status(404).json(errorResponse("NOT_FOUND", "Vault not found"));
      return;
    }
    res.json(successResponse(vault));
  } catch (err) {
    console.error("[vaults/update]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to update vault"));
  }
});

/**
 * DELETE /api/v1/vaults/:id
 * Soft-deactivate a vault. Historical data is preserved.
 */
vaultRegistryRouter.delete("/:id", authenticate, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json(errorResponse("INVALID_PARAM", "Invalid vault ID"));
    return;
  }

  try {
    const vault = await deactivateVault(id);
    if (!vault) {
      res.status(404).json(errorResponse("NOT_FOUND", "Vault not found"));
      return;
    }
    res.json(successResponse({ message: "Vault deactivated", vault }));
  } catch (err) {
    console.error("[vaults/deactivate]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to deactivate vault"));
  }
});
