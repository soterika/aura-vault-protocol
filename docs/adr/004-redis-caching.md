# ADR-004: Redis for Caching vs In-Memory

## Status

Accepted

## Context

The Aura Vault Protocol backend requires caching for several use cases:
- API response caching for vault statistics and DeFi prices
- Session storage for JWT token blacklisting
- Rate limiting counters per IP and user
- Job queue state for background workers

We evaluated several caching solutions:

1. **In-memory caching**: Using JavaScript Maps, Node.js built-in cache, or libraries like node-cache
2. **Redis**: External key-value store with advanced data structures and persistence
3. **Memcached**: Simple distributed memory caching system
4. **Database caching**: Using PostgreSQL for cache storage

The choice impacts scalability, reliability, operational complexity, and development velocity.

## Decision

We will use Redis as our primary caching and session storage solution, with fallback to in-memory caching for non-critical operations when Redis is unavailable.

## Consequences

### Positive

- **Horizontal scalability**: Multiple backend instances can share the same cache, enabling load balancing
- **Persistence**: Optional data persistence survives application restarts, reducing cold start penalties
- **Rich data structures**: Lists, sets, sorted sets, and hashes enable sophisticated caching patterns
- **Atomic operations**: Built-in atomic increment/decrement for rate limiting and counters
- **TTL support**: Automatic expiration of cache entries without manual cleanup
- **Pub/sub capability**: Real-time event distribution between services (future use)
- **Mature ecosystem**: Well-tested, widely adopted, extensive monitoring and operational tooling
- **BullMQ integration**: Seamless job queue implementation using Redis as the backing store
- **Memory efficiency**: Optimized memory usage with configurable eviction policies

### Negative

- **Operational complexity**: Additional service to deploy, monitor, and maintain
- **Network dependency**: Cache operations require network round trips, adding latency
- **Single point of failure**: Cache unavailability affects application performance (mitigated by fallbacks)
- **Memory costs**: Requires dedicated memory allocation separate from application instances
- **Security considerations**: Network service requires authentication and network security configuration

### Neutral

- **Development complexity**: Redis client integration is straightforward but adds dependency management
- **Monitoring requirements**: Need metrics and alerting for Redis health and performance
- **Data consistency**: Eventual consistency model appropriate for caching but requires careful design

## Notes

Redis configuration includes:
- **Single-node mode** for development and small deployments via `REDIS_URL`
- **Cluster mode** for production high availability via `REDIS_CLUSTER` environment variable
- **Configurable TTLs** for different cache types: API responses (60s), DeFi prices (300s), sessions (30d)
- **Graceful fallbacks** to in-memory caching when Redis is unreachable

Cache implementation provides:
- `CacheService.get/set/del` for basic operations
- `CacheService.getOrSet` for cache-aside pattern
- Rate limiting using Redis counters with sliding window
- JWT blacklist storage with automatic cleanup

Alternative solutions rejected:
- **In-memory only**: Doesn't scale beyond single instance
- **Database caching**: Adds load to PostgreSQL and lacks Redis's specialized features  
- **Memcached**: Less feature-rich than Redis, no persistence or complex data structures

References:
- [Redis Documentation](https://redis.io/docs/)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Node Redis Client](https://github.com/redis/node-redis)