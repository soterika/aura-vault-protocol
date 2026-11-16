import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Request, Response } from "express";
import request from "supertest";
import { idempotency } from "../../middleware/idempotencyMiddleware.js";

const redisStore = new Map<string, string>();

vi.mock("../../redis.js", () => ({
  getRedis: () => ({
    get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    set: vi.fn(async (key: string, val: string) => {
      redisStore.set(key, val);
      return "OK";
    }),
  }),
}));

describe("Idempotency Middleware (Issue #307)", () => {
  let app: express.Express;
  let executionCount = 0;

  beforeEach(() => {
    redisStore.clear();
    executionCount = 0;

    app = express();
    app.use(express.json());
    app.post("/test-tx", idempotency(), (req: Request, res: Response) => {
      executionCount++;
      res.status(200).json({
        success: true,
        data: req.body,
        count: executionCount,
      });
    });
  });

  it("passes through normally when no Idempotency-Key header is provided", async () => {
    const res1 = await request(app).post("/test-tx").send({ amount: "100" });
    expect(res1.status).toBe(200);
    expect(res1.body.count).toBe(1);

    const res2 = await request(app).post("/test-tx").send({ amount: "100" });
    expect(res2.status).toBe(200);
    expect(res2.body.count).toBe(2);
  });

  it("rejects non-UUID idempotency key with 400 Bad Request", async () => {
    const res = await request(app)
      .post("/test-tx")
      .set("Idempotency-Key", "not-a-uuid-1234")
      .send({ amount: "100" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(executionCount).toBe(0);
  });

  it("caches response on first request and replays it on second request without re-execution", async () => {
    const key = "e8293992-1e94-4d8b-967a-555e1c4a0342";

    // Request 1
    const res1 = await request(app)
      .post("/test-tx")
      .set("Idempotency-Key", key)
      .send({ amount: "500", address: "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI" });

    expect(res1.status).toBe(200);
    expect(res1.body.count).toBe(1);
    expect(executionCount).toBe(1);

    // Request 2 (identical key & body)
    const res2 = await request(app)
      .post("/test-tx")
      .set("Idempotency-Key", key)
      .send({ amount: "500", address: "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI" });

    expect(res2.status).toBe(200);
    expect(res2.body.count).toBe(1); // Cached value returned
    expect(res2.headers["x-idempotent-replay"]).toBe("true");
    expect(executionCount).toBe(1); // Handler was not re-executed!
  });

  it("rejects request with 400 if idempotency key is reused with different payload", async () => {
    const key = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

    // Request 1
    const res1 = await request(app)
      .post("/test-tx")
      .set("Idempotency-Key", key)
      .send({ amount: "100" });

    expect(res1.status).toBe(200);
    expect(executionCount).toBe(1);

    // Request 2 (same key, different body)
    const res2 = await request(app)
      .post("/test-tx")
      .set("Idempotency-Key", key)
      .send({ amount: "200" });

    expect(res2.status).toBe(400);
    expect(res2.body.code).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
    expect(executionCount).toBe(1);
  });
});
