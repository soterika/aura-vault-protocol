import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import portfolioRouter, { clearPortfolioCache } from "./portfolio.js";
import { generateTokens } from "./auth.js";

function createTestApp() {
  const app = express();

  app.use(express.json());

  app.use("/api/v1/user/portfolio", async (req, res, next) => {
    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing token" });
      return;
    }

    const token = header.slice(7);

    const { validateAccessToken } = await import("./auth.js");
    const user = await validateAccessToken(token);

    if (!user) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    (req as any).user = user;
    next();
  }, portfolioRouter);

  return app;
}

describe("User Portfolio API", () => {
  let app: express.Express;
  let accessToken: string;

  beforeEach(async () => {
    clearPortfolioCache();
    app = createTestApp();

    const tokens = await generateTokens(
      "test-user-001",
      "test-device-001",
      "free"
    );

    accessToken = tokens.accessToken;
  });

  afterEach(() => {
    // Cache is intentionally allowed to expire naturally.
  });

  it("rejects requests without authentication", async () => {
    const response = await request(app)
      .get("/api/v1/user/portfolio");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Missing token");
  });

  it("rejects requests with an invalid token", async () => {
    const response = await request(app)
      .get("/api/v1/user/portfolio")
      .set("Authorization", "Bearer invalid-token");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid or expired token");
  });

  it("returns the authenticated user's portfolio", async () => {
    const response = await request(app)
      .get("/api/v1/user/portfolio")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);

    expect(response.body.userId).toBe("test-user-001");
    expect(response.body.totalBalance).toBe("1050");
    expect(response.body.positions).toHaveLength(1);

    expect(response.body.positions[0]).toMatchObject({
      shares: "1000",
      underlyingBalance: "1050",
      apy: 8.5,
      yieldEarned: "50",
    });
  });

  it("uses pagination defaults", async () => {
    const response = await request(app)
      .get("/api/v1/user/portfolio")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);

    expect(response.body.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 1,
    });
  });

  it("accepts pagination parameters", async () => {
    const response = await request(app)
      .get("/api/v1/user/portfolio?page=1&pageSize=1")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);

    expect(response.body.pagination).toEqual({
      page: 1,
      pageSize: 1,
      total: 1,
    });
  });

  it("returns cache MISS on first request and HIT on second request", async () => {
    const first = await request(app)
      .get("/api/v1/user/portfolio")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(first.status).toBe(200);
    expect(first.headers["x-cache"]).toBe("MISS");

    const second = await request(app)
      .get("/api/v1/user/portfolio")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(second.status).toBe(200);
    expect(second.headers["x-cache"]).toBe("HIT");

    expect(second.body).toEqual(first.body);
  });

  it("returns different cache entries for different pagination parameters", async () => {
    const first = await request(app)
      .get("/api/v1/user/portfolio?page=1&pageSize=20")
      .set("Authorization", `Bearer ${accessToken}`);

    const second = await request(app)
      .get("/api/v1/user/portfolio?page=1&pageSize=10")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    expect(first.body.pagination.pageSize).toBe(20);
    expect(second.body.pagination.pageSize).toBe(10);
  });
});