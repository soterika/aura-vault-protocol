import { beforeEach, describe, expect, it, vi } from "vitest";

const lpush = vi.hoisted(() => vi.fn());
vi.mock("../../redis.js", () => ({ getRedis: () => ({ lpush }) }));
vi.mock("../../cache.js", () => ({ NS: {
  EMAIL_QUEUE_HIGH: "email:queue:high",
  EMAIL_QUEUE_NORMAL: "email:queue:normal",
  EMAIL_QUEUE_LOW: "email:queue:low",
} }));
vi.mock("../emailService.js", () => ({ sendEmail: vi.fn() }));
vi.mock("../../logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { enqueueEmail } from "../emailQueue.js";

describe("email queue", () => {
  beforeEach(() => lpush.mockReset().mockResolvedValue(1));

  it("serializes email jobs into the selected priority queue", async () => {
    const id = await enqueueEmail({
      to: "reader@example.test",
      template: "welcome",
      data: { name: "Reader" },
      priority: "high",
    });

    expect(lpush).toHaveBeenCalledOnce();
    const [queue, serialized] = lpush.mock.calls[0] as [string, string];
    expect(queue).toBe("email:queue:high");
    expect(JSON.parse(serialized)).toMatchObject({
      id,
      to: "reader@example.test",
      template: "welcome",
      data: { name: "Reader" },
      priority: "high",
      attempts: 0,
      maxAttempts: 3,
    });
  });

  it("rejects oversized attachments before enqueueing", async () => {
    await expect(enqueueEmail({
      to: "reader@example.test",
      template: "receipt",
      data: {},
      attachments: [{ filename: "large.pdf", content: "", size: 5 * 1024 * 1024 + 1 }],
    })).rejects.toThrow(/exceeds 5 MB limit/);
    expect(lpush).not.toHaveBeenCalled();
  });
});
