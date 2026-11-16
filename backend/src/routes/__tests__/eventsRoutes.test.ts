import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { searchEvents } = vi.hoisted(() => ({ searchEvents: vi.fn() }));
vi.mock("../../services/eventSearchService.js", () => ({ searchEvents }));
vi.mock("../../middleware/authMiddleware.js", () => ({
  authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.headers.authorization) {
      res.status(401).json({ error: "Missing token" });
      return;
    }
    const token = req.headers.authorization;
    const identity = token === "Bearer operations"
      ? { role: "operations", sub: "ops-role" }
      : token === "Bearer allowlisted"
        ? { role: "user", sub: "ops-wallet" }
        : { role: "user", sub: "ordinary-wallet" };
    (req as express.Request & { user?: { role?: string; sub?: string } }).user = identity;
    next();
  },
}));

import { eventsRouter } from "../eventsRoutes.js";

const app = express().use("/api/v1/events", eventsRouter);
const previousOperationsUsers = process.env.OPERATIONS_USER_IDS;

describe("GET /api/v1/events/search", () => {
  beforeEach(() => {
    searchEvents.mockReset();
    process.env.OPERATIONS_USER_IDS = "ops-wallet";
  });

  afterAll(() => {
    if (previousOperationsUsers === undefined) delete process.env.OPERATIONS_USER_IDS;
    else process.env.OPERATIONS_USER_IDS = previousOperationsUsers;
  });

  it("requires authentication and operations authorization", async () => {
    expect((await request(app).get("/api/v1/events/search?q=deposit")).status).toBe(401);
    expect((await request(app).get("/api/v1/events/search?q=deposit").set("Authorization", "Bearer user")).status).toBe(403);
    expect(searchEvents).not.toHaveBeenCalled();
  });

  it("accepts an operations role claim and an allowlisted authenticated subject", async () => {
    searchEvents.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    const roleResponse = await request(app)
      .get("/api/v1/events/search?q=deposit")
      .set("Authorization", "Bearer operations");
    const allowlistResponse = await request(app)
      .get("/api/v1/events/search?q=deposit")
      .set("Authorization", "Bearer allowlisted");
    expect(roleResponse.status).toBe(200);
    expect(allowlistResponse.status).toBe(200);
  });

  it.each(["0", "-1", "1.5", "1e2", "0x10", "999999999999999999999"])(
    "rejects non-positive or non-decimal page values: %s",
    async (page) => {
      const response = await request(app)
        .get(`/api/v1/events/search?q=deposit&page=${encodeURIComponent(page)}`)
        .set("Authorization", "Bearer operations");
      expect(response.status).toBe(400);
      expect(searchEvents).not.toHaveBeenCalled();
    }
  );

  it.each(["0", "101", "1.5", "1e2", "0x10", "999999999999999999999"])(
    "rejects invalid pageSize values: %s",
    async (pageSize) => {
      const response = await request(app)
        .get(`/api/v1/events/search?q=deposit&pageSize=${encodeURIComponent(pageSize)}`)
        .set("Authorization", "Bearer operations");
      expect(response.status).toBe(400);
      expect(searchEvents).not.toHaveBeenCalled();
    }
  );

  it.each(["", "   ", "x".repeat(201)])("rejects invalid q values", async (q) => {
    const response = await request(app)
      .get(`/api/v1/events/search?q=${encodeURIComponent(q)}`)
      .set("Authorization", "Bearer operations");
    expect(response.status).toBe(400);
    expect(searchEvents).not.toHaveBeenCalled();
  });

  it.each([
    "January%201,%202025",
    "2025-02-30",
    "2025-01-01T12:00:00",
    "2025-01-01T12:00:00+14:30",
  ])("rejects non-ISO or invalid from dates", async (from) => {
    const response = await request(app)
      .get(`/api/v1/events/search?q=deposit&from=${from}`)
      .set("Authorization", "Bearer operations");
    expect(response.status).toBe(400);
    expect(searchEvents).not.toHaveBeenCalled();
  });

  it("rejects a date range where from is after to", async () => {
    const response = await request(app)
      .get("/api/v1/events/search?q=deposit&from=2025-02-01&to=2025-01-01")
      .set("Authorization", "Bearer operations");
    expect(response.status).toBe(400);
    expect(searchEvents).not.toHaveBeenCalled();
  });

  it("passes supported filters and returns the paginated response", async () => {
    const paginated = { data: [{ id: "event-1" }], pagination: { page: 2, pageSize: 5, total: 1, totalPages: 1 } };
    searchEvents.mockResolvedValue(paginated);
    const response = await request(app)
      .get("/api/v1/events/search?q=deposit&type=deposit&from=2025-01-01&to=2025-01-31T23%3A59%3A59Z&page=2&pageSize=5")
      .set("Authorization", "Bearer operations");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(paginated);
    expect(searchEvents).toHaveBeenCalledWith({
      q: "deposit", type: "deposit", from: "2025-01-01T00:00:00.000000Z", to: "2025-01-31T23:59:59Z", page: 2, pageSize: 5,
    });
  });

  it("accepts large page values when the computed offset remains safe", async () => {
    searchEvents.mockResolvedValue({
      data: [],
      pagination: { page: 90071992547410, pageSize: 100, total: 0, totalPages: 0 },
    });
    const response = await request(app)
      .get("/api/v1/events/search?q=deposit&page=90071992547410&pageSize=100")
      .set("Authorization", "Bearer operations");
    expect(response.status).toBe(200);
    expect(searchEvents).toHaveBeenCalledWith({
      q: "deposit", type: undefined, from: undefined, to: undefined,
      page: 90071992547410, pageSize: 100,
    });
  });

  it("rejects page values whose computed offset exceeds MAX_SAFE_INTEGER", async () => {
    const response = await request(app)
      .get("/api/v1/events/search?q=deposit&page=90071992547411&pageSize=100")
      .set("Authorization", "Bearer operations");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("page and pageSize produce an unsafe pagination offset");
    expect(searchEvents).not.toHaveBeenCalled();
  });
});
