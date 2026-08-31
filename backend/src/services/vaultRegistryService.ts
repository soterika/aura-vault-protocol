/**
 * Vault Registry Service — Issue #310
 *
 * Manages the registry of vault contract instances.
 * Provides CRUD operations for vaults and resolution of the default vault
 * for backwards-compatible API requests that omit vaultId.
 */

import { getWritePool, getReadPool } from "../db.js";
import { cacheGet, cacheSet, cacheDel } from "../cache.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultRecord {
  id: number;
  contract_id: string;
  name: string;
  underlying_token: string;
  network: string;
  is_active: boolean;
  is_default: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateVaultInput {
  contract_id: string;
  name: string;
  underlying_token: string;
  network?: string;
  description?: string;
  is_default?: boolean;
}

export interface UpdateVaultInput {
  name?: string;
  underlying_token?: string;
  network?: string;
  description?: string;
  is_active?: boolean;
  is_default?: boolean;
}

// ---------------------------------------------------------------------------
// Cache configuration
// ---------------------------------------------------------------------------

const VAULT_CACHE_NS = "vault:registry";
const VAULT_LIST_KEY = "list:active";
const VAULT_DEFAULT_KEY = "default";
const VAULT_TTL_SECS = 300; // 5 minutes

function vaultCacheKey(id: number | string): string {
  return `id:${id}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function invalidateVaultCache(id?: number): Promise<void> {
  await cacheDel(VAULT_CACHE_NS, VAULT_LIST_KEY);
  await cacheDel(VAULT_CACHE_NS, VAULT_DEFAULT_KEY);
  if (id !== undefined) {
    await cacheDel(VAULT_CACHE_NS, vaultCacheKey(id));
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List all active vaults, optionally filtered by network.
 */
export async function listVaults(network?: string): Promise<VaultRecord[]> {
  const cacheKey = `${VAULT_LIST_KEY}${network ? `:${network}` : ""}`;
  const cached = await cacheGet<VaultRecord[]>(VAULT_CACHE_NS, cacheKey);
  if (cached) return cached;

  const db = getReadPool();
  const params: unknown[] = [];
  let sql = "SELECT * FROM vaults WHERE is_active = TRUE";
  if (network) {
    params.push(network);
    sql += ` AND network = $${params.length}`;
  }
  sql += " ORDER BY is_default DESC, created_at ASC";

  const { rows } = await db.query<VaultRecord>(sql, params);
  await cacheSet(VAULT_CACHE_NS, cacheKey, rows, VAULT_TTL_SECS);
  return rows;
}

/**
 * Get a vault by its integer ID.
 */
export async function getVaultById(id: number): Promise<VaultRecord | null> {
  const cached = await cacheGet<VaultRecord>(VAULT_CACHE_NS, vaultCacheKey(id));
  if (cached) return cached;

  const db = getReadPool();
  const { rows } = await db.query<VaultRecord>(
    "SELECT * FROM vaults WHERE id = $1",
    [id]
  );
  const vault = rows[0] ?? null;
  if (vault) await cacheSet(VAULT_CACHE_NS, vaultCacheKey(id), vault, VAULT_TTL_SECS);
  return vault;
}

/**
 * Get a vault by its contract address.
 */
export async function getVaultByContractId(contractId: string): Promise<VaultRecord | null> {
  const db = getReadPool();
  const { rows } = await db.query<VaultRecord>(
    "SELECT * FROM vaults WHERE contract_id = $1",
    [contractId]
  );
  return rows[0] ?? null;
}

/**
 * Get the default vault (backwards-compatible single-vault behaviour).
 * Returns the vault marked is_default = TRUE, or the first active vault
 * if none is explicitly marked as default.
 */
export async function getDefaultVault(): Promise<VaultRecord | null> {
  const cached = await cacheGet<VaultRecord>(VAULT_CACHE_NS, VAULT_DEFAULT_KEY);
  if (cached) return cached;

  const db = getReadPool();
  const { rows } = await db.query<VaultRecord>(
    "SELECT * FROM vaults WHERE is_active = TRUE ORDER BY is_default DESC, created_at ASC LIMIT 1"
  );
  const vault = rows[0] ?? null;
  if (vault) await cacheSet(VAULT_CACHE_NS, VAULT_DEFAULT_KEY, vault, VAULT_TTL_SECS);
  return vault;
}

/**
 * Resolve a vault from an optional vaultId query parameter.
 * Falls back to the default vault when vaultId is not provided.
 */
export async function resolveVault(vaultId?: string | number): Promise<VaultRecord | null> {
  if (vaultId === undefined || vaultId === null || vaultId === "") {
    return getDefaultVault();
  }
  const id = typeof vaultId === "string" ? parseInt(vaultId, 10) : vaultId;
  if (isNaN(id)) return null;
  return getVaultById(id);
}

// ---------------------------------------------------------------------------
// Mutations (admin operations)
// ---------------------------------------------------------------------------

/**
 * Register a new vault in the registry.
 */
export async function createVault(input: CreateVaultInput): Promise<VaultRecord> {
  const db = getWritePool();

  // If this vault is being set as default, unset the current default first
  if (input.is_default) {
    await db.query("UPDATE vaults SET is_default = FALSE WHERE is_default = TRUE");
  }

  const { rows } = await db.query<VaultRecord>(
    `INSERT INTO vaults (contract_id, name, underlying_token, network, is_active, is_default, description)
     VALUES ($1, $2, $3, $4, TRUE, $5, $6)
     RETURNING *`,
    [
      input.contract_id,
      input.name,
      input.underlying_token,
      input.network ?? "testnet",
      input.is_default ?? false,
      input.description ?? null,
    ]
  );

  await invalidateVaultCache();
  return rows[0]!;
}

/**
 * Update vault metadata. Admin-only.
 */
export async function updateVault(id: number, input: UpdateVaultInput): Promise<VaultRecord | null> {
  const db = getWritePool();

  // If setting a new default, unset the current one
  if (input.is_default) {
    await db.query("UPDATE vaults SET is_default = FALSE WHERE is_default = TRUE AND id != $1", [id]);
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const allowedFields: Array<keyof UpdateVaultInput> = [
    "name", "underlying_token", "network", "description", "is_active", "is_default"
  ];

  for (const key of allowedFields) {
    const val = input[key];
    if (val !== undefined) {
      fields.push(`${key} = $${idx++}`);
      values.push(val);
    }
  }

  if (fields.length === 0) return getVaultById(id);

  values.push(id);
  const { rows } = await db.query<VaultRecord>(
    `UPDATE vaults SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );

  await invalidateVaultCache(id);
  return rows[0] ?? null;
}

/**
 * Deactivate a vault (soft-delete). Does not remove historical data.
 */
export async function deactivateVault(id: number): Promise<VaultRecord | null> {
  return updateVault(id, { is_active: false });
}
