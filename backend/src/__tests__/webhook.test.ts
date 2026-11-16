import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import nock from "nock";
import crypto from "node:crypto";
import { webhookRouter } from "../webhook.js";
import { BACKOFF_MS, dispatchWebhookEvent, signPayload } from "../services/webhookService.js";

const store = vi.hoisted(() => ({
  webhooks: [] as Array<Record<string, any>>,
  deliveries: [] as Array<Record<string, any>>,
}));

vi.mock("../db.js", () => {
  const query = vi.fn(async (statement: string, params: any[] = []) => {
    const sql = statement.replace(/\s+/g, " ").trim();
    if (sql.startsWith("INSERT INTO webhooks")) {
      const row = {
        id: crypto.randomUUID(), url: params[0], secret: params[1], event_types: params[2],
        consecutive_failures: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      store.webhooks.push(row);
      const { secret: _secret, ...publicRow } = row;
      return { rows: [publicRow], rowCount: 1 };
    }
    if (sql.startsWith("SELECT id, url, secret, event_types FROM webhooks")) {
      return { rows: store.webhooks.filter((row) => row.consecutive_failures < params[0] &&
        (row.event_types.length === 0 || row.event_types.includes(params[1]))), rowCount: store.webhooks.length };
    }
    if (sql.startsWith("INSERT INTO webhook_deliveries")) {
      const [webhookId, eventId, eventType, rawPayload] = params;
      if (eventId && store.deliveries.some((row) => row.webhook_id === webhookId && row.event_id === eventId)) {
        return { rows: [], rowCount: 0 };
      }
      const row = {
        id: crypto.randomUUID(), webhook_id: webhookId, event_id: eventId,
        event_type: eventType, payload: JSON.parse(rawPayload), status: "pending", attempts: 0,
        last_status_code: null, last_error: null, next_retry_at: new Date().toISOString(),
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      store.deliveries.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE webhook_deliveries") && sql.includes("status = 'success'")) {
      const row = store.deliveries.find((item) => item.id === params[2]);
      if (row) Object.assign(row, { status: "success", attempts: params[0], last_status_code: params[1], next_retry_at: null });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE webhook_deliveries") && sql.includes("status = 'failed'")) {
      const row = store.deliveries.find((item) => item.id === params[3]);
      if (row) Object.assign(row, { status: "failed", attempts: params[0], last_status_code: params[1], last_error: params[2], next_retry_at: null });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE webhook_deliveries")) {
      const row = store.deliveries.find((item) => item.id === params[4]);
      if (row) Object.assign(row, { attempts: params[0], last_status_code: params[1], last_error: params[2], next_retry_at: params[3] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE webhooks SET consecutive_failures = consecutive_failures + 1")) {
      const row = store.webhooks.find((item) => item.id === params[0]);
      if (row) row.consecutive_failures += 1;
      return { rows: row ? [{ consecutive_failures: row.consecutive_failures }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE webhooks SET consecutive_failures = 0")) {
      const row = store.webhooks.find((item) => item.id === params[0]);
      if (row) row.consecutive_failures = 0;
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT * FROM webhook_deliveries WHERE id =")) {
      const row = store.deliveries.find((item) => item.id === params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT id, url, event_types, consecutive_failures, created_at, updated_at FROM webhooks WHERE id =")) {
      const row = store.webhooks.find((item) => item.id === params[0]);
      if (!row) return { rows: [], rowCount: 0 };
      const { secret: _secret, ...publicRow } = row;
      return { rows: [publicRow], rowCount: 1 };
    }
    if (sql.startsWith("SELECT id, url, event_types, consecutive_failures, created_at, updated_at FROM webhooks ORDER BY")) {
      return { rows: store.webhooks.map(({ secret: _secret, ...row }) => row), rowCount: store.webhooks.length };
    }
    if (sql.startsWith("DELETE FROM webhooks WHERE id =")) {
      const before = store.webhooks.length;
      store.webhooks = store.webhooks.filter((row) => row.id !== params[0]);
      return { rows: [], rowCount: before - store.webhooks.length };
    }
    if (sql.startsWith("SELECT id, webhook_id, event_id, event_type, payload, status, attempts")) {
      return { rows: store.deliveries.filter((row) => row.webhook_id === params[0]), rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
  const pool = { query };
  return { getReadPool: () => pool, getWritePool: () => pool };
});

const app = express();
app.use(express.json());
app.use("/api/webhooks", webhookRouter);

beforeEach(() => {
  store.webhooks = [];
  store.deliveries = [];
  nock.disableNetConnect();
  nock.enableNetConnect("127.0.0.1");
});

afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
  vi.useRealTimers();
});

describe("webhook API contract", () => {
  it("delivers a subscribed event to the registered endpoint", async () => {
    const created = await request(app).post("/api/webhooks").send({
      url: "https://receiver.test/events", secret: "contract-secret", events: ["deposit"],
    });
    expect(created.status).toBe(201);
    const receiver = nock("https://receiver.test").post("/events").reply(204);

    await dispatchWebhookEvent("deposit", { amount: "12.5" }, "event-delivery-1");
    await vi.waitFor(() => expect(receiver.isDone()).toBe(true));
    expect(store.deliveries[0]?.status).toBe("success");
  });

  it("signs the exact payload so a receiver can verify HMAC-SHA256", async () => {
    const secret = "receiver-secret";
    let receivedBody = "";
    let receivedSignature = "";
    const createdAt = "2026-01-01T00:00:00.000Z";
    const scope = nock("https://receiver.test").post("/signed")
      .reply(function (_uri, body) {
        receivedBody = JSON.stringify(body);
        receivedSignature = String(this.req.headers["x-aura-signature"] ?? "");
        return [200, {}];
      });
    store.webhooks.push({
      id: "hook-signed", url: "https://receiver.test/signed", secret, event_types: [],
      consecutive_failures: 0, created_at: createdAt, updated_at: createdAt,
    });
    await dispatchWebhookEvent("harvest", { amount: 3 }, "event-signature-1");
    await vi.waitFor(() => expect(scope.isDone()).toBe(true));
    const expected = signPayload(secret, receivedBody);
    expect(receivedSignature).toBe(expected);
    expect(crypto.timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expected))).toBe(true);
  });

  it("schedules retry using the configured exponential delay after a failed delivery", async () => {
    const createdAt = new Date().toISOString();
    nock("https://receiver.test").post("/retry").reply(500);
    store.webhooks.push({ id: "hook-retry", url: "https://receiver.test/retry", secret: "s", event_types: [], consecutive_failures: 0, created_at: createdAt, updated_at: createdAt });
    await dispatchWebhookEvent("deposit", { amount: 1 }, "event-retry-1");
    await vi.waitFor(() => expect(store.deliveries[0]?.attempts).toBe(1));
    const retryAt = Date.parse(store.deliveries[0]!.next_retry_at);
    expect(retryAt - Date.now()).toBeGreaterThanOrEqual(BACKOFF_MS[0] - 1000);
    expect(retryAt - Date.now()).toBeLessThanOrEqual(BACKOFF_MS[0] + 1000);
  });

  it("moves a delivery to the dead-letter failed state after five failed attempts", async () => {
    const createdAt = new Date().toISOString();
    nock("https://receiver.test").post("/dead-letter").times(5).reply(500);
    store.webhooks.push({ id: "hook-dead", url: "https://receiver.test/dead-letter", secret: "s", event_types: [], consecutive_failures: 0, created_at: createdAt, updated_at: createdAt });
    vi.stubGlobal("setTimeout", (callback: () => void) => { queueMicrotask(callback); return 0; });
    await dispatchWebhookEvent("deposit", { amount: 1 }, "event-dead-letter-1");
    await vi.waitFor(() => expect(nock.isDone()).toBe(true));
    await vi.waitFor(() => expect(store.deliveries[0]?.status).toBe("failed"));
    expect(store.deliveries[0]?.attempts).toBe(5);
  });

  it("supports registering, listing, and deleting subscriptions without exposing secrets", async () => {
    const created = await request(app).post("/api/webhooks").send({
      url: "https://receiver.test/manage", secret: "never-return-this", events: ["withdraw"],
    });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain("never-return-this");
    const listed = await request(app).get("/api/webhooks");
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain("never-return-this");
    const id = created.body.data.id;
    expect((await request(app).delete(`/api/webhooks/${id}`)).status).toBe(204);
  });

  it("does not create or deliver the same event twice for one subscription", async () => {
    const receiver = nock("https://receiver.test").post("/dedupe").once().reply(204);
    store.webhooks.push({ id: "hook-dedupe", url: "https://receiver.test/dedupe", secret: "s", event_types: [], consecutive_failures: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await dispatchWebhookEvent("deposit", { amount: 9 }, "stable-event-id");
    await dispatchWebhookEvent("deposit", { amount: 9 }, "stable-event-id");
    await vi.waitFor(() => expect(receiver.isDone()).toBe(true));
    expect(store.deliveries.filter((row) => row.event_id === "stable-event-id")).toHaveLength(1);
  });
});
