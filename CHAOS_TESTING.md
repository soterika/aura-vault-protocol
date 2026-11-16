# Chaos Testing — Issue #870

Comprehensive chaos testing suite that randomly kills services (Redis, PostgreSQL, Horizon) and verifies the backend degrades gracefully.

## Overview

The chaos testing suite ensures that the Aura Vault backend can survive service failures without crashes or data loss:

- **Redis killed** → API returns cached responses or 503 gracefully
- **PostgreSQL killed** → API returns 503 with retryable error
- **Horizon unreachable** → Circuit breaker opens, cached data served
- **Service restarts** → Application recovers without restart
- **Monthly runs** → Automated testing in staging environment (CI/CD)

## Testing Strategy

### Acceptance Criteria

✅ **Redis Circuit Breaker**
- Fails open (returns null) instead of throwing errors
- Allows application to continue with degraded cache functionality
- Prometheus metrics track circuit state and failures

✅ **PostgreSQL Circuit Breaker**
- Opens after 80% error rate (minimum 5 calls)
- Returns 503 Service Unavailable with retryable error code
- Half-open probe after 30 seconds for recovery

✅ **Horizon Circuit Breaker**
- Already implemented with fallback caching
- Opens on 5 consecutive failures
- Serves cached responses while circuit is open

✅ **Graceful Degradation**
- `/api/health` endpoint reports circuit states
- Degradation middleware tracks all services
- Structured 503 responses with retry-after headers

✅ **Automatic Recovery**
- No application restart needed after service recovery
- Circuit breaker transitions: CLOSED → OPEN → HALF_OPEN → CLOSED
- Services automatically probed when circuit enters half-open

## Running Chaos Tests

### Local Development

```bash
# Install dependencies
cd backend
npm ci

# Run chaos tests locally
npm run test -- chaos.test.ts

# Verbose output
npm run test -- chaos.test.ts --reporter=verbose
```

### Staging Environment

```bash
# Start test infrastructure
docker-compose -f docker-compose.test.yml up -d

# Run chaos tests with service killing
cd backend
npm run test -- chaos.test.ts --reporter=verbose

# Simulate Redis failure
docker-compose -f docker-compose.test.yml stop redis
# ... verify API still works ...
docker-compose -f docker-compose.test.yml start redis

# Simulate PostgreSQL failure
docker-compose -f docker-compose.test.yml stop postgres
# ... verify API returns 503 ...
docker-compose -f docker-compose.test.yml start postgres

# Check service recovery
curl http://localhost:3001/api/health | jq .

# Cleanup
docker-compose -f docker-compose.test.yml down
```

### Monthly CI/CD Execution

Chaos tests run automatically on the **first day of each month at midnight UTC**:

```yaml
# .github/workflows/chaos-testing.yml
on:
  schedule:
    - cron: '0 0 1 * *'  # First day of month, midnight UTC
```

Trigger manually:

```bash
gh workflow run chaos-testing.yml
```

## Circuit Breaker Configuration

### Redis Circuit Breaker
- **Error threshold**: 80%
- **Volume threshold**: 3 (minimum calls before evaluation)
- **Timeout**: 2 seconds
- **Reset timeout**: 20 seconds (fast recovery for cache)
- **Fail mode**: Open (returns null instead of throwing)

### PostgreSQL Circuit Breaker
- **Error threshold**: 80%
- **Volume threshold**: 5 (minimum calls before evaluation)
- **Timeout**: 5 seconds
- **Reset timeout**: 30 seconds
- **Fail mode**: Closed (throws 503 error)

### Horizon Circuit Breaker
- **Error threshold**: 80%
- **Volume threshold**: 5
- **Timeout**: 10 seconds
- **Reset timeout**: 30 seconds
- **Fail mode**: Closed with fallback cache

## Monitoring

### Health Endpoint

```bash
curl http://localhost:3001/api/health | jq .
```

Response includes circuit breaker states:

```json
{
  "status": "degraded",
  "timestamp": "2026-08-31T12:00:00.000Z",
  "circuits": {
    "horizon": {
      "state": "CLOSED",
      "stats": { "failures": 0, "successes": 42, "latencyMean": 120 }
    },
    "database": {
      "state": "OPEN",
      "stats": { "failures": 5, "successes": 10, "latencyMean": 5000 }
    },
    "redis": {
      "state": "HALF_OPEN",
      "stats": { "failures": 3, "successes": 5, "latencyMean": 50 }
    }
  },
  "degradation": {
    "isDegraded": true,
    "database": true,
    "redis": false,
    "horizon": false,
    "message": "Service degraded: database unavailable"
  }
}
```

