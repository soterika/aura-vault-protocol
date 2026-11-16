# Redis Caching Strategy

**Aura Vault Protocol — Issue #422**
Last updated: 2026-08-24

---

## Overview

The Aura Vault backend caches read-heavy Soroban contract queries and derived metrics in Redis to reduce RPC load, lower response latency, and prevent rate-limit exhaustion against Stellar Horizon and Soroban RPC endpoints. This document defines what is cached, for how long, when caches are invalidated, and how the system is operated.

---

## 1. Cache Inventory

All keys use the prefix `aura:` to namespace the application's data within a shared Redis instance.

| Key Pattern | Value | TTL | Invalidation Trigger |
|---|---|---|---|
| `aura:total_assets` | `u128` — total underlying tokens in vault | 15 s | Harvest event, deposit event, withdraw event |
| `aura:total_shares` | `u128` — total vault shares outstanding | 15 s | Deposit event, withdraw event |
| `aura:exchange_rate` | `f64` — `total_assets / total_shares` | 15 s | Any event that changes `total_assets` or `total_shares` |
| `aura:apy:7d` | `f64` — 7-day trailing annualized yield | 5 min | Harvest event |
| `aura:apy:30d` | `f64` — 30-day trailing annualized yield | 5 min | Harvest event |
| `aura:is_paused` | `bool` — vault pause state | 10 s | Pause event, Unpause event |
| `aura:balance:{address}` | `u128` — share balance for address | 30 s | Deposit or withdraw event for that address |
| `aura:tx_history:{address}:{page}` | JSON array — paginated tx list | 60 s | Deposit or withdraw event for that address |
| `aura:tx_history:all:{page}` | JSON array — global paginated tx list | 30 s | Any vault event |
| `aura:harvest_history:{page}` | JSON array — paginated harvest list | 5 min | Harvest event |
| `aura:ledger:latest` | `u32` — latest processed ledger sequence | 5 s | Polled every 5 s by indexer |
| `aura:contract_meta` | JSON — contract ID, token address, decimals | 24 h | Manual admin invalidation on contract migration |
| `aura:health` | JSON — API health snapshot | 30 s | Written by health-check worker |

### Key Format Examples

```
aura:total_assets
aura:balance:GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
aura:tx_history:GXXX...:0          # page 0 for a specific address
aura:tx_history:all:0              # global page 0
```

---

## 2. Cache Warming Strategy

Cold cache (empty Redis) causes all requests to fall through to the Soroban RPC, which can overwhelm rate limits at startup. The following warming strategy minimizes cold-start latency.

### 2.1 Startup Warming Sequence

On API server start (or Redis reconnect), the warming worker runs this sequence synchronously before the API begins accepting traffic:

```
1. Fetch and cache `aura:is_paused`          (critical — gates all operations)
2. Fetch and cache `aura:total_assets`
3. Fetch and cache `aura:total_shares`
4. Compute and cache `aura:exchange_rate`
5. Fetch and cache `aura:apy:7d`, `aura:apy:30d`
6. Fetch and cache `aura:contract_meta`
7. Pre-warm `aura:tx_history:all:0` (most recent global tx page)
8. Pre-warm `aura:ledger:latest`
```

Steps 1–6 must complete before the server health check returns `200 OK`. Steps 7–8 are best-effort and run in the background.

```typescript
// Pseudocode: startup warming
async function warmCache(redis: RedisClient, rpc: SorobanRpcClient) {
  await Promise.all([
    cacheIsPaused(redis, rpc),
    cacheTotalAssets(redis, rpc),
    cacheTotalShares(redis, rpc),
  ]);
  await cacheExchangeRate(redis);        // depends on assets + shares
  await Promise.all([
    cacheApy(redis, '7d'),
    cacheApy(redis, '30d'),
    cacheContractMeta(redis, rpc),
    cacheLedger(redis, rpc),
  ]);
  // background
  warmGlobalTxHistory(redis).catch(console.error);
}
```

### 2.2 Event-Driven Warming

After the indexer processes a new contract event, it immediately re-fetches and caches the affected keys before publishing the event to application consumers. This keeps the cache warm and consistent rather than waiting for the next TTL expiry.

---

## 3. Cache Invalidation Rules

Invalidation uses a combination of TTL expiry and event-driven deletion.

### 3.1 Event-Driven Invalidation

The event indexer listens for Soroban contract events and issues targeted `DEL` commands:

| Contract Event | Keys Invalidated |
|---|---|
| `deposit(caller, amount, shares_minted)` | `aura:total_assets`, `aura:total_shares`, `aura:exchange_rate`, `aura:balance:{caller}`, `aura:tx_history:{caller}:*`, `aura:tx_history:all:*` |
| `withdraw(caller, shares_burned, amount)` | Same as deposit |
| `harvest(caller, yield_amount)` | `aura:total_assets`, `aura:exchange_rate`, `aura:apy:7d`, `aura:apy:30d`, `aura:harvest_history:*`, `aura:tx_history:all:*` |
| `pause` | `aura:is_paused` |
| `unpause` | `aura:is_paused` |
| `suspicious` | `aura:total_assets`, `aura:exchange_rate`, `aura:is_paused` |

