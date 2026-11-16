/**
 * compressionMiddleware.test.ts — issue #1272
 *
 * Verifies that:
 *   1. Responses larger than 1 kB receive Content-Encoding: gzip when the
 *      client sends Accept-Encoding: gzip.
 *   2. Responses smaller than the 1 kB threshold are NOT compressed.
 *   3. Already-compressed content types (e.g. image/png) are skipped.
 *   4. The X-No-Compression opt-out header suppresses compression.
 */

import express from "express";
import request from "supertest";
import { describe, it, expect } from "vitest";
import { compressionMiddleware } from "../compressionMiddleware.js";

// Build a minimal Express app that mounts the compression middleware and
// returns a body of the requested size.
function buildApp() {
  const app = express();
  app.use(compressionMiddleware);

  // Large JSON endpoint — body well over the 1 kB threshold
  app.get("/large", (_req, res) => {
    const payload = { data: "x".repeat(4096) }; // ~4 kB
    res.json(payload);
  });

  // Small JSON endpoint — body under the 1 kB threshold
  app.get("/small", (_req, res) => {
    res.json({ ok: true });
  });

  // Image endpoint — content-type is already-compressed, must be skipped
  app.get("/image", (_req, res) => {
    res.set("Content-Type", "image/png");
    res.send(Buffer.alloc(4096)); // 4 kB of zeros but already "compressed" type
  });

  return app;
}

describe("compressionMiddleware (#1272)", () => {
  const app = buildApp();

  it("compresses large JSON responses when client accepts gzip", async () => {
    const res = await request(app)
      .get("/large")
      .set("Accept-Encoding", "gzip");

    expect(res.status).toBe(200);
    // supertest decompresses automatically; check the header was set
    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("does NOT compress responses smaller than the 1 kB threshold", async () => {
    const res = await request(app)
      .get("/small")
      .set("Accept-Encoding", "gzip");

    expect(res.status).toBe(200);
    // Small payload must NOT be compressed
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("skips compression for already-compressed image content types", async () => {
    const res = await request(app)
      .get("/image")
      .set("Accept-Encoding", "gzip");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("skips compression when X-No-Compression header is present", async () => {
    const res = await request(app)
      .get("/large")
      .set("Accept-Encoding", "gzip")
      .set("X-No-Compression", "1");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("preserves response body content after compression/decompression", async () => {
    const res = await request(app)
      .get("/large")
      .set("Accept-Encoding", "gzip");

    expect(res.status).toBe(200);
    // supertest decompresses; verify payload is intact
    expect(res.body.data).toBe("x".repeat(4096));
  });
});
