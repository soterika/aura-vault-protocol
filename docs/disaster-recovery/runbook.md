# Disaster Recovery Runbook — Aura Vault Protocol

| Field | Value |
|---|---|
| **RTO Target** | < 4 hours |
| **RPO Target** | < 1 hour |
| **DR Drill Schedule** | Quarterly (see [Drill Schedule](#dr-drill-schedule)) |
| **Last Updated** | 2026-08-28 |
| **Owner** | Infrastructure Lead (see on-call rotation) |

---

## Table of Contents

- [Overview and Targets](#overview-and-targets)
- [Backup Strategy](#backup-strategy)
- [Incident Classification](#incident-classification)
- [Database Restore from S3 Backup](#database-restore-from-s3-backup)
- [Redis Cache Rebuild Procedure](#redis-cache-rebuild-procedure)
- [Contract Re-Deployment Procedure](#contract-re-deployment-procedure)
- [Infrastructure Full Rebuild](#infrastructure-full-rebuild)
- [Post-Recovery Validation Checklist](#post-recovery-validation-checklist)
- [DR Drill Schedule](#dr-drill-schedule)
- [Contacts and Escalation](#contacts-and-escalation)

---

## Overview and Targets

| Metric | Target | Definition |
|---|---|---|
| **RTO** (Recovery Time Objective) | **< 4 hours** | Maximum acceptable time from incident declaration to full service restoration |
| **RPO** (Recovery Point Objective) | **< 1 hour** | Maximum acceptable data loss measured in time |

These targets apply to a complete region-level failure. For component-level failures (single EC2 instance, RDS failover) the effective RTO is < 15 minutes due to Multi-AZ auto-recovery.

### High-Availability vs. Disaster Recovery

| Scenario | Recovery Mechanism | Typical RTO |
|---|---|---|
| EC2 instance failure | ASG auto-replace | < 5 min |
| RDS primary failure | Multi-AZ automatic failover | < 2 min |
| AZ outage | Multi-AZ routing; ASG distributes across AZs | < 5 min |
| Region outage | Full DR procedure (this document) | < 4 hours |
| Data corruption | PITR or snapshot restore (this document) | 30–90 min |
| Accidental deletion | S3 versioning or RDS snapshot | 30–60 min |

---

## Backup Strategy

### 3-2-1 Rule Compliance

- **3 copies:** Production DB + automated daily snapshot + weekly S3 export
- **2 media types:** RDS automated snapshots + S3 pg_dump exports
- **1 offsite:** Cross-region S3 replication from `us-east-1` → `us-west-2`

### Backup Schedule

| Backup Type | Retention | Schedule (UTC) | Location |
|---|---|---|---|
| RDS automated snapshot | 7 days | Daily 02:00 | RDS managed |
| RDS weekly snapshot | 30 days | Sunday 03:00 | RDS managed |
| RDS monthly snapshot | 365 days | 1st of month 04:00 | RDS managed |
| S3 pg_dump export | 90 days | Weekly (Lambda) | `s3://aura-vault-backups-prod/rds-exports/` |
| S3 versioning (static assets) | 90 days | Continuous | `s3://aura-vault-static-assets-prod/` |
| Terraform state | Indefinite | On every apply | `s3://aura-vault-terraform-state/` |
| Contract Wasm | Indefinite | On each deploy | `s3://aura-vault-backups-prod/contracts/` |

### Verify Backup Health (weekly check)

```bash
# List the 5 most recent RDS automated snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier aura-vault-db-prod \
  --snapshot-type automated \
  --query 'reverse(sort_by(DBSnapshots, &SnapshotCreateTime))[:5].[DBSnapshotIdentifier,SnapshotCreateTime,Status]' \
  --output table

# Confirm latest S3 export exists within 7 days
aws s3 ls s3://aura-vault-backups-prod/rds-exports/ \
  --recursive --human-readable | sort | tail -5
```

---

## Incident Classification

Before executing DR procedures, classify the incident:

| Class | Description | Response |
|---|---|---|
| **P1 — Full outage** | Service completely unavailable | Immediate DR; all hands |
| **P2 — Partial outage** | Core functions unavailable; some read paths work | DR for affected components |
| **P3 — Degraded** | Elevated errors; service degraded but functional | Investigate; DR optional |
| **P4 — Data incident** | No outage but data corruption or loss detected | PITR restore; halt writes |

Declare a P1 or P2 incident via PagerDuty before starting DR procedures. Document the declared time — this is the RTO clock start.

---

## Database Restore from S3 Backup

Use this procedure when:
- RDS instance is unrecoverable (deletion, corruption)
- Data needs to be rolled back beyond RDS PITR window (7 days)
- The S3 pg_dump export is needed for a fresh region

**Target RTO for this step: < 90 minutes**

### Option A: Restore from RDS Snapshot (preferred)

```bash
# 1. Identify the latest clean snapshot
SNAPSHOT_ID=$(aws rds describe-db-snapshots \
  --db-instance-identifier aura-vault-db-prod \
  --query 'reverse(sort_by(DBSnapshots, &SnapshotCreateTime))[0].DBSnapshotIdentifier' \
  --output text)
echo "Restoring from snapshot: $SNAPSHOT_ID"

# 2. Restore to a new RDS instance
#    Use a different identifier to avoid conflicts with the old instance
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier aura-vault-db-restore-$(date +%Y%m%d) \
  --db-snapshot-identifier "$SNAPSHOT_ID" \
  --db-instance-class db.t3.medium \
  --db-subnet-group-name aura-vault-db-subnet-group-prod \
  --vpc-security-group-ids sg-XXXXXXXX \
  --multi-az \
  --publicly-accessible false \
  --tags Key=Purpose,Value=disaster-recovery Key=Date,Value=$(date +%Y-%m-%d)

# 3. Wait for the instance to become available (typically 15–30 min)
aws rds wait db-instance-available \
  --db-instance-identifier aura-vault-db-restore-$(date +%Y%m%d)

# 4. Get the new endpoint
NEW_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier aura-vault-db-restore-$(date +%Y%m%d) \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text)
echo "New endpoint: $NEW_ENDPOINT"

# 5. Update the database secret in Secrets Manager
aws secretsmanager update-secret \
  --secret-id aura-vault/prod/db_master \
  --secret-string "{\"host\":\"$NEW_ENDPOINT\",\"port\":5432,\"dbname\":\"auravault\",\"username\":\"auravault\"}"

# 6. Force ASG instances to restart and pick up the new endpoint
#    The user-data script reads the secret at launch time
aws autoscaling start-instance-refresh \
  --auto-scaling-group-name aura-vault-asg-prod \
  --strategy Rolling \
  --preferences '{"MinHealthyPercentage":50}'
```

### Option B: Point-in-Time Recovery (PITR)

Use when you need to recover to a specific moment (e.g., 30 minutes before accidental bulk delete):

```bash
# Restore to a specific timestamp (ISO 8601)
TARGET_TIME="2026-08-28T14:00:00Z"   # adjust to desired recovery point

aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier aura-vault-db-prod \
  --target-db-instance-identifier aura-vault-db-pitr-$(date +%Y%m%d%H%M) \
  --restore-time "$TARGET_TIME" \
  --db-instance-class db.t3.medium \
  --db-subnet-group-name aura-vault-db-subnet-group-prod \
  --vpc-security-group-ids sg-XXXXXXXX \
  --multi-az

aws rds wait db-instance-available \
  --db-instance-identifier aura-vault-db-pitr-$(date +%Y%m%d%H%M)
```

Then follow steps 4–6 from Option A to update the secret and restart the ASG.

### Option C: Restore from S3 pg_dump Export

Use when both RDS snapshot and PITR are unavailable (cross-region rebuild):

```bash
# 1. Identify the latest export file
aws s3 ls s3://aura-vault-backups-prod/rds-exports/ \
  --recursive | sort | tail -3

# 2. Download the dump
aws s3 cp s3://aura-vault-backups-prod/rds-exports/auravault-YYYYMMDD.dump ./

# 3. Create a new RDS instance via Terraform (in the new region)
#    Or create manually and restore:
pg_restore \
  --host "$NEW_ENDPOINT" \
  --port 5432 \
  --username auravault \
  --dbname auravault \
  --verbose \
  auravault-YYYYMMDD.dump

# 4. Verify row counts match expectations
psql --host "$NEW_ENDPOINT" -U auravault -d auravault -c \
  "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"
```

---

## Redis Cache Rebuild Procedure

Redis is used for session caching, rate limiting, and API response caching. It does **not** store primary data — the database is the source of truth. Cache loss causes a temporary performance degradation (cache miss storm) but no data loss.

**Target RTO for this step: < 15 minutes**

### If Redis is down or corrupted

```bash
# Option 1: Restart Redis (Docker / EC2)
# If running in Docker on EC2:
ssh -i ~/.ssh/aura-vault-key.pem ec2-user@<bastion-ip>
# SSH to the affected instance via bastion
docker restart aura-vault-redis

# Option 2: Redis is in-memory only — if the process dies, cache is gone.
# Start a fresh Redis instance; the application handles cache misses gracefully.
docker run -d \
  --name aura-vault-redis \
  --restart unless-stopped \
  -p 6379:6379 \
  redis:7-alpine \
  redis-server --appendonly no --maxmemory 512mb --maxmemory-policy allkeys-lru

# Option 3: Kubernetes (if deployed to k8s cluster)
kubectl rollout restart deployment/redis -n aura-vault
kubectl rollout status deployment/redis -n aura-vault
```

### Warm the cache after rebuild

The backend automatically warms the cache on the next request for each key. To accelerate warming for the most common queries:

```bash
# Trigger a cache warm-up via the health endpoint (hits portfolio and stats endpoints)
curl -s https://api.auravault.example/api/health | jq .

# Or call the internal warm-up endpoint if available
curl -s -X POST https://api.auravault.example/internal/cache/warm \
  -H "Authorization: Bearer $INTERNAL_TOKEN"
```

### Verify Redis is healthy

```bash
# From a backend instance
redis-cli -h <redis-host> ping
# Expected: PONG

redis-cli -h <redis-host> info server | grep -E "redis_version|uptime"
redis-cli -h <redis-host> info stats | grep "keyspace_hits\|keyspace_misses"
```

After a fresh rebuild, expect a high miss rate for 5–10 minutes while the cache warms. Monitor the `cache_hit_rate` Grafana panel; it should recover to >80% within 10 minutes under normal traffic.

---

## Contract Re-Deployment Procedure

Use this procedure only if the Soroban contract needs to be re-deployed from scratch (e.g., Stellar network disruption, contract ID lost). Under normal operations, use the `upgrade` function instead.

**This procedure requires the admin keypair (hardware wallet or MPC).**

### Prerequisites

```bash
# Install Stellar CLI
cargo install --locked stellar-cli

# Or download from https://github.com/stellar/stellar-cli/releases
```

### Step 1: Retrieve the stored Wasm

```bash
# The compiled Wasm is stored in S3 at deploy time
aws s3 cp \
  s3://aura-vault-backups-prod/contracts/aura_vault_latest.wasm \
  ./aura_vault.wasm

# Verify checksum matches the known-good hash
sha256sum aura_vault.wasm
# Compare with the hash stored in s3://aura-vault-backups-prod/contracts/checksums.txt
aws s3 cp s3://aura-vault-backups-prod/contracts/checksums.txt - | grep aura_vault_latest
```

### Step 2: Upload Wasm to the network

```bash
# Testnet
stellar contract upload \
  --wasm aura_vault.wasm \
  --source <admin-keypair-or-secret-key> \
  --network testnet

# Mainnet
stellar contract upload \
  --wasm aura_vault.wasm \
  --source <admin-keypair-or-secret-key> \
  --network mainnet
```

Record the `wasm_hash` from the output.

### Step 3: Deploy a new contract instance

```bash
stellar contract deploy \
  --wasm-hash <wasm-hash-from-step-2> \
  --source <admin-keypair> \
  --network mainnet
```

Record the new `contract-id`.

### Step 4: Initialize the new contract

```bash
stellar contract invoke \
  --id <new-contract-id> \
  --source <admin-keypair> \
  --network mainnet \
  -- initialize \
  --admin <admin-address> \
  --underlying_token <token-contract-id>
```

### Step 5: Update backend configuration

```bash
# Update the contract ID in Secrets Manager / environment config
aws secretsmanager update-secret \
  --secret-id aura-vault/prod/app \
  --secret-string "{\"contract_id\":\"<new-contract-id>\",\"token_id\":\"<token-id>\",...}"

# Restart backend instances to pick up the new contract ID
aws autoscaling start-instance-refresh \
  --auto-scaling-group-name aura-vault-asg-prod \
  --strategy Rolling \
  --preferences '{"MinHealthyPercentage":50}'
```

### Step 6: Verify the new contract

```bash
# Check total_assets (should be 0 for a fresh deployment)
stellar contract invoke \
  --id <new-contract-id> \
  --network mainnet \
  -- total_assets

# Test health endpoint (backend must be restarted first)
curl https://api.auravault.example/api/health | jq .contract_status
```

> **Note on user positions:** A fresh re-deployment starts with zero state. If existing depositor balances need to be migrated, coordinate with the Stellar ecosystem team to plan a migration strategy before proceeding.

---

## Infrastructure Full Rebuild

If the entire AWS infrastructure needs to be rebuilt from scratch (e.g., account compromise, region migration):

```bash
# 1. Confirm Terraform state is accessible
aws s3 ls s3://aura-vault-terraform-state/

# 2. Retrieve the latest Terraform state
cd terraform
terraform init    # re-initializes against remote state

# 3. Review current state
terraform show | head -100

# 4. Re-apply infrastructure
terraform plan -out=dr-rebuild.tfplan
# Review the plan carefully — confirm no unintended destroys
terraform apply dr-rebuild.tfplan

# 5. After apply, get the new endpoints
terraform output alb_dns_name
terraform output cloudfront_domain_name

# 6. Update DNS if using a custom domain
#    Route 53 records are managed by Terraform; they will be updated automatically.
#    If DNS is managed externally, update the CNAME/A records to the new ALB DNS.

# 7. Follow database restore (Option C above) if RDS is also lost
# 8. Follow contract re-deployment if contract state is lost
```

Estimated time for full infrastructure rebuild: 30–45 minutes (Terraform apply) + database restore time.

---

## Post-Recovery Validation Checklist

Run this checklist after any DR procedure before declaring recovery complete.

### Infrastructure

- [ ] ALB health check returns 200 at `/api/health`
- [ ] All ASG instances pass health checks (min 2 healthy)
- [ ] RDS instance status = `available`; Multi-AZ standby present
- [ ] CloudFront distribution status = `Deployed`
- [ ] DNS resolves correctly (A/CNAME points to ALB or CloudFront)

### Application

- [ ] `GET /api/health` returns `{"status":"ok","db":"connected","redis":"connected"}`
- [ ] `GET /api/vault/stats` returns non-error response with `totalAssets` field
- [ ] Test deposit transaction completes end-to-end (use a test account)
- [ ] Test portfolio fetch returns expected data for known address
- [ ] Logs flowing to CloudWatch (no `ERROR` flood)

### Data Integrity

- [ ] Row counts in key tables match pre-incident baseline (see backup verification)
- [ ] `vault_positions` table has expected number of rows
- [ ] `transaction_jobs` table shows no stuck `pending` entries from before the incident
- [ ] Redis hit rate recovering toward normal (>60% within 10 min of traffic)

### Security

- [ ] Secrets Manager secrets are current (not pointing to old endpoints)
- [ ] Security groups are correctly applied (verify via `terraform plan` shows no drift)
- [ ] No unexpected admin access during the incident window (review CloudTrail)

### Metrics and Alerting

- [ ] CloudWatch dashboards show metrics flowing
- [ ] PagerDuty test alert fires correctly
- [ ] Set incident status to "Resolved" in PagerDuty
- [ ] Record actual RTO/RPO in `docs/disaster-recovery/test-log.md`

---

## DR Drill Schedule

Quarterly DR drills ensure procedures stay accurate and the team retains muscle memory.

| Quarter | Drill Date | Scope | Lead |
|---|---|---|---|
| Q1 | January (3rd week) | RDS PITR restore to staging | DBA |
| Q2 | April (3rd week) | Full infrastructure rebuild in staging | Infra Lead |
| Q3 | July (3rd week) | Redis cache rebuild + cache warm validation | Backend Lead |
| Q4 | October (3rd week) | Full DR simulation (all components) | All |

### Drill Procedure

1. Schedule a 4-hour window during off-peak hours (e.g., Saturday 08:00–12:00 UTC)
2. Notify the team 1 week in advance via the incident Slack channel
3. Execute the DR procedure against the **staging** environment (not production)
4. Record the actual RTO/RPO achieved in `docs/disaster-recovery/test-log.md`
5. Hold a 30-minute retrospective; update this runbook if any step failed or was unclear
6. File a follow-up ticket for any procedural gaps found

### Last Drill Results

| Date | Scope | Actual RTO | Actual RPO | Issues Found |
|---|---|---|---|---|
| _(To be filled after first drill)_ | — | — | — | — |

---

## Contacts and Escalation

| Role | Responsibility | Contact |
|---|---|---|
| Primary DR Lead | Overall incident coordination | PagerDuty rotation — see `on-call-rotation.md` |
| DBA | Database restore procedures | PagerDuty rotation |
| Infrastructure Lead | Terraform, AWS, network | PagerDuty rotation |
| Protocol Lead | Contract re-deployment | PagerDuty rotation |
| AWS Support | AWS service issues | Support case via console (Business/Enterprise plan required for < 1h response) |

### Escalation Path

1. On-call engineer responds (PagerDuty alert)
2. If unresolved in 30 min → page the DR Lead
3. If unresolved in 60 min → escalate to Protocol Lead and engage AWS Support
4. Stakeholder communication every 30 min during active P1

### Communication Templates

**Initial incident notification (Slack #incidents):**
```
🚨 P1 INCIDENT DECLARED — Aura Vault
Time: [UTC timestamp]
Impact: [brief description]
DR Lead: [name]
Status: Investigating
Next update: in 30 min
```

**Recovery confirmed notification:**
```
✅ RECOVERY CONFIRMED — Aura Vault
Resolved at: [UTC timestamp]
Actual RTO: [X hours Y minutes]
Actual RPO: [X minutes of data loss]
Post-mortem scheduled: [date/time]
```