Pattern-delete (e.g., `aura:tx_history:{address}:*`) uses Redis `SCAN` + `DEL` — never `KEYS *` in production.

```typescript
// Pattern invalidation — safe for production
async function invalidatePattern(redis: RedisClient, pattern: string) {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    cursor = nextCursor;
  } while (cursor !== '0');
}
```

### 3.2 TTL as Safety Net

TTLs serve as a fallback — if an event is missed or the indexer lags, stale data expires automatically. Set TTLs to be short enough that staleness is tolerable but long enough to meaningfully reduce RPC calls.

### 3.3 Manual Invalidation

Admins can flush specific keys or all vault cache entries via the internal admin API:

```bash
# Flush a single key
curl -X DELETE https://api.auravault.fi/admin/cache/key/aura:total_assets \
  -H "Authorization: Bearer <admin-token>"

# Flush all aura: keys (use with caution — triggers re-warm)
curl -X DELETE https://api.auravault.fi/admin/cache/flush \
  -H "Authorization: Bearer <admin-token>"
```

---

## 4. Cache Stampede Protection

A cache stampede (thundering herd) occurs when many concurrent requests find the same key expired and all attempt to recompute simultaneously, flooding the upstream RPC.

### 4.1 Probabilistic Early Recomputation (PER)

Recompute the cache slightly before expiry using a probabilistic approach, preventing a simultaneous miss:

```typescript
/**
 * Probabilistic Early Recomputation
 * Recomputes before TTL expires based on remaining TTL and computation cost.
 * beta = 1.0 is standard; increase to recompute earlier.
 */
async function getWithPER<T>(
  redis: RedisClient,
  key: string,
  ttl: number,
  fetch: () => Promise<T>,
  beta = 1.0,
): Promise<T> {
  const cached = await redis.get(key);
  const remainingTtl = await redis.pttl(key);  // milliseconds

  if (cached !== null) {
    // Probabilistically recompute if close to expiry
    const shouldRecompute = -beta * ttl * 1000 * Math.log(Math.random()) >= remainingTtl;
    if (!shouldRecompute) {
      return JSON.parse(cached) as T;
    }
  }

  // Recompute and cache
  const value = await fetch();
  await redis.set(key, JSON.stringify(value), 'PX', ttl * 1000);
  return value;
}
```

### 4.2 Distributed Lock (Mutex) for Expensive Keys

For computationally or network-expensive keys (APY calculation, global tx history), use a Redis lock to ensure only one worker recomputes at a time:

```typescript
async function getWithLock<T>(
  redis: RedisClient,
  key: string,
  ttl: number,
  fetch: () => Promise<T>,
): Promise<T> {
  const lockKey = `${key}:lock`;
  const cached = await redis.get(key);
  if (cached !== null) return JSON.parse(cached) as T;

  // Try to acquire lock (SET NX PX)
  const acquired = await redis.set(lockKey, '1', 'NX', 'PX', 5000); // 5s lock TTL
  if (!acquired) {
    // Another worker is computing — poll briefly then return stale or wait
    await sleep(200);
    const retried = await redis.get(key);
    if (retried !== null) return JSON.parse(retried) as T;
    // Fall through to RPC if still not available
  }

  try {
    const value = await fetch();
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
    return value;
  } finally {
    await redis.del(lockKey);
  }
}
```

### 4.3 Stale-While-Revalidate

For non-critical keys, serve stale data while refreshing in the background:

```typescript
async function getStaleWhileRevalidate<T>(
  redis: RedisClient,
  key: string,
  staleKey: string,
  ttl: number,
  fetch: () => Promise<T>,
): Promise<T> {
  const fresh = await redis.get(key);
  if (fresh !== null) return JSON.parse(fresh) as T;

  const stale = await redis.get(staleKey);
  if (stale !== null) {
    // Serve stale immediately, revalidate in background
    fetch().then(value => {
      redis.set(key, JSON.stringify(value), 'EX', ttl);
      redis.set(staleKey, JSON.stringify(value), 'EX', ttl * 10);
    }).catch(console.error);
    return JSON.parse(stale) as T;
  }

  // No data at all — must wait
  const value = await fetch();
  await redis.set(key, JSON.stringify(value), 'EX', ttl);
  await redis.set(staleKey, JSON.stringify(value), 'EX', ttl * 10);
  return value;
}
```

---

## 5. Redis Eviction Policy and Memory Sizing

### 5.1 Eviction Policy

