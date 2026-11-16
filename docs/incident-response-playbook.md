# Aura Vault — Incident Response Playbook

This playbook provides step-by-step response procedures for the most likely production incidents. Each scenario includes detection signals, immediate containment actions, investigation steps, resolution procedures, and post-mortem guidance.

For severity levels and general communication templates see the existing [runbook](./disaster-recovery/runbook.md). This playbook focuses exclusively on scenario-specific technical procedures.

---

## Severity Reference

| Level | SLA (acknowledge) | SLA (resolve) | Examples |
|-------|-------------------|---------------|---------|
| **P0** | 15 min | 2 hours | Vault paused unexpectedly, balance mismatch detected |
| **P1** | 30 min | 4 hours | Backend API 5xx spike, DB connection pool exhausted |
| **P2** | 2 hours | 24 hours | Horizon unreachable, elevated latency |
| **P3** | Next business day | — | Non-critical degradation |

---

## Scenario 1 — Vault Paused Unexpectedly

**Severity:** P0

A `paused` event appears on-chain without a corresponding planned maintenance window, or users report that `deposit`, `withdraw`, and `harvest` calls return `VaultPaused` (error code 11).

### Detection

| Signal | Where to Check |
|--------|---------------|
| Horizon event stream emits `paused` event | Webhook event log; Grafana "Contract Events" panel |
| On-chain calls return error code `11` | User error reports; backend API error logs |
| PagerDuty alert fires on `vault_paused` CloudWatch metric | PagerDuty app; `#incidents` Slack channel |

```bash
# Confirm vault is paused via Stellar CLI
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <read-only-keypair> \
  --network mainnet \
  -- is_paused
# Expected response if paused: true
```

### Immediate Actions (< 15 min)

1. **Acknowledge** in PagerDuty. Post in `#incidents`: "P0 — Vault paused unexpectedly. Investigating."
2. **Do not unpause immediately.** A pause may have been triggered by the flash-loan guard (`suspicious` event) — see Scenario 4. Unpausing into an active attack makes things worse.
3. **Check for a concurrent `suspicious` event:**

```bash
# Fetch recent contract events — look for 'suspicious' before 'paused'
curl "https://horizon.stellar.org/contracts/<CONTRACT_ID>/events?order=desc&limit=20"
```

4. If a `suspicious` event is found, escalate to **Scenario 4** first.
5. **Notify users** via status page: "Vault operations are temporarily halted. Funds are safe. Investigation in progress."

### Investigation

1. **Identify who called `pause()`** — check the `paused` event; the admin address is in the event topics. Cross-reference with the key management log.

```bash
# Find the transaction that emitted 'paused'
curl "https://horizon.stellar.org/contracts/<CONTRACT_ID>/events?topic[0]=paused&order=desc&limit=5"
```

2. **Verify admin key integrity** — check that the admin keypair is secure. If the admin key may have been compromised, treat as a security incident and rotate immediately before unpausing.

3. **Check for infrastructure-triggered pause** — some automated monitoring scripts may be configured to call `pause()` on threshold breaches. Check CloudWatch events and Lambda execution logs:

```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/aura-vault-monitor \
  --start-time $(date -d '2 hours ago' +%s000) \
  --filter-pattern "pause"
```

