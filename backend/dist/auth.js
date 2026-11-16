import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { cacheGet, cacheSet, cacheDel, setAdd, setMembers, setDel, NS, } from "./cache.js";
const JWT_SECRET = process.env.JWT_SECRET || "aura-vault-dev-secret";
const ACCESS_TOKEN_TTL = 900; // 15 minutes
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days
export async function generateTokens(userId, deviceId, tier = "free") {
    const sessionId = uuidv4();
    const accessToken = jwt.sign({ sub: userId, sessionId, deviceId, tier }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = jwt.sign({ sub: userId, sessionId, type: "refresh" }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_TTL });
    const stored = { userId, sessionId, deviceId, tier };
    await cacheSet(NS.AUTH_REFRESH, refreshToken, stored, REFRESH_TOKEN_TTL);
    await setAdd(NS.AUTH_SESSIONS, userId, sessionId, REFRESH_TOKEN_TTL);
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL };
}
export async function validateAccessToken(token) {
    const blacklisted = await cacheGet(NS.AUTH_BLACKLIST, token);
    if (blacklisted)
        return null;
    try {
        return jwt.verify(token, JWT_SECRET);
    }
    catch {
        return null;
    }
}
export async function refreshAccessToken(refreshToken) {
    const stored = await cacheGet(NS.AUTH_REFRESH, refreshToken);
    if (!stored)
        return null;
    try {
        jwt.verify(refreshToken, JWT_SECRET);
    }
    catch {
        return null;
    }
    // Rotate: delete old, issue new pair
    await cacheDel(NS.AUTH_REFRESH, refreshToken);
    return generateTokens(stored.userId, stored.deviceId, stored.tier);
}
export async function blacklistToken(token) {
    // Use remaining token lifetime as TTL so the key auto-expires
    let ttl = ACCESS_TOKEN_TTL;
    try {
        const decoded = jwt.decode(token);
        if (decoded?.exp) {
            const remaining = decoded.exp - Math.floor(Date.now() / 1000);
            ttl = Math.max(remaining, 1);
        }
    }
    catch { }
    await cacheSet(NS.AUTH_BLACKLIST, token, true, ttl);
}
export async function logout(accessToken, refreshToken) {
    await blacklistToken(accessToken);
    if (refreshToken)
        await cacheDel(NS.AUTH_REFRESH, refreshToken);
}
export async function getUserSessions(userId) {
    return setMembers(NS.AUTH_SESSIONS, userId);
}
export async function revokeAllSessions(userId) {
    await setDel(NS.AUTH_SESSIONS, userId);
}