Use `allkeys-lru` (evict least recently used keys across all keys when memory is full):

```
# redis.conf
maxmemory-policy allkeys-lru
```

Rationale: vault cache keys are all regenerable from the Soroban RPC. LRU ensures infrequently accessed keys (old paginated tx history) are evicted before hot keys (exchange rate, balances).

Do **not** use `noeviction` — a full Redis under `noeviction` will cause write failures and crash the API.

### 5.2 Memory Sizing

Estimate memory requirements:

| Key Category | Key Count | Value Size | Total |
|---|---|---|---|
| Scalar metrics (total_assets, rate, apy, etc.) | ~10 | ~50 B | ~500 B |
| Per-address balances | ~50,000 active | ~80 B | ~4 MB |
| Per-address tx history (page 0 only) | ~50,000 active | ~2 KB | ~100 MB |
| Global tx history (10 pages) | 10 | ~20 KB | ~200 KB |
| Harvest history (5 pages) | 5 | ~10 KB | ~50 KB |

**Recommended starting allocation:** 512 MB for up to ~100,000 active addresses. Set `maxmemory 512mb` and monitor actual usage. Scale to 1 GB if eviction rate exceeds 5% of all operations.

```
# redis.conf
maxmemory 512mb
maxmemory-policy allkeys-lru
```

### 5.3 Persistence

Vault cache data is entirely regenerable — persistence is not required for correctness. Disable AOF to reduce I/O overhead:

```
# redis.conf
appendonly no
save ""          # disable RDB snapshots
```

If Redis restarts, the startup warming sequence (Section 2.1) repopulates critical keys before the API serves traffic.

---

## 6. Monitoring Cache Hit/Miss Ratios

### 6.1 Key Metrics to Track

| Metric | Description | Alert Threshold |
|---|---|---|
| `keyspace_hits` | Total successful cache lookups | — |
| `keyspace_misses` | Total failed cache lookups | — |
| Hit ratio | `hits / (hits + misses)` | Alert if < 80% over 5 min |
| `evicted_keys` | Keys evicted due to memory pressure | Alert if > 100/min |
| `used_memory_rss` | Actual memory used by Redis | Alert if > 80% of maxmemory |
| `connected_clients` | Active Redis connections | Alert if > 80% of maxclients |
| `rdb_last_bgsave_status` | RDB save status | Alert if `err` (if RDB enabled) |

### 6.2 Prometheus / Grafana Setup

Use `redis_exporter` to expose Redis metrics to Prometheus:

```yaml
# docker-compose.yml excerpt
redis-exporter:
  image: oliver006/redis_exporter:v1.58.0
  environment:
    REDIS_ADDR: redis://redis:6379
  ports:
    - "9121:9121"
```

Recommended Grafana dashboard: [Redis Dashboard for Prometheus — ID 763](https://grafana.com/grafana/dashboards/763)

### 6.3 Per-Key Hit Rate Logging

Log cache hits and misses at the application layer for fine-grained visibility:

```typescript
async function cachedGet<T>(
  redis: RedisClient,
  key: string,
  fetch: () => Promise<T>,
  ttl: number,
  metrics: MetricsClient,
): Promise<T> {
  const cached = await redis.get(key);
  if (cached !== null) {
    metrics.increment('cache.hit', { key: keyCategory(key) });
    return JSON.parse(cached) as T;
  }
  metrics.increment('cache.miss', { key: keyCategory(key) });
  const value = await fetch();
  await redis.set(key, JSON.stringify(value), 'EX', ttl);
  return value;
}
```

Track hit/miss by key category (e.g., `balance`, `tx_history`, `metrics`) rather than individual keys to avoid high cardinality in the metrics system.

### 6.4 Alerting Rules

```yaml
# Prometheus alerting rules
groups:
  - name: redis_cache
    rules:
      - alert: RedisCacheHitRateLow
        expr: |
          rate(redis_keyspace_hits_total[5m]) /
          (rate(redis_keyspace_hits_total[5m]) + rate(redis_keyspace_misses_total[5m])) < 0.80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis cache hit rate below 80%"

      - alert: RedisHighEvictionRate
        expr: rate(redis_evicted_keys_total[1m]) > 100
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Redis evicting > 100 keys/min — consider increasing maxmemory"

      - alert: RedisMemoryHigh
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.80
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Redis memory usage above 80% of maxmemory"
```

---

## 7. Connection Pool Configuration

```typescript
// Recommended Redis client configuration (ioredis)
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
  maxRetriesPerRequest: 3,
  enableOfflineQueue: false,    // fail fast if Redis is down rather than queueing
  connectTimeout: 2000,
  commandTimeout: 1000,
  lazyConnect: false,
});
```

Use a connection pool of 10–20 connections for the API tier. The indexer and warming worker share a separate pool of 5 connections.
