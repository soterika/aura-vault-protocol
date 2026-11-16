import { afterEach, describe, expect, it } from "vitest";
import { generateUnsubscribeToken, parseUnsubscribeToken } from "../emailService.js";

describe("email unsubscribe tokens", () => {
  afterEach(() => {
    delete process.env.UNSUBSCRIBE_SECRET;
  });

  it("round trips an address with a configured signing key", () => {
    process.env.UNSUBSCRIBE_SECRET = "test-only-email-secret";
    const token = generateUnsubscribeToken("reader@example.test");
    expect(parseUnsubscribeToken(token)).toBe("reader@example.test");
  });

  it("rejects malformed and tampered tokens", () => {
    process.env.UNSUBSCRIBE_SECRET = "test-only-email-secret";
    const token = generateUnsubscribeToken("reader@example.test");
    expect(parseUnsubscribeToken("not-a-token")).toBeNull();
    expect(parseUnsubscribeToken(`${token.slice(0, -1)}0`)).toBeNull();
  });
});
