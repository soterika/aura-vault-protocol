# Redis Data Model & Key Naming Conventions

This document is the authoritative reference for every Redis key used in Aura Vault Protocol. It covers the key pattern, owning service, data format, TTL, and the event that triggers invalidation.

---

## Overview

Redis is used for three distinct purposes:

| Purpose | Description |
|---|---|
| **Cache** | Short-lived API response and data caches backed by `backend/src/cache.ts` |
| **Auth / Session store** | JWT blacklist, refresh token storage, and session tracking |
| **Rate limiting** | Per-IP and per-user token-bucket counters |

All keys are constructed via the `key(ns, id)` helper in `cache.ts`:

```
<namespace>:<id>
```

---

## Key Namespace Reference

### 1. API Response Cache

#### `api:<cache-key>`

| Field | Value |
|---|---|
| **Owner** | `cacheMiddleware.ts` / route handlers |
| **Data format** | JSON — serialized API response body |
| **TTL** | `CACHE_API_TTL` env var (default: **60 s**) |
| **Invalidation** | Expiry only; no manual invalidation |

**Example key:** `api:vault-stats`
**Example value:**
```json
{
  "totalAssets": "1000000000",
  "totalShares": "950000000",
  "sharePrice": "1.052631578"
}
```

---

### 2. Gas Price Cache

#### `gas:price:<chain-id>`

| Field | Value |
|---|---|
| **Owner** | `gasService.ts` |
| **Data format** | JSON `{ baseFee: string, maxPriorityFee: string, timestamp: number }` |
| **TTL** | `GAS_CACHE_TTL_MS` / 1000 (default: **60 s**) |
| **Invalidation** | Expiry only |

**Example key:** `gas:price:1`

---

#### `gas:history:<chain-id>`

| Field | Value |
|---|---|
| **Owner** | `gasService.ts` |
| **Data format** | JSON array — up to `GAS_HISTORY_LIMIT` fee history entries |
| **TTL** | Same as `gas:price` |
| **Invalidation** | Expiry only |

**Example key:** `gas:history:1`

---

### 3. DeFi Price Cache

#### `defi:price:<token-symbol>`

| Field | Value |
|---|---|
| **Owner** | Price feed service |
| **Data format** | JSON `{ price: string, currency: "USD", timestamp: number }` |
| **TTL** | `CACHE_DEFI_PRICE_TTL` env var (default: **30 s**) |
| **Invalidation** | Expiry only |

**Example key:** `defi:price:XLM`
**Example value:**
```json
{ "price": "0.1234", "currency": "USD", "timestamp": 1700000000000 }
```

---

#### `defi:pools:<pool-id>`

| Field | Value |
|---|---|
| **Owner** | Pool data service |
| **Data format** | JSON pool metadata and liquidity snapshot |
| **TTL** | `CACHE_DEFI_POOL_TTL` env var (default: **60 s**) |
| **Invalidation** | Expiry only |

---

### 4. Auth — JWT Blacklist

#### `auth:blacklist:<sha256(accessToken)>`

| Field | Value |
|---|---|
| **Owner** | `auth.ts` → `blacklistToken()` |
| **Data format** | String literal `"true"` (JSON) |
| **TTL** | Remaining lifetime of the JWT at blacklist time (max **900 s**) |
| **Invalidation** | Expiry — key auto-removed when the token itself would have expired |

Long access tokens are hashed via SHA-256 (`hashKey()` in `cache.ts`) before storage. Key length is fixed at 64 hex characters.

**Example key:** `auth:blacklist:e3b0c44298fc1c149afb4c8996fb92427ae41e4649b934ca495991b7852b855`

---

### 5. Auth — Refresh Token Store

#### `auth:refresh:<refreshToken>`

| Field | Value |
|---|---|
| **Owner** | `auth.ts` → `generateTokens()` / `refreshAccessToken()` |
| **Data format** | JSON `StoredRefresh` object |
| **TTL** | **2 592 000 s** (30 days) |
| **Invalidation** | `logout()` calls `cacheDel(NS.AUTH_REFRESH, refreshToken)`; also deleted on rotation in `refreshAccessToken()` |

**Example value:**
```json
{
  "userId": "GABC...XYZ",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "deviceId": "mobile",
  "tier": "free"
}
```

---

### 6. Auth — Session Tracking

#### `auth:sessions:<userId>`

| Field | Value |
|---|---|
| **Owner** | `auth.ts` → `generateTokens()` / `revokeAllSessions()` |
| **Data type** | Redis **SET** — members are session UUIDs |
| **TTL** | **2 592 000 s** (30 days); reset on each new token issuance |
| **Invalidation** | `revokeAllSessions(userId)` calls `setDel(NS.AUTH_SESSIONS, userId)` |

Used to enumerate and bulk-invalidate all sessions for a user (GDPR erasure, password change).

