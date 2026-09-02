import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import http from "node:http";
import crypto from "node:crypto";
import { webhookRouter, dispatchEvent, sign } from "./webhook.js";

// ── App setup ─────────────────────────────────────────────────────────────────

// Mock the authenticate middleware so tests don't need a real JWT setup.
function mockAuthenticate(_req: Request, _res: Response, next: NextFunction) {
  next();
}

const app = express();
app.use(express.json());
app.use("/api/webhooks", mockAuthenticate, webhookRouter);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Spin up a temporary HTTP server that records the first incoming request. */
function createReceiverServer(): Promise<{
  server: http.Server;
  port: number;
  waitForRequest: () => Promise<{ body: string; signature: string }>;
}> {
  return new Promise((resolve) => {
    let resolveRequest: (data: { body: string; signature: string }) => void;
    const requestPromise = new Promise<{ body: string; signature: string }>((r) => {
      resolveRequest = r;
    });

    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
      req.on("end", () => {
        resolveRequest({ body: raw, signature: req.headers["x-aura-signature"] as string ?? "" });
        res.writeHead(200);
        res.end();
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port, waitForRequest: () => requestPromise });
    });
  });
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe("Webhook signature verification", () => {
  it("sign() produces sha256= prefixed HMAC", () => {
    const sig = sign("secret", "body");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("sign() is deterministic", () => {
    expect(sign("secret", "body")).toBe(sign("secret", "body"));
  });

  it("sign() differs with different secrets", () => {
    expect(sign("secret1", "body")).not.toBe(sign("secret2", "body"));
  });

  it("sign() differs with tampered payload", () => {
    expect(sign("secret", "original body")).not.toBe(sign("secret", "tampered body"));
  });
});

describe("POST /api/webhooks/verify", () => {
  it("returns valid:true for correct signature", async () => {
    const body = JSON.stringify({ amount: 100 });
    const secret = "my-secret";
    const signature = sign(secret, body);

    const res = await request(app)
      .post("/api/webhooks/verify")
      .send({ secret, body, signature });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  it("returns valid:false for tampered payload", async () => {
    const secret = "my-secret";
    const realBody = JSON.stringify({ amount: 100 });
    const signature = sign(secret, realBody);
    const tamperedBody = JSON.stringify({ amount: 9999 });

    const res = await request(app)
      .post("/api/webhooks/verify")
      .send({ secret, body: tamperedBody, signature });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  it("returns valid:false for wrong secret", async () => {
    const body = JSON.stringify({ amount: 100 });
    const signature = sign("correct-secret", body);

    const res = await request(app)
      .post("/api/webhooks/verify")
      .send({ secret: "wrong-secret", body, signature });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  it("returns 400 when fields are missing", async () => {
    const res = await request(app)
      .post("/api/webhooks/verify")
      .send({ secret: "s" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("POST /api/webhooks/test", () => {
  it("returns 400 when url is missing", async () => {
    const res = await request(app)
      .post("/api/webhooks/test")
      .send({ secret: "s3cr3t" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/i);
  });

  it("returns 400 when secret is missing", async () => {
    const res = await request(app)
      .post("/api/webhooks/test")
      .send({ url: "http://localhost:9999" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/secret/i);
  });

  it("returns 400 when url is invalid", async () => {
    const res = await request(app)
      .post("/api/webhooks/test")
      .send({ url: "not-a-url", secret: "s3cr3t" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid url/i);
  });

  it("delivers to a local HTTP server and returns statusCode", async () => {
    const { server, port, waitForRequest } = await createReceiverServer();

    try {
      const secret = "test-secret-123";
      const url = `http://127.0.0.1:${port}`;

      const [res, received] = await Promise.all([
        request(app).post("/api/webhooks/test").send({ url, secret }),
        waitForRequest(),
      ]);

      // Delivery was successful
      expect(res.status).toBe(200);
      expect(res.body.delivered).toBe(true);
      expect(res.body.statusCode).toBe(200);

      // The signature on the received request must be valid
      const expectedSig = sign(secret, received.body);
      const expBuf = Buffer.from(expectedSig);
      const sigBuf = Buffer.from(received.signature);
      expect(expBuf.length).toBe(sigBuf.length);
      expect(crypto.timingSafeEqual(expBuf, sigBuf)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("Webhook registration and dispatch", () => {
  let endpointId: string;

  it("POST / registers a webhook endpoint", async () => {
    const res = await request(app)
      .post("/api/webhooks")
      .send({ url: "http://example.com/hook", secret: "s3cr3t", events: ["deposit"] });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.url).toBe("http://example.com/hook");
    expect(res.body).not.toHaveProperty("secret"); // secret must not be exposed
    endpointId = res.body.id as string;
  });

  it("GET / lists endpoints without secrets", async () => {
    const res = await request(app).get("/api/webhooks");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const ep = (res.body as Array<Record<string, unknown>>).find((e) => e.id === endpointId);
    expect(ep).toBeTruthy();
    expect(ep).not.toHaveProperty("secret");
  });

  it("GET /:id returns endpoint", async () => {
    const res = await request(app).get(`/api/webhooks/${endpointId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(endpointId);
    expect(res.body).not.toHaveProperty("secret");
  });

  it("DELETE /:id removes endpoint", async () => {
    const res = await request(app).delete(`/api/webhooks/${endpointId}`);
    expect(res.status).toBe(204);

    const check = await request(app).get(`/api/webhooks/${endpointId}`);
    expect(check.status).toBe(404);
  });

  it("dispatchEvent creates a deliverable event", () => {
    const event = dispatchEvent("harvest", { yieldAmount: 500 });

    expect(event.id).toBeTruthy();
    expect(event.type).toBe("harvest");
    expect(event.payload.yieldAmount).toBe(500);
    expect(event.createdAt).toBeTruthy();
  });
});
