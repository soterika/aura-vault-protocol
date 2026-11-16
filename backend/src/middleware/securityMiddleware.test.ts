import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Application } from "express";
import request from "supertest";
import { applySecurityHeaders, corsOptions } from "./securityMiddleware.js";
import { correlationIdMiddleware } from "../logger.js";
import { validate, loginSchema, refreshSchema } from "../validation.js";

// ── Security Headers (Helmet) ─────────────────────────────────────────────────

describe("applySecurityHeaders", () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    applySecurityHeaders(app);
    app.get("/test", (_req, res) => res.json({ ok: true }));
  });

  it("sets X-Content-Type-Options: nosniff", async () => {
    const res = await request(app).get("/test");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options: DENY", async () => {
    const res = await request(app).get("/test");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("sets Strict-Transport-Security with 2 year max-age", async () => {
    const res = await request(app).get("/test");
    const hsts = res.headers["strict-transport-security"] as string;
    expect(hsts).toContain("max-age=63072000");
    expect(hsts).toContain("includeSubDomains");
  });

  it("sets Strict-Transport-Security with preload directive", async () => {
    const res = await request(app).get("/test");
    const hsts = res.headers["strict-transport-security"] as string;
    expect(hsts).toContain("preload");
  });

  it("sets Referrer-Policy: strict-origin-when-cross-origin", async () => {
    const res = await request(app).get("/test");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("sets Content-Security-Policy", async () => {
    const res = await request(app).get("/test");
    expect(res.headers["content-security-policy"]).toBeDefined();
  });

  it("removes X-Powered-By", async () => {
    const res = await request(app).get("/test");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("sets Permissions-Policy", async () => {
    const res = await request(app).get("/test");
    expect(res.headers["permissions-policy"]).toContain("camera=()");
  });
});

// ── CORS ──────────────────────────────────────────────────────────────────────

describe("corsOptions", () => {
  it("allows a valid origin", () => {
    process.env.CORS_ORIGIN = "https://app.aura-vault.xyz";
    const origin = "https://app.aura-vault.xyz";
    let result: boolean | undefined;
    if (typeof corsOptions.origin === "function") {
      corsOptions.origin(origin, (err: unknown, allow: unknown) => {
        result = allow as boolean | undefined;
      });
    } else {
      throw new Error("corsOptions.origin is not a function");
    }
    expect(result).toBe(true);
    delete process.env.CORS_ORIGIN;
  });

  it("rejects an origin not in the allowlist", () => {
    process.env.CORS_ORIGIN = "https://app.aura-vault.xyz";
    let err: Error | null = null;
    (corsOptions.origin as Function)("https://evil.example.com", (e: unknown) => {
      err = e as Error;
    });
    expect(err).toBeInstanceOf(Error);
    delete process.env.CORS_ORIGIN;
  });
});

// ── Correlation ID Middleware ──────────────────────────────────────────────────

describe("correlationIdMiddleware", () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    app.use(correlationIdMiddleware());
    app.get("/test", (req, res) => res.json({ correlationId: req.correlationId }));
  });

  it("generates a correlationId and echoes it in response header", async () => {
    const res = await request(app).get("/test");
    const cid = res.headers["x-correlation-id"];
    expect(cid).toBeDefined();
    expect(cid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(res.body.correlationId).toBe(cid);
  });

  it("propagates incoming X-Correlation-ID header", async () => {
    const incomingId = "test-correlation-id-123";
    const res = await request(app)
      .get("/test")
      .set("X-Correlation-ID", incomingId);
    expect(res.headers["x-correlation-id"]).toBe(incomingId);
    expect(res.body.correlationId).toBe(incomingId);
  });
});

// ── Zod Validation Middleware ─────────────────────────────────────────────────

describe("validate(loginSchema)", () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.post("/login", validate(loginSchema), (req, res) =>
      res.json({ received: req.body })
    );
  });

  it("passes valid Stellar wallet address", async () => {
    const walletAddress = "G".padEnd(56, "A"); // 56-char Stellar-style address
    const res = await request(app)
      .post("/login")
      .send({ walletAddress });
    expect(res.status).toBe(200);
    expect(res.body.received.walletAddress).toBe(walletAddress);
  });

  it("rejects missing walletAddress with 400", async () => {
    const res = await request(app)
      .post("/login")
      .send({ tier: "free" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/walletAddress/i);
    expect(res.body.details[0].field).toBe("walletAddress");
  });

  it("strips unknown fields from body", async () => {
    const walletAddress = "G".padEnd(56, "A");
    const res = await request(app)
      .post("/login")
      .send({ walletAddress, maliciousField: "DROP TABLE users;" });
    expect(res.status).toBe(200);
    expect(res.body.received.maliciousField).toBeUndefined();
  });

  it("defaults tier to 'free' when omitted", async () => {
    const walletAddress = "G".padEnd(56, "A");
    const res = await request(app)
      .post("/login")
      .send({ walletAddress });
    expect(res.body.received.tier).toBe("free");
  });
});

describe("validate(refreshSchema)", () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.post("/refresh", validate(refreshSchema), (req, res) =>
      res.json({ ok: true })
    );
  });

  it("passes valid refreshToken", async () => {
    const res = await request(app)
      .post("/refresh")
      .send({ refreshToken: "eyJhbGciOiJIUzI1NiJ9.test.signature" });
    expect(res.status).toBe(200);
  });

  it("rejects empty refreshToken with 400", async () => {
    const res = await request(app)
      .post("/refresh")
      .send({ refreshToken: "" });
    expect(res.status).toBe(400);
  });

  it("rejects missing refreshToken with 400", async () => {
    const res = await request(app).post("/refresh").send({});
    expect(res.status).toBe(400);
  });
});
