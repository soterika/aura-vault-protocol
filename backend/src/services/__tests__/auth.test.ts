import { beforeEach, describe, expect, it, vi } from "vitest";

const { cacheGet, cacheSet, cacheDel, setAdd, setMembers, setDel } = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  setAdd: vi.fn(),
  setMembers: vi.fn(),
  setDel: vi.fn(),
}));

vi.mock("../../cache.js", () => ({
  cacheGet: (...args: unknown[]) => cacheGet(...args),
  cacheSet: (...args: unknown[]) => cacheSet(...args),
  cacheDel: (...args: unknown[]) => cacheDel(...args),
  setAdd: (...args: unknown[]) => setAdd(...args),
  setMembers: (...args: unknown[]) => setMembers(...args),
  setDel: (...args: unknown[]) => setDel(...args),
  NS: { AUTH_REFRESH: "auth:refresh", AUTH_BLACKLIST: "auth:blacklist", AUTH_SESSIONS: "auth:sessions" },
}));

import { generateTokens, refreshAccessToken, validateAccessToken } from "../../auth.js";

describe("auth token lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("issues verifiable tokens and stores refresh state", async () => {
    const tokens = await generateTokens("wallet-1", "device-1", "paid");
    expect(tokens.expiresIn).toBe(900);
    expect(await validateAccessToken(tokens.accessToken)).toMatchObject({ sub: "wallet-1", deviceId: "device-1", tier: "paid" });
    expect(cacheSet).toHaveBeenCalledWith("auth:refresh", tokens.refreshToken, expect.objectContaining({ userId: "wallet-1" }), 2_592_000);
    expect(setAdd).toHaveBeenCalledOnce();
  });

  it("rejects revoked access tokens and unknown refresh tokens", async () => {
    cacheGet.mockResolvedValueOnce(true);
    expect(await validateAccessToken("revoked-token")).toBeNull();
    cacheGet.mockResolvedValueOnce(null);
    expect(await refreshAccessToken("unknown-refresh-token")).toBeNull();
  });
});
