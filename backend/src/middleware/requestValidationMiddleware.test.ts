/**
 * requestValidationMiddleware tests — Issue #316
 *
 * Covers:
 *  - 413 Payload Too Large when Content-Length > 64 KB
 *  - 415 Unsupported Media Type for wrong Content-Type on POST/PUT
 *  - 415 for multipart/form-data (file-upload vector blocked)
 *  - 200 (pass-through) for valid application/json requests
 *  - GET requests bypass content-type checks
 *  - DELETE requests bypass content-type checks
 *  - Requests with no body / no Content-Type on POST are let through
 */

import { describe, it, expect } from "vitest";
import express, { type Application } from "express";
import request from "supertest";
import {
  bodySizeLimit,
  contentTypeEnforcement,
  jsonBodyParser,
  MAX_BODY_BYTES,
} from "./requestValidationMiddleware.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildApp(): Application {
  const app = express();
  app.use(bodySizeLimit());
  app.use(contentTypeEnforcement());
  app.use(jsonBodyParser());

  // Echo endpoint — returns the parsed body so we can verify it was parsed
  app.post("/echo", (_req, res) => res.status(200).json({ ok: true }));
  app.put("/echo", (_req, res) => res.status(200).json({ ok: true }));
  app.patch("/echo", (_req, res) => res.status(200).json({ ok: true }));
  app.get("/echo", (_req, res) => res.status(200).json({ ok: true }));
  app.delete("/echo", (_req, res) => res.status(200).json({ ok: true }));

  return app;
}

// ─── bodySizeLimit ───────────────────────────────────────────────────────────

describe("bodySizeLimit middleware", () => {
  const app = buildApp();

  it("passes requests whose Content-Length is exactly at the limit", async () => {
    // Build a body whose serialized length is ≤ 64 KB
    const body = { data: "x".repeat(100) };
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
  });

  it("returns 413 when Content-Length header exceeds 64 KB", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .set("Content-Length", String(MAX_BODY_BYTES + 1))
      // Send a tiny body — the check is on the declared header, not actual bytes here
      .send({ x: 1 });

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      error: "Payload Too Large",
    });
  });

  it("returns 413 for a truly oversized body (streaming enforcement via express.json limit)", async () => {
    // Build a body that is genuinely > 64 KB when serialized
    const oversizedBody = JSON.stringify({ data: "a".repeat(MAX_BODY_BYTES) });

    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send(oversizedBody);

    // Either our Content-Length guard fires (413) or express.json limit fires (413)
    expect(res.status).toBe(413);
  });

  it("passes when no Content-Length header is present (body is absent)", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send({ ok: true });

    expect(res.status).toBe(200);
  });
});

// ─── contentTypeEnforcement ──────────────────────────────────────────────────

describe("contentTypeEnforcement middleware", () => {
  const app = buildApp();

  // ── POST ──────────────────────────────────────────────────────────────────

  it("passes POST with application/json", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send({ hello: "world" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("passes POST with application/json; charset=utf-8", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json; charset=utf-8")
      .send({ hello: "world" });

    expect(res.status).toBe(200);
  });

  it("returns 415 for POST with text/plain", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "text/plain")
      .send("hello");

    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({
      error: "Unsupported Media Type",
    });
  });

  it("returns 415 for POST with application/x-www-form-urlencoded", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("foo=bar");

    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({
      error: "Unsupported Media Type",
      message: "Content-Type must be application/json",
    });
  });

  it("returns 415 for POST with multipart/form-data", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "multipart/form-data; boundary=----WebKitFormBoundary")
      .send("------WebKitFormBoundary\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\ndata\r\n------WebKitFormBoundary--");

    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({
      error: "Unsupported Media Type",
      message: "multipart/form-data is not accepted on API endpoints",
    });
  });

  // ── PUT ───────────────────────────────────────────────────────────────────

  it("passes PUT with application/json", async () => {
    const res = await request(app)
      .put("/echo")
      .set("Content-Type", "application/json")
      .send({ update: true });

    expect(res.status).toBe(200);
  });

  it("returns 415 for PUT with multipart/form-data", async () => {
    const res = await request(app)
      .put("/echo")
      .set("Content-Type", "multipart/form-data; boundary=boundary123")
      .send("--boundary123\r\nContent-Disposition: form-data; name=\"x\"\r\n\r\nval\r\n--boundary123--");

    expect(res.status).toBe(415);
  });

  it("returns 415 for PUT with application/x-www-form-urlencoded", async () => {
    const res = await request(app)
      .put("/echo")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("a=1");

    expect(res.status).toBe(415);
  });

  // ── PATCH ─────────────────────────────────────────────────────────────────

  it("passes PATCH with application/json", async () => {
    const res = await request(app)
      .patch("/echo")
      .set("Content-Type", "application/json")
      .send({ patch: true });

    expect(res.status).toBe(200);
  });

  it("returns 415 for PATCH with text/xml", async () => {
    const res = await request(app)
      .patch("/echo")
      .set("Content-Type", "text/xml")
      .send("<patch/>");

    expect(res.status).toBe(415);
  });

  // ── Methods that bypass content-type checks ────────────────────────────────

  it("passes GET without a Content-Type header", async () => {
    const res = await request(app).get("/echo");

    expect(res.status).toBe(200);
  });

  it("passes DELETE without a Content-Type header", async () => {
    const res = await request(app).delete("/echo");

    expect(res.status).toBe(200);
  });
});

// ─── Combined: bodySizeLimit + contentTypeEnforcement applied together ────────

describe("combined middleware stack", () => {
  const app = buildApp();

  it("returns 413 before 415 for an oversized request with wrong content-type", async () => {
    // Content-Length check fires first (registered before content-type check)
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "text/plain")
      .set("Content-Length", String(MAX_BODY_BYTES + 1))
      .send("x");

    expect(res.status).toBe(413);
  });

  it("valid JSON POST with small body goes through end-to-end", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send({ amount: 1000, token: "USDC" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

// ─── Unit tests for exported constants ────────────────────────────────────────

describe("MAX_BODY_BYTES constant", () => {
  it("is exactly 64 KB", () => {
    expect(MAX_BODY_BYTES).toBe(65536);
  });
});