### Prometheus Metrics

Circuit breaker state and event counters exported at `/metrics`:

```
horizon_circuit_breaker_state{circuit="horizon-api"} 0
horizon_circuit_breaker_events_total{event="open"} 2
horizon_circuit_breaker_calls_total{outcome="success"} 150

database_circuit_breaker_state{circuit="database"} 1
database_circuit_breaker_events_total{event="open"} 1

redis_circuit_breaker_state{circuit="redis"} 2
redis_circuit_breaker_events_total{event="half_open"} 1
```

### Logs

Circuit breaker state changes logged to console:

```
[horizon-circuit-breaker] Circuit OPENED — Horizon calls will be rejected
[database-circuit-breaker] Circuit OPENED — database may be unavailable
[redis-circuit-breaker] Circuit HALF-OPEN — testing Redis connection
[redis-circuit-breaker] Circuit CLOSED — Redis operational
```

## Test Coverage

### Scenarios Tested

1. **Redis Unavailability**
   - Circuit breaker opens after 3 consecutive failures
   - Cache operations fail open (return null)
   - No errors thrown to client

2. **PostgreSQL Unavailability**
   - Circuit breaker opens after 5 consecutive failures
   - API returns 503 Service Unavailable
   - Retry-after header included

3. **Horizon Unreachability**
   - Circuit breaker opens after 5 consecutive failures
   - Fallback cache served for previously cached responses
   - New requests return 503 when no cache available

4. **Service Recovery**
   - Circuit breaker enters HALF_OPEN after 30s
   - Successful probe transitions to CLOSED
   - Application continues without restart

5. **Concurrent Failures**
   - Multiple simultaneous service failures handled
   - Degradation status accurately reports all failures
   - Health endpoint remains responsive

## Test Files

- `backend/src/chaos.test.ts` — Main chaos test suite (vitest)
- `.github/workflows/chaos-testing.yml` — Monthly CI/CD workflow
- `docker-compose.test.yml` — Test infrastructure (postgres, redis, backend)
- `CHAOS_TESTING.md` — This documentation

## Production Considerations

### Beyond Circuit Breakers

For production chaos testing, consider:

1. **Advanced Tools**
   - [Gremlin](https://www.gremlin.com/) — Attack simulations (chaos-as-a-service)
   - [Locust](https://locust.io/) — Load testing with chaos
   - [Pumba](https://github.com/alexei-led/pumba) — Docker chaos testing

2. **Network Chaos**
   - Latency injection (tc, toxiproxy)
   - Packet loss simulation (iptables)
   - Connection timeouts (firewall rules)

3. **Distributed Tracing**
   - Track requests across service boundaries
   - Identify cascade failures early
   - Correlate with circuit breaker state changes

4. **Alerting**
   - Alert when circuit opens (severity: warning)
   - Alert when circuit oscillates (severity: critical)
   - Page on-call for circuit opening in production

### Scaling Considerations

- Circuit breakers are **per-process**. In multi-process environments (PM2, K8s, Nomad):
  - Each process has its own circuit state
  - Aggregate metrics via Prometheus for cluster view
  - Use service mesh (Istio) for centralized circuit breaking

- For extreme load, consider:
  - **Bulkheads** (opossum plugin) to isolate resource pools
  - **Adaptive retry** logic based on service health
  - **Feature flags** to disable non-critical features under load

## References

- Opossum Circuit Breaker: https://github.com/nodeshift/opossum
- Chaos Engineering Principles: https://principlesofchaos.org/
- Circuit Breaker Pattern: https://martinfowler.com/bliki/CircuitBreaker.html
- Graceful Degradation: https://www.w3.org/wiki/Graceful_degradation

## Troubleshooting

### Circuit breaker stuck open

```bash
# Check circuit state
curl http://localhost:3001/api/health | jq '.circuits'

# Force half-open probe by waiting 30s
sleep 30
curl http://localhost:3001/api/health

# If still open, check service logs
docker-compose logs -f postgres  # or redis, backend
```

### Tests not running in CI/CD

1. Check workflow schedule is correct: `.github/workflows/chaos-testing.yml`
2. Verify staging environment secrets are configured
3. Ensure docker-compose service names match workflow

### Degradation middleware not reporting failures

1. Check circuit breaker configuration (thresholds, timeouts)
2. Verify `/api/health` endpoint is callable
3. Check logs for circuit state transitions

---

**Last updated**: August 2026
**Maintainer**: Aura Vault Team
