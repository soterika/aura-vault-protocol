/**
 * Tests for Vault Registry Routes — Issue #942
 *
 * Covers:
 *   - GET /api/v1/vaults returns paginated response
 *   - GET /api/v1/vaults/:id returns a vault by ID
 *   - POST /api/v1/vaults requires admin auth (403 without token)
 *   - PUT /api/v1/vaults/:id requires admin auth
 *   - PATCH /api/v1/vaults/:id requires admin auth
 *   - DELETE /api/v1/vaults/:id requires admin auth
 *   - VaultRecord shape includes tvl, apy, last_synced_at
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { vaultRegistryRouter } from "./vaultRegistryRoutes.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../services/vaultRegistryService.js", () => {
  const vault = {
    id: 1,
    contract_id: "CAURA_VAULT_TEST",
    name: "Test Vault",
    underlying_token: "CAURA_TOKEN_TEST",
    network: "testnet",
    is_active: true,
    is_default: true,
    description: null,
    tvl: "1000000",
    apy: "0.05",
    last_synced_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  return {
    listVaults: vi.fn().mockResolvedValue({
      vaults: [vault],
      total: 1,
      page: 1,
      pageSize: 20,
    }),
    getVaultById: vi.fn().mockImplementation((id: number) =>
      id === 1 ? Promise.resolve(vault) : Promise.resolve(null)
    ),
    createVault: vi.fn().mockResolvedValue(vault),
    updateVault: vi.fn().mockImplementation((id: number) =>
      id === 1 ? Promise.resolve(vault) : Promise.resolve(null)
    ),
    deactivateVault: vi.fn().mockResolvedValue(vault),
  };
});

vi.mock("../middleware/adminMiddleware.js", () => ({
  authenticateAdmin: vi.fn((req: any, res: any, next: any) => {
    // Simulate: only allow if Authorization: Bearer admin-token
    if (req.headers.authorization === "Bearer admin-token") {
      req.user = { sub: "admin", tier: "admin" };
      next();
    } else {
      res.status(403).json({ error: "Admin access required" });
    }
  }),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use("/api/v1/vaults", vaultRegistryRouter);

// ---------------------------------------------------------------------------
// GET /api/v1/vaults — paginated list
// ---------------------------------------------------------------------------

describe("GET /api/v1/vaults", () => {
  it("returns a paginated response with vaults array", async () => {
    const res = await request(app).get("/api/v1/vaults");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.total).toBe(1);
  });

  it("passes page and pageSize to service", async () => {
    const { listVaults } = await import("../services/vaultRegistryService.js");
    await request(app).get("/api/v1/vaults?page=2&pageSize=10");
    expect(listVaults).toHaveBeenCalledWith(2, 10, undefined);
  });

  it("passes network filter to service", async () => {
    const { listVaults } = await import("../services/vaultRegistryService.js");
    await request(app).get("/api/v1/vaults?network=mainnet");
    expect(listVaults).toHaveBeenCalledWith(1, 20, "mainnet");
  });

  it("vault records include tvl, apy, last_synced_at fields", async () => {
    const res = await request(app).get("/api/v1/vaults");
    const vault = res.body.data[0];
    expect(vault).toHaveProperty("tvl");
    expect(vault).toHaveProperty("apy");
    expect(vault).toHaveProperty("last_synced_at");
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/vaults/:id
// ---------------------------------------------------------------------------

describe("GET /api/v1/vaults/:id", () => {
  it("returns the vault for a valid ID", async () => {
    const res = await request(app).get("/api/v1/vaults/1");
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
    expect(res.body.data.tvl).toBe("1000000");
  });

  it("returns 404 for unknown ID", async () => {
    const res = await request(app).get("/api/v1/vaults/999");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 for non-numeric ID", async () => {
    const res = await request(app).get("/api/v1/vaults/abc");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/vaults — admin only
// ---------------------------------------------------------------------------

describe("POST /api/v1/vaults", () => {
  const validBody = {
    contract_id: "CNEW_VAULT",
    name: "New Vault",
    underlying_token: "CTOKEN",
  };

  it("rejects unauthenticated request with 403", async () => {
    const res = await request(app).post("/api/v1/vaults").send(validBody);
    expect(res.status).toBe(403);
  });

  it("creates vault with valid admin token", async () => {
    const res = await request(app)
      .post("/api/v1/vaults")
      .set("Authorization", "Bearer admin-token")
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contract_id).toBe("CAURA_VAULT_TEST");
  });

  it("rejects body with missing required fields", async () => {
    const res = await request(app)
      .post("/api/v1/vaults")
      .set("Authorization", "Bearer admin-token")
      .send({ name: "No contract" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/v1/vaults/:id — admin only (Issue #942)
// ---------------------------------------------------------------------------

describe("PUT /api/v1/vaults/:id", () => {
  it("rejects unauthenticated request with 403", async () => {
    const res = await request(app).put("/api/v1/vaults/1").send({ name: "Updated" });
    expect(res.status).toBe(403);
  });

  it("updates vault with valid admin token", async () => {
    const res = await request(app)
      .put("/api/v1/vaults/1")
      .set("Authorization", "Bearer admin-token")
      .send({ name: "Updated Vault", tvl: "9999999" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 404 for unknown ID via PUT", async () => {
    const { updateVault } = await import("../services/vaultRegistryService.js");
    vi.mocked(updateVault).mockResolvedValueOnce(null);
    const res = await request(app)
      .put("/api/v1/vaults/999")
      .set("Authorization", "Bearer admin-token")
      .send({ name: "Gone" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/vaults/:id — admin only
// ---------------------------------------------------------------------------

describe("PATCH /api/v1/vaults/:id", () => {
  it("rejects unauthenticated request with 403", async () => {
    const res = await request(app).patch("/api/v1/vaults/1").send({ name: "x" });
    expect(res.status).toBe(403);
  });

  it("partially updates vault with valid admin token", async () => {
    const res = await request(app)
      .patch("/api/v1/vaults/1")
      .set("Authorization", "Bearer admin-token")
      .send({ apy: "0.08" });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/vaults/:id — admin only
// ---------------------------------------------------------------------------

describe("DELETE /api/v1/vaults/:id", () => {
  it("rejects unauthenticated request with 403", async () => {
    const res = await request(app).delete("/api/v1/vaults/1");
    expect(res.status).toBe(403);
  });

  it("deactivates vault with valid admin token", async () => {
    const res = await request(app)
      .delete("/api/v1/vaults/1")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe("Vault deactivated");
  });
});
