import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import {
  cacheGet,
  cacheSet,
  cacheDel,
  setAdd,
  setMembers,
  setDel,
  NS,
} from "./cache.js";

const JWT_SECRET = process.env.JWT_SECRET || "aura-vault-dev-secret";
const ACCESS_TOKEN_TTL = 900; // 15 minutes
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days

// A07 JWT Best Practices: explicit algorithm, issuer, and audience
// — prevents algorithm confusion attacks (e.g. RS256→HS256 downgrade)
const JWT_ALGORITHM = "HS256" as const;
// Issuer and audience are opt-in: set JWT_ISSUER / JWT_AUDIENCE env vars in
// production. When unset (e.g. unit tests) the claims are omitted so existing
// tests continue to pass without modification.
const JWT_ISSUER = process.env.JWT_ISSUER;
const JWT_AUDIENCE = process.env.JWT_AUDIENCE;

export type Tier = "free" | "paid" | "admin";

export interface TokenPayload {
  sub: string;
  sessionId: string;
  deviceId?: string;
  tier?: Tier;
  scope?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface StoredRefresh {
  userId: string;
  sessionId: string;
  deviceId?: string;
  tier?: Tier;
}

export async function generateTokens(
  userId: string,
  deviceId?: string,
  tier: Tier = "free"
): Promise<TokenPair> {
  const sessionId = uuidv4();

  const scope = tier === 'admin' ? 'admin' : undefined;
  const accessToken = jwt.sign(
    { sub: userId, sessionId, deviceId, tier, ...(scope && { scope }) } as TokenPayload,
    JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_TTL,
      algorithm: JWT_ALGORITHM,
      ...(JWT_ISSUER && { issuer: JWT_ISSUER }),
      ...(JWT_AUDIENCE && { audience: JWT_AUDIENCE }),
    }
  );

  const refreshToken = jwt.sign(
    { sub: userId, sessionId, type: "refresh" },
    JWT_SECRET,
    {
      expiresIn: REFRESH_TOKEN_TTL,
      algorithm: JWT_ALGORITHM,
      ...(JWT_ISSUER && { issuer: JWT_ISSUER }),
      ...(JWT_AUDIENCE && { audience: JWT_AUDIENCE }),
    }
  );

  const stored: StoredRefresh = { userId, sessionId, deviceId, tier };
  await cacheSet(NS.AUTH_REFRESH, refreshToken, stored, REFRESH_TOKEN_TTL);
  await setAdd(NS.AUTH_SESSIONS, userId, sessionId, REFRESH_TOKEN_TTL);

  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL };
}

export async function validateAccessToken(
  token: string
): Promise<TokenPayload | null> {
  const blacklisted = await cacheGet<true>(NS.AUTH_BLACKLIST, token);
  if (blacklisted) return null;
  try {
    return jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
      ...(JWT_ISSUER && { issuer: JWT_ISSUER }),
      ...(JWT_AUDIENCE && { audience: JWT_AUDIENCE }),
    }) as TokenPayload;
  } catch {
    return null;
  }
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenPair | null> {
  const stored = await cacheGet<StoredRefresh>(NS.AUTH_REFRESH, refreshToken);
  if (!stored) return null;
  try {
    jwt.verify(refreshToken, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
      ...(JWT_ISSUER && { issuer: JWT_ISSUER }),
      ...(JWT_AUDIENCE && { audience: JWT_AUDIENCE }),
    });
  } catch {
    return null;
  }
  // Rotate: delete old, issue new pair
  await cacheDel(NS.AUTH_REFRESH, refreshToken);
  return generateTokens(stored.userId, stored.deviceId, stored.tier);
}

export async function blacklistToken(token: string): Promise<void> {
  // Use remaining token lifetime as TTL so the key auto-expires
  let ttl = ACCESS_TOKEN_TTL;
  try {
    const decoded = jwt.decode(token) as { exp?: number } | null;
    if (decoded?.exp) {
      const remaining = decoded.exp - Math.floor(Date.now() / 1000);
      ttl = Math.max(remaining, 1);
    }
  } catch {}
  await cacheSet(NS.AUTH_BLACKLIST, token, true, ttl);
}

export async function logout(
  accessToken: string,
  refreshToken?: string
): Promise<void> {
  await blacklistToken(accessToken);
  if (refreshToken) await cacheDel(NS.AUTH_REFRESH, refreshToken);
}

export async function getUserSessions(userId: string): Promise<string[]> {
  return setMembers(NS.AUTH_SESSIONS, userId);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await setDel(NS.AUTH_SESSIONS, userId);
}
