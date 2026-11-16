/**
 * Vault Registry Routes — Issue #310 / #942
 *
 * Endpoints for managing vault contract registrations.
 *
 * Public read (no auth):
 *   GET  /api/v1/vaults           — paginated list of all active vaults
 *   GET  /api/v1/vaults/:id       — single vault by ID
 *
 * Admin-only write (require authenticateAdmin):
 *   POST   /api/v1/vaults         — register a new vault
 *   PUT    /api/v1/vaults/:id     — full update of vault metadata (Issue #942)
 *   PATCH  /api/v1/vaults/:id     — partial update of vault metadata
 *   DELETE /api/v1/vaults/:id     — deactivate a vault
 *
 * Changes in Issue #942:
 *   - GET list now paginated via ?page= & ?pageSize= query params
 *   - Each vault record includes tvl and apy fields
 *   - Write endpoints switched from authenticate → authenticateAdmin
 *   - PUT alias added alongside PATCH
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  listVaults,
  getVaultById,
  createVault,
  updateVault,
  deactivateVault,
} from "../services/vaultRegistryService.js";
import { successResponse, errorResponse, paginatedResponse } from "../dto/index.js";
import { authenticateAdmin } from "../middleware/adminMiddleware.js";
import { logger } from "../logger.js";

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
  tvl: z.string().regex(/^\d+$/, "tvl must be a non-negative integer string").optional(),
  apy: z.string().regex(/^\d+(\.\d+)?$/, "apy must be a non-negative decimal string").optional(),
});

const updateVaultSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  underlying_token: z.string().min(1).max(256).optional(),
  network: z.enum(["testnet", "mainnet", "futurenet"]).optional(),
  description: z.string().max(512).optional(),
  is_active: z.boolean().optional(),
  is_default: z.boolean().optional(),
  tvl: z.string().regex(/^\d+$/, "tvl must be a non-negative integer string").optional(),
  apy: z.string().regex(/^\d+(\.\d+)?$/, "apy must be a non-negative decimal string").optional(),
});

const paginationSchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? Math.max(1, parseInt(v, 10)) : 1)),
  pageSize: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(100, Math.max(1, parseInt(v, 10))) : 20)),
  network: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Public: list vaults (paginated)
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/vaults
 *
 * Query params:
 *   page     — 1-based page number (default: 1)
 *   pageSize — results per page (default: 20, max: 100)
 *   network  — optional filter: testnet | mainnet | futurenet
 *
 * Response: PaginatedResponse<VaultRecord>
 */
vaultRegistryRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid pagination params"));
    return;
  }

  const { page, pageSize, network } = parsed.data;

  try {
    const { vaults, total } = await listVaults(page, pageSize, network);
    res.json(paginatedResponse(vaults, page, pageSize, total));
  } catch (err) {
    logger.error("[vaults/list]", { err });
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
    logger.error("[vaults/get]", { err });
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to retrieve vault"));
  }
});

// ---------------------------------------------------------------------------
// Admin: write operations (require authenticateAdmin)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/vaults
 * Register a new vault contract in the registry.
 */
vaultRegistryRouter.post("/", authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  const parsed = createVaultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input"));
    return;
  }

  try {
    const vault = await createVault(parsed.data);
    res.status(201).json(successResponse(vault));
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      res.status(409).json(errorResponse("CONFLICT", "A vault with this contract_id already exists"));
      return;
    }
    logger.error("[vaults/create]", { err });
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to register vault"));
  }
});

/**
 * PUT /api/v1/vaults/:id
 * Full update of vault metadata (Issue #942 — PUT alias for PATCH).
 *
 * Semantically the same as PATCH in this context: fields not included in the
 * body are left unchanged (partial updates are supported by both verbs here).
 */
vaultRegistryRouter.put("/:id", authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
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
    logger.error("[vaults/put]", { err });
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to update vault"));
  }
});

/**
 * PATCH /api/v1/vaults/:id
 * Partial update of vault metadata.
 */
vaultRegistryRouter.patch("/:id", authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
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
    logger.error("[vaults/update]", { err });
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to update vault"));
  }
});

/**
 * DELETE /api/v1/vaults/:id
 * Soft-deactivate a vault. Historical data is preserved.
 */
vaultRegistryRouter.delete("/:id", authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
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
    logger.error("[vaults/deactivate]", { err });
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to deactivate vault"));
  }
});