**Example key:** `auth:sessions:GABC...XYZ`
**Example members:** `["550e8400-...", "6ba7b810-..."]`

---

#### `auth:sessions:tokens:<sessionId>`

| Field | Value |
|---|---|
| **Owner** | `auth.ts` — per-session refresh token tracking |
| **Data type** | Redis **SET** — members are refresh token hashes for this session |
| **TTL** | **2 592 000 s** (30 days) |
| **Invalidation** | On bulk logout for the session |

Enables granular single-session logout without revoking all sessions for the user.

---

### 7. Email Service

#### `email:unsubscribed:<email-hash>`

| Field | Value |
|---|---|
| **Owner** | Email service / unsubscribe handler |
| **Data format** | JSON `{ unsubscribedAt: string (ISO-8601) }` |
| **TTL** | None (persistent) |
| **Invalidation** | Manual re-subscription |

---

#### `email:bounce:hard:<email-hash>`

| Field | Value |
|---|---|
| **Owner** | Email delivery webhook handler |
| **Data format** | JSON `{ bouncedAt: string, reason: string }` |
| **TTL** | None (persistent) |
| **Invalidation** | Manual removal by ops |

---

#### `email:bounce:soft:<email-hash>`

| Field | Value |
|---|---|
| **Owner** | Email delivery webhook handler |
| **Data format** | JSON `{ count: number, lastBouncedAt: string }` |
| **TTL** | **86 400 s** (24 h) rolling |
| **Invalidation** | Expiry |

---

#### `email:tracking:<message-id>`

| Field | Value |
|---|---|
| **Owner** | Email service |
| **Data format** | JSON `{ status: "sent"|"delivered"|"opened"|"failed", events: [...] }` |
| **TTL** | **604 800 s** (7 days) |
| **Invalidation** | Expiry |

---

#### `email:queue:high`, `email:queue:normal`, `email:queue:low`

| Field | Value |
|---|---|
| **Owner** | Email queue worker |
| **Data type** | Redis **LIST** (RPUSH / BLPOP pattern) |
| **TTL** | None — persistent until consumed |
| **Invalidation** | Consumed by worker |

Priority-tiered email delivery queues. Jobs are JSON-serialized `EmailJob` objects.

---

#### `email:retry:<job-id>`

| Field | Value |
|---|---|
| **Owner** | Email queue worker |
| **Data format** | JSON `EmailJob` with `attempt` count |
| **TTL** | **3 600 s** (1 h) |
| **Invalidation** | On successful send or expiry |

---

#### `email:dead:<job-id>`

| Field | Value |
|---|---|
| **Owner** | Email queue worker |
| **Data format** | JSON `EmailJob` with `failureReason` |
| **TTL** | **604 800 s** (7 days) |
| **Invalidation** | Manual DLQ clearance or expiry |

---

#### `email:inflight:<job-id>`

| Field | Value |
|---|---|
| **Owner** | Email queue worker |
| **Data format** | JSON `EmailJob` |
| **TTL** | **300 s** (5 min — heartbeat) |
| **Invalidation** | On completion or expiry (triggers re-queue) |

---

### 8. Yield Worker

#### `yield:stats`

| Field | Value |
|---|---|
| **Owner** | Yield calculation service |
| **Data format** | JSON `{ apy: string, tvl: string, calculatedAt: string }` |
| **TTL** | `CACHE_API_TTL` (default: **60 s**) |
| **Invalidation** | On harvest event or scheduled recalculation |

---

#### `yield:history:<wallet-address>`

| Field | Value |
|---|---|
| **Owner** | Yield history service |
| **Data format** | JSON array of `{ date: string, yield: string, apy: string }` |
| **TTL** | **300 s** (5 min) |
| **Invalidation** | Expiry or on new yield snapshot |

---

### 9. Vault Simulation

#### `vault:simulate:<request-hash>`

| Field | Value |
|---|---|
| **Owner** | Vault simulation endpoint |
| **Data format** | JSON simulation result `{ sharesOut: string, assetsOut: string }` |
| **TTL** | **60 s** |
| **Invalidation** | Expiry |

Keyed on a SHA-256 hash of the request parameters (amount, current vault state).

---

### 10. Rate Limiting

Rate limits use a **token-bucket algorithm** implemented as an atomic Lua script. Each bucket key is a Redis **HASH** with two fields: `tokens` (float) and `last` (epoch ms).

#### `rl:global:ip:<ip-address>`

| Field | Value |
|---|---|
| **Owner** | `rateLimitMiddleware.ts` → `ipRateLimiter()` |
| **Data type** | Redis HASH `{ tokens: float, last: epoch_ms }` |
| **Bucket config** | capacity: **30**, refillRate: **0.5 tokens/s** (≈ 30 req/min steady-state) |
| **TTL** | `ceil(30 / 0.5) + 60` = **120 s** |
| **Invalidation** | Expiry only |

Applied globally to all requests via `globalIpRateLimiter()`.