4. **Review deployment history** — if a contract upgrade (issue #427-related `upgrade` event) preceded the pause, a post-upgrade health check may have triggered the pause automatically.

### Resolution

Once the root cause is identified and confirmed safe:

```bash
# Unpause the vault
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <admin-keypair> \
  --network mainnet \
  -- unpause \
  --admin <ADMIN_ADDRESS>
```

Verify:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <read-only-keypair> \
  --network mainnet \
  -- is_paused
# Expected: false
```

Monitor the Horizon event stream for the `unpaused` event and confirm `deposit`/`withdraw` calls succeed.

### Post-Mortem

- Timeline: when was the `paused` event emitted? When was it detected? When was it resolved?
- Root cause: authorized maintenance, automated health check, admin key compromise, or unknown?
- Action items:
  - If unauthorized: rotate admin keys, review access control list, add `pause` action to audit log alerts.
  - If automated: document the trigger, add runbook reference to the alerting rule.
  - Reduce time-to-detect by adding a Grafana alert on the `paused` event within 5 minutes of emission.

---

## Scenario 2 — Backend API Down (5xx Spike)

**Severity:** P1

The backend Express API (`/api/*`) is returning HTTP 5xx errors at elevated rates. Users cannot fetch portfolio data, trigger email notifications, or use webhook management endpoints.

### Detection

| Signal | Where to Check |
|--------|---------------|
| CloudWatch ALB metric `HTTPCode_Target_5XX_Count` > threshold | Grafana "API Health" panel; CloudWatch alarms |
| Health endpoint returns non-200 or `"status":"degraded"` | `curl https://api.aura-vault.xyz/api/health` |
| Error rate alert in PagerDuty | `#incidents` Slack channel |
| User reports of failed portfolio loads | Support tickets |

```bash
# Check health endpoint
curl -s https://api.aura-vault.xyz/api/health | jq .

# Check ECS task health
aws ecs list-tasks \
  --cluster aura-vault-prod \
  --desired-status RUNNING \
  --query 'taskArns' \
  --output json

# Tail recent error logs
aws logs tail /ecs/aura-vault-backend \
  --since 30m \
  --filter-pattern "ERROR"
```

### Immediate Actions (< 30 min)

1. **Acknowledge** in PagerDuty. Post in `#incidents`.
2. **Check if the issue is Redis or database-related** — the health endpoint explicitly checks Redis:

```bash
curl -s https://api.aura-vault.xyz/api/health
# {"status":"degraded","redis":false,...}  → Redis is the root cause
# {"status":"ok","redis":true,...}         → Issue is elsewhere
```

3. **Check ECS task count** — if tasks are crashing and restarting, the issue is in the application code or its dependencies:

```bash
aws ecs describe-services \
  --cluster aura-vault-prod \
  --services aura-vault-backend \
  --query 'services[0].{running:runningCount,desired:desiredCount,pending:pendingCount}'
```

4. **If running < desired** → tasks are crash-looping. Proceed to investigation.
5. **If running = desired** → tasks are up but returning errors. Check application logs.

### Investigation

**Application errors:**

```bash
# Get the most recent 100 ERROR lines
aws logs filter-log-events \
  --log-group-name /ecs/aura-vault-backend \
  --start-time $(date -d '1 hour ago' +%s000) \
  --filter-pattern "ERROR" \
  --limit 100 \
  --query 'events[*].message' \
  --output text
```

**Database errors:**

```bash
# Check RDS status
aws rds describe-db-instances \
  --db-instance-identifier aura-vault-prod \
  --query 'DBInstances[0].{status:DBInstanceStatus,connections:Endpoint}'

# Check for connection errors in logs
aws logs filter-log-events \
  --log-group-name /ecs/aura-vault-backend \
  --start-time $(date -d '1 hour ago' +%s000) \
  --filter-pattern "ECONNREFUSED ETIMEDOUT connection"
```

**Recent deployments:**

```bash
# Check ECS task definition history
aws ecs describe-task-definition \
  --task-definition aura-vault-backend \
  --query 'taskDefinition.revision'

# Compare with the previously stable revision
aws ecs describe-task-definition \
  --task-definition aura-vault-backend:<previous-revision>
```

### Resolution

**Option A — Rollback to previous task definition:**

```bash
aws ecs update-service \
  --cluster aura-vault-prod \
  --service aura-vault-backend \
  --task-definition aura-vault-backend:<last-known-good-revision> \
  --force-new-deployment
```

**Option B — Scale up to absorb traffic while investigating:**

```bash
aws ecs update-service \
  --cluster aura-vault-prod \
  --service aura-vault-backend \
  --desired-count 4
```

**Option C — If Redis is down**, see Scenario 3 for DB pool exhaustion patterns; Redis recovery follows the same isolation steps.

After resolution, verify:

```bash
# Poll health until status: ok
watch -n 5 'curl -s https://api.aura-vault.xyz/api/health | jq .'
```

### Post-Mortem

- Was this caused by a bad deployment? Add deployment smoke tests to the CI pipeline.
- Was it a dependency failure (Redis, RDS)? Add dependency health checks to the deployment gate.
- Did the auto-scaling policy respond fast enough? Review CloudWatch scaling policies.

---

## Scenario 3 — Database Connection Pool Exhausted

**Severity:** P1

The backend cannot acquire new database connections. Requests that require DB access fail with `ECONNREFUSED`, `connection timeout`, or `remaining connection slots are reserved` errors.

### Detection

| Signal | Where to Check |
|--------|---------------|
| RDS CloudWatch metric `DatabaseConnections` near `max_connections` | Grafana "Database" panel; CloudWatch |
| Backend logs contain `remaining connection slots are reserved` | ECS log group |
| Portfolio API endpoints return 500 with database error | API monitoring; error logs |
| PagerDuty `rds_connection_pool_high` alarm | `#incidents` Slack |

```bash
# Check current connection count vs. max
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=aura-vault-prod \
  --start-time $(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 \
  --statistics Average Maximum \
  --output table
```

### Immediate Actions (< 30 min)

1. **Do not restart the database** — this would cause a brief outage and lose existing connections cleanly.
2. **Identify long-running or idle connections holding slots:**

```sql
-- Run via RDS query editor or psql
SELECT pid, usename, application_name, state, wait_event_type,
       now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE datname = 'aura_vault'
  AND state != 'idle'
ORDER BY duration DESC
LIMIT 20;
```

3. **Kill long-running idle connections if safe:**

```sql
-- Terminate connections idle for > 10 minutes
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'aura_vault'
  AND state = 'idle'
  AND now() - state_change > interval '10 minutes';
```

4. **Reduce load immediately** — temporarily scale down backend tasks to reduce connection demand:

```bash
aws ecs update-service \
  --cluster aura-vault-prod \
  --service aura-vault-backend \
  --desired-count 1
```

### Investigation

1. **Find the connection source:**

```sql
SELECT application_name, state, COUNT(*)
FROM pg_stat_activity
WHERE datname = 'aura_vault'
GROUP BY application_name, state
ORDER BY count DESC;
```

2. **Check for connection leaks in application code** — look for database transactions that are opened but not closed (missing `client.release()` in node-postgres, for example).

3. **Review connection pool configuration** in `backend/src/`:

```bash
grep -r "pool\|pg.Pool\|connectionLimit\|max:" /workspaces/aura-vault-protocol/backend/src/
```

4. **Check RDS `max_connections`** parameter group setting:

```bash
aws rds describe-db-parameters \
  --db-parameter-group-name aura-vault-prod \
  --query "Parameters[?ParameterName=='max_connections']"
```

5. **Look for long-running queries blocking others:**

```sql
SELECT pid, query, wait_event, wait_event_type,
       now() - query_start AS duration
FROM pg_stat_activity
WHERE wait_event IS NOT NULL
  AND datname = 'aura_vault'
ORDER BY duration DESC;
```

### Resolution

**Short-term:**

- Terminate idle connections (step above).
- Scale backend tasks back up after pool pressure reduces.
- If a specific query is the blocker, kill it: `SELECT pg_cancel_backend(<pid>);`

**Medium-term:**

- Add `pgBouncer` in front of RDS to pool connections at the infrastructure layer.
- Set a `statement_timeout` in the connection pool config (e.g., 30 seconds).
- Add `idleTimeoutMillis` and `connectionTimeoutMillis` to the node-postgres pool.

**RDS parameter change (requires instance reboot):**

```bash
aws rds modify-db-parameter-group \
  --db-parameter-group-name aura-vault-prod \
  --parameters "ParameterName=max_connections,ParameterValue=200,ApplyMethod=pending-reboot"
```

### Post-Mortem

- Root cause: connection leak, sudden traffic spike, long-running query, or under-provisioned `max_connections`?
- Was `pgBouncer` already planned? Prioritise the infrastructure work.
- Add a CloudWatch alarm at 70% of `max_connections` (not 90%) to give more lead time.

---

## Scenario 4 — Suspicious Balance Mismatch Event Detected

**Severity:** P0

The `suspicious` event is emitted on-chain, indicating the vault's actual token balance does not match `total_deposited`. This is the flash-loan guard firing. All mutating operations (`deposit`, `withdraw`, `harvest`) automatically reject with `BalanceMismatch` (error code 12) until the discrepancy is resolved.

### Detection

| Signal | Where to Check |
|--------|---------------|
| Webhook endpoint receives `suspicious` event payload | Backend webhook logs; `#security-alerts` Slack |
| Grafana alert `suspicious_event_count > 0` fires | `#incidents` and `#security-alerts` channels |
| Backend API logs `BalanceMismatch` errors from users | ECS logs |
| Horizon event stream emits `suspicious` topic | Direct Horizon polling |

```bash
# Retrieve the suspicious event from Horizon
curl "https://horizon.stellar.org/contracts/<CONTRACT_ID>/events?topic[0]=suspicious&order=desc&limit=5"
```

The `data` field contains:
- `reason`: always `"balance_mismatch"`
- `balance_before`: what the contract actually found on-chain
- `total_deposited`: what the contract expected

### Immediate Actions (< 15 min)

1. **Do not attempt to "fix" the balance manually.** Any direct token transfer to or from the vault address outside of contract calls will change the balance and may trigger the guard again.
2. **If the vault is not already paused**, pause it immediately to prevent users from hitting the error repeatedly:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <admin-keypair> \
  --network mainnet \
  -- pause \
  --admin <ADMIN_ADDRESS>
```

3. **Post in `#security-alerts`**: "P0 — Suspicious balance mismatch detected on AuraVault. Contract paused. Security team paged."
4. **Page the security lead** and the protocol's external security contact if one exists.
5. Update the status page: "Vault operations are temporarily suspended while we investigate a security alert. No funds have been confirmed lost."

### Investigation

1. **Quantify the discrepancy:**

```
discrepancy = balance_before - total_deposited
```

Positive = more tokens in vault than expected (a deposit bypassing the contract, or a gift).
Negative = fewer tokens than expected (potential drain / exploit).

2. **Examine the transaction that triggered the event:**

```bash
# Get the tx hash from the event record
curl "https://horizon.stellar.org/contracts/<CONTRACT_ID>/events?topic[0]=suspicious&order=desc&limit=1"
# Then look up the full transaction
curl "https://horizon.stellar.org/transactions/<TX_HASH>"
```

3. **Trace all token transfers to/from the vault address in the past 24 hours:**

```bash
curl "https://horizon.stellar.org/accounts/<CONTRACT_ID>/payments?order=desc&limit=50"
```

4. **Check for any known flash-loan protocols on Stellar testnet/mainnet** that may have attempted to manipulate the vault.

5. **Consult the contract code:** `lib.rs` checks the balance at the entry of `deposit`, `withdraw`, and `harvest`. The mismatch must have occurred between two of these calls. Look for SEP-41 `transfer` calls targeting the vault address that did not go through the vault interface.

6. **Review backend logs for any unusual API activity** immediately before the event:

```bash
aws logs filter-log-events \
  --log-group-name /ecs/aura-vault-backend \
  --start-time $(date -d '2 hours ago' +%s000) \
  --filter-pattern "deposit withdraw harvest"
```

### Resolution

**If the discrepancy is a positive balance (extra tokens in vault):**

These are typically harmless "donation" transfers — someone sent tokens directly to the vault contract address. The vault cannot automatically absorb them because they bypass `total_deposited`. Options:

- **Option A (recommended):** Deploy a contract upgrade that allows the admin to "reconcile" the tracked `total_deposited` to match the actual balance, then unpause.
- **Option B:** Accept the discrepancy as a permanent offset if the amount is negligible and it is operationally safe to do so. Note: this requires a contract change to tolerate bounded mismatch.

**If the discrepancy is a negative balance (tokens missing):**

This indicates a potential exploit. **Do not unpause.** Escalate immediately:

1. Notify all relevant parties (security team, auditors, legal).
2. Engage the smart contract auditing firm listed in `SECURITY.md`.
3. Prepare a user communication explaining the situation with available facts.
4. Do not speculate on the root cause publicly until the investigation is complete.

After root cause is confirmed and a fix is deployed and audited:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <admin-keypair> \
  --network mainnet \
  -- unpause \
  --admin <ADMIN_ADDRESS>
```

### Post-Mortem

- Was this a genuine attack, an accidental direct transfer, or a legitimate flash-loan (even if benign)?
- Should the contract be updated to tolerate small bounded mismatches (e.g., `abs(balance - total_deposited) < DUST_THRESHOLD`)?
- Add automated security monitoring: any `suspicious` event should page on-call security within 2 minutes.
- Review all open flash-loan vectors on Stellar and document mitigations in `SECURITY.md`.

---

## Scenario 5 — Horizon API Unreachable

**Severity:** P2

The Horizon REST/SSE API is unavailable or returning errors. The backend cannot fetch contract events, and the webhook delivery system cannot confirm on-chain transactions.

### Detection

| Signal | Where to Check |
|--------|---------------|
| Backend logs contain `ECONNREFUSED`, `timeout`, or `522`/`503` errors for Horizon requests | ECS log group |
| Webhook events are not being dispatched despite on-chain activity | Webhook delivery log: `GET /api/webhooks/:id/deliveries` |
| Grafana "Horizon Latency" panel shows elevated p99 or no data | Grafana monitoring dashboard |
| Stellar status page reports Horizon degradation | https://status.stellar.org |

```bash
# Manual check against Stellar Foundation Horizon
curl -s "https://horizon.stellar.org/" | jq '.horizon_version'

# Check testnet
curl -s "https://horizon-testnet.stellar.org/" | jq '.horizon_version'

# Check the backend's configured Horizon endpoint
curl -s "$HORIZON_URL/" | jq '.horizon_version'
```

### Immediate Actions (< 2 hours)

1. **Acknowledge** in PagerDuty.
2. **Confirm scope** — is this affecting the Stellar Foundation Horizon, a self-hosted Horizon node, or both?

```bash
# Check Stellar status
curl -s "https://api.stellarbeat.io/v1/nodes" | jq '.[] | select(.active == true) | .name' | head -10
```

3. **Switch to a fallback Horizon endpoint** — update the `HORIZON_URL` environment variable to a public fallback:

```bash
# Fallback options (check current availability before switching):
# https://horizon.stellar.lobstr.co
# https://stellar-horizon.bitgo.com
# https://horizon.stellarx.com

aws ecs update-service \
  --cluster aura-vault-prod \
  --service aura-vault-backend \
  --force-new-deployment
# (ensure HORIZON_URL env var is set to the fallback in the task definition)
```

4. **Communicate** to users: "On-chain data may be delayed. Transaction submissions still work via the Stellar network directly. We are using a backup data provider."

### Investigation

1. **Determine if this is a full outage or rate limiting:**

```bash
# Check HTTP status and response body
curl -v "https://horizon.stellar.org/transactions?limit=1" 2>&1 | head -30
```

- HTTP `429` → rate limited. Check if the backend is using an API key.
- HTTP `503`/`522` → Horizon node overloaded or network issue.
- `ECONNREFUSED` → DNS or firewall issue.

2. **Check if the Stellar network itself is healthy** (Horizon outage vs. network outage):

```bash
# The Stellar network can be queried without Horizon via raw horizon peers
curl -s "https://api.stellarbeat.io/v1/" | jq '.nodeCount, .organizationCount'
```

3. **Review backend Horizon client configuration** — check timeout settings and retry logic in `backend/src/services/`:

```bash
grep -r "horizon\|HORIZON" /workspaces/aura-vault-protocol/backend/src/ | grep -v ".test."
```

4. **Check event replay gap** — determine the last successfully processed ledger to know how far behind the system will be after Horizon recovers:

```bash
# Query the last delivered webhook event timestamp
curl -s "https://api.aura-vault.xyz/api/webhooks/<id>/deliveries" | \
  jq '[.[] | .createdAt] | sort | last'
```

### Resolution

**Short-term (Horizon recovering):**

Most Horizon outages resolve within 1–2 hours. During the outage:
- Disable outbound Horizon polling to avoid filling logs with connection errors.
- Queue any user-triggered operations that require on-chain confirmation for retry.

**After Horizon recovers — catch up on missed events:**

The `SorobanRpc.Server.getEvents()` API supports `startLedger` for historical replay. Set `startLedger` to the last successfully processed ledger and replay forward:

```typescript
// In your event streaming service
const lastProcessedLedger = await getLastProcessedLedger(); // from your DB/Redis
await streamVaultEvents(lastProcessedLedger);
```

**If the primary Horizon endpoint is permanently unreliable**, consider:
- Self-hosting a Horizon node (`docker-compose.yml` has a stub; full setup in `DEPLOYMENT_GUIDE.md`).
- Using multiple Horizon endpoints with a round-robin strategy.
- Subscribing to Stellar Quicknode or Alchemy for a managed Horizon API with SLA guarantees.

**If rate limited:**

- Register for a Stellar Foundation API key to get higher rate limits.
- Implement client-side rate limiting with exponential backoff in the Horizon client.
- Cache event responses in Redis with a short TTL to reduce polling frequency.

### Post-Mortem

- How long was the outage? How far behind did the system fall?
- Was the fallback endpoint tested and operational before the incident?
- Add a second Horizon endpoint to the configuration as a hot standby.
- Add a "Horizon unreachable" alert to the monitoring dashboard with a 5-minute threshold (not instant, to avoid flapping on transient timeouts).
- Document the event replay procedure in this runbook so any on-call engineer can execute it.

---

## Communication Templates

### Initial Alert (Slack `#incidents`)

```
🚨 *P[0/1] Incident: [Title]*
• Impact: [who/what is affected]
• Started: [time UTC]
• Incident commander: @[name]
• Scenario playbook: [link to this doc, anchor to scenario]
• Status page: https://status.aura-vault.xyz
```

### Status Page — Investigating

```
Title: [Service] Disruption — Investigating
Status: Investigating
Body: We are investigating reports of [brief description].
Our team is actively working on this. We will update in 30 minutes.
```

### Status Page — Resolved

```
Title: [Service] Disruption — Resolved
Status: Resolved
Body: The issue affecting [service] has been resolved as of [time UTC].
Root cause: [1 sentence]. All systems are operating normally.
```

---

## Runbook Cross-References

| Scenario | Related Documents |
|----------|-------------------|
| Vault paused | [SECURITY.md](../SECURITY.md) · [smart-contract-api.md](./smart-contract-api.md) |
| Backend API down | [DEPLOYMENT.md](./DEPLOYMENT.md) · [disaster-recovery/runbook.md](./disaster-recovery/runbook.md) |
| DB pool exhausted | [disaster-recovery/runbook.md](./disaster-recovery/runbook.md) · [backup-recovery.md](./backup-recovery.md) |
| Suspicious event | [SECURITY.md](../SECURITY.md) · [event-schema.md](./event-schema.md) |
| Horizon unreachable | [DEPLOYMENT.md](./DEPLOYMENT.md) · [event-schema.md](./event-schema.md) |