**Example key:** `rl:global:ip:203.0.113.42`

---

#### `rl:auth:ip:<ip-address>`

| Field | Value |
|---|---|
| **Owner** | `rateLimitMiddleware.ts` → `authRateLimiter()` |
| **Data type** | Redis HASH `{ tokens: float, last: epoch_ms }` |
| **Bucket config** | capacity: **20**, refillRate: **0.0222 tokens/s** (20 req / 15 min) |
| **TTL** | `ceil(20 / 0.0222) + 60` ≈ **961 s** (~16 min) |
| **Invalidation** | Expiry only |

Applied only to `POST /api/auth/*` endpoints to limit brute-force and credential stuffing.

**Example key:** `rl:auth:ip:203.0.113.42`

---

#### `rl:user:<user-id>`

| Field | Value |
|---|---|
| **Owner** | `rateLimitMiddleware.ts` → `userRateLimiter()` |
| **Data type** | Redis HASH `{ tokens: float, last: epoch_ms }` |
| **Bucket config (free tier)** | capacity: **60**, refillRate: **1 token/s** |
| **Bucket config (paid tier)** | capacity: **600**, refillRate: **10 tokens/s** |
| **TTL** | `ceil(capacity / refillRate) + 60` s |
| **Invalidation** | Expiry only |

Applied to authenticated endpoints after `authMiddleware` populates `req.user`.

**Example key:** `rl:user:GABC...XYZ`

---

### 11. Cache Hit/Miss Statistics

#### `cache:stats`

| Field | Value |
|---|---|
| **Owner** | `cache.ts` → `track()` |
| **Data type** | Redis HASH |
| **TTL** | None (persistent) |
| **Invalidation** | Manual reset by ops |

Tracks hits and misses per namespace. Fields follow the pattern `<namespace>:hit` and `<namespace>:miss`.

**Example fields:** `api:hit`, `api:miss`, `gas:price:hit`, `defi:price:miss`

---

## Transaction Queue (In-Memory)

> **Important:** The current transaction queue (`backend/src/queue.ts`) is an **in-memory queue**, not Redis-backed. Jobs do not persist across process restarts. A BullMQ migration is planned.

### Job Schema

```typescript
interface TxJob {
  id: string;             // UUIDv4
  data: TxJobData;
  status: "waiting" | "active" | "completed" | "failed" | "dead";
  attempts: number;       // max 3
  createdAt: number;      // epoch ms
  updatedAt: number;      // epoch ms
  result?: string;
  error?: string;
}

interface TxJobData {
  type: "deposit" | "withdrawal" | "claim";
  walletAddress: string;
  amount: string;         // stringified to avoid float precision loss
  webhookUrl?: string;
  meta?: Record<string, unknown>;
}
```

### Retry Policy

| Setting | Value |
|---|---|
| Max attempts | 3 |
| Base delay | 1 000 ms |
| Back-off | `1000 × 2^(attempt-1)` ms (1 s → 2 s → 4 s) |
| Worker tick | 500 ms |

### Planned BullMQ Queue Names

When BullMQ is adopted, the Redis key patterns will be:

| Queue name | Purpose |
|---|---|
| `bull:tx-queue` | Blockchain transaction submissions |
| `bull:email-queue` | Email delivery jobs |
| `bull:yield-queue` | Yield calculation background jobs |

---

## Configuration Reference

### Cache TTLs (env vars)

| Env Var | Default | Description |
|---|---|---|
| `CACHE_API_TTL` | `60` s | General API response cache |
| `CACHE_DEFI_PRICE_TTL` | `30` s | DeFi token price cache |
| `CACHE_DEFI_POOL_TTL` | `60` s | DeFi pool data cache |
| `GAS_CACHE_TTL_MS` | `60000` ms | Gas price cache |

### Auth TTLs (hardcoded in `auth.ts`)

| Constant | Value | Description |
|---|---|---|
| `ACCESS_TOKEN_TTL` | `900 s` | 15-minute access token |
| `REFRESH_TOKEN_TTL` | `2 592 000 s` | 30-day refresh token |

### Connection (env vars)

| Env Var | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Single-node URL |
| `REDIS_PASSWORD` | — | AUTH password |
| `REDIS_TLS` | `false` | Enable TLS |
| `REDIS_CLUSTER` | — | Comma-separated `host:port` list for cluster mode |

---

## Key Naming Conventions

1. **Colon separator** — always use `:`.
2. **Namespace first** — broad category leads (`auth`, `api`, `rl`, `email`, etc.).
3. **Most-specific segment last** — IP address, user ID, token hash, etc.
4. **Hash long values** — raw JWTs and similar tokens are SHA-256 hashed before use as key IDs (`hashKey()` in `cache.ts`).
5. **No spaces or special characters** in any segment.
6. **Every key must have a TTL** unless explicitly documented as persistent with a defined manual invalidation path.
