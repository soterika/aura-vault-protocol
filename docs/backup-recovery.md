# Backup & Recovery

Runbook for automated PostgreSQL backups for the Aura Vault Protocol off-chain
infrastructure. On-chain contract state lives on Stellar and is replicated by
the network — this document covers the off-chain PostgreSQL database only.

---

## Architecture Overview

```
K8s CronJob (02:00 UTC daily)
  └─ scripts/backup-postgres.sh
       ├─ pg_dump | gzip            → /tmp/aura_vault_TIMESTAMP.sql.gz
       ├─ openssl AES-256-CBC       → /tmp/aura_vault_TIMESTAMP.sql.gz.enc
       ├─ aws s3 cp (SSE-KMS)       → s3://BUCKET/postgres-backups/
       └─ curl metrics push         → Prometheus Pushgateway

S3 Lifecycle (terraform/s3-backup.tf)
  └─ STANDARD (0–7d) → STANDARD_IA (7–14d) → GLACIER_IR (14–30d) → expire

Prometheus Alertmanager
  └─ monitoring/prometheus/backup-alerts.yml
       ├─ BackupMissed         (>25h, critical)
       ├─ BackupFailed         (explicit, critical)
       ├─ BackupMetricAbsent   (critical)
       ├─ BackupDurationHigh   (>30m, warning)
       └─ BackupSizeSuspiciouslySmall (<10KB, warning)

GitHub Actions (.github/workflows/backup-restore-test.yml)
  └─ Weekly Sunday 04:00 UTC
       ├─ Download latest backup from S3
       ├─ Decrypt with AES-256
       ├─ Restore into isolated test DB
       ├─ Run 8 integrity checks
       ├─ Push restore test metrics to Pushgateway
       └─ Slack + GitHub issue on failure
```

---

## Scope

| Component | Backup Method | Retention |
|---|---|---|
| PostgreSQL (`aura_vault` DB) | pg_dump → AES-256 → S3 | 30 days |
| PostgreSQL WAL (PITR) | archive_command → S3 | Optional (see below) |
| API secrets | AWS Secrets Manager snapshots | Managed by AWS |
| Frontend static assets | Reproducible from source | N/A |
| On-chain contract state | Stellar ledger (network) | N/A |

---

## Files

| File | Purpose |
|---|---|
| `scripts/backup-postgres.sh` | Main backup script (pg_dump + AES-256 + S3) |
| `scripts/restore-test.sh` | Restore integrity validation script |
| `k8s/database/backup-job.yaml` | K8s CronJob + ConfigMap + ServiceAccount |
| `terraform/s3-backup.tf` | S3 bucket, KMS key, lifecycle, IRSA role |
| `terraform/s3-backup-lifecycle.json` | Lifecycle policy JSON (for reference) |
| `monitoring/prometheus/backup-alerts.yml` | Prometheus alert rules |
| `.github/workflows/backup-restore-test.yml` | Weekly CI restore test |

---

## Setup

### 1. Provision AWS Infrastructure

```bash
cd terraform
terraform plan   # review changes
terraform apply  # creates S3 bucket, KMS key, IRSA role
```

Note the outputs:
- `backup_bucket_name` — set as `BACKUP_BUCKET` in the K8s ConfigMap
- `backup_job_role_arn` — annotate the K8s ServiceAccount with this ARN

### 2. Create Kubernetes Secrets

```bash
kubectl create secret generic backend-secrets \
  --namespace aura-vault \
  --from-literal=DB_PASSWORD='<postgres-password>' \
  --from-literal=BACKUP_ENCRYPTION_KEY='<min-32-char-passphrase>' \
  --dry-run=client -o yaml | kubectl apply -f -
```

> **Security:** Store the `BACKUP_ENCRYPTION_KEY` in AWS Secrets Manager and rotate it
> annually. Without this key, encrypted backups cannot be restored.

### 3. Update the K8s ConfigMap

Edit `k8s/database/backup-job.yaml` and set `BACKUP_BUCKET` to the Terraform output value:

```yaml
data:
  BACKUP_BUCKET: "aura-vault-db-backups-prod"      # ← terraform output
  PUSHGATEWAY_URL: "http://prometheus-pushgateway:9091"
```

### 4. Annotate the ServiceAccount for IRSA

```bash
kubectl annotate serviceaccount postgres-backup \
  --namespace aura-vault \
  eks.amazonaws.com/role-arn=arn:aws:iam::ACCOUNT_ID:role/aura-vault-backup-job-prod
```

### 5. Apply the K8s CronJob

```bash
kubectl apply -f k8s/database/backup-job.yaml
```

### 6. Configure GitHub Actions Secrets

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user with S3 read access (or use OIDC) |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret key |
| `BACKUP_BUCKET` | S3 bucket name |
| `BACKUP_ENCRYPTION_KEY` | Same passphrase used by the CronJob |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook (optional) |
| `PUSHGATEWAY_URL` | Prometheus Pushgateway URL (optional) |

---

## Manual Operations

### Trigger a Manual Backup

```bash
# Via kubectl — create a one-off job from the CronJob
kubectl create job --from=cronjob/postgres-backup manual-backup-$(date +%Y%m%d) \
  -n aura-vault

# Watch progress
kubectl logs -n aura-vault -l app=postgres-backup -f
```

### Run a Manual Restore Test

```bash
export BACKUP_BUCKET="aura-vault-db-backups-prod"
export BACKUP_ENCRYPTION_KEY="<passphrase>"
export PGHOST=localhost PGPORT=5432 PGUSER=aura PGPASSWORD="<password>"

# Test the latest backup
./scripts/restore-test.sh

# Test a specific backup
./scripts/restore-test.sh --backup-key "postgres-backups/aura_vault_20260830_020000.sql.gz.enc"
```

### Restore to Production (Break Glass)

> **Warning:** This procedure replaces the production database. Coordinate with
> the on-call team and ensure the application is in maintenance mode first.

```bash
# 1. Find the backup to restore
aws s3 ls s3://BACKUP_BUCKET/postgres-backups/ | sort | tail -10

# 2. Download
aws s3 cp s3://BACKUP_BUCKET/postgres-backups/<KEY>.sql.gz.enc /tmp/

# 3. Decrypt
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -pass "pass:${BACKUP_ENCRYPTION_KEY}" \
  -in /tmp/<KEY>.sql.gz.enc \
  -out /tmp/restore.sql.gz

# 4. Create restore target
createdb -h $PGHOST -U $PGUSER aura_vault_restore

# 5. Restore
gunzip -c /tmp/restore.sql.gz | psql -h $PGHOST -U $PGUSER -d aura_vault_restore

# 6. Validate
psql -h $PGHOST -U $PGUSER -d aura_vault_restore \
  -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"

# 7. Swap databases (maintenance window required)
psql -h $PGHOST -U $PGUSER -c "ALTER DATABASE aura_vault RENAME TO aura_vault_old;"
psql -h $PGHOST -U $PGUSER -c "ALTER DATABASE aura_vault_restore RENAME TO aura_vault;"

# 8. Clean up
rm /tmp/restore.sql.gz /tmp/<KEY>.sql.gz.enc
```

---

## Encryption Details

All backups are encrypted with **AES-256-CBC** using OpenSSL with:
- **PBKDF2** key derivation
- **600,000 iterations** (NIST recommendation for PBKDF2-HMAC-SHA256)
- A random 8-byte salt prepended to the ciphertext by OpenSSL

In addition, the S3 object is protected by **SSE-KMS** with a dedicated CMK
(`alias/aura-vault-backup-<env>`), providing a second layer of encryption at rest.

**Key management:**
- The `BACKUP_ENCRYPTION_KEY` passphrase is stored in a Kubernetes Secret (backed by AWS Secrets Manager).
- The KMS CMK has automatic annual rotation enabled.
- Losing the `BACKUP_ENCRYPTION_KEY` makes backups permanently unrecoverable.
  Store it in a physical safe as a recovery key.

---

## Retention Policy

| Age | Storage Class | Notes |
|---|---|---|
| 0–7 days | STANDARD | Fast retrieval, recent incidents |
| 7–14 days | STANDARD_IA | Lower cost, same durability |
| 14–30 days | GLACIER_IR | Instant retrieval, lowest cost |
| >30 days | Deleted | Automatic S3 lifecycle expiration |

Non-current versions (from S3 versioning) are expired after 7 days.
Incomplete multipart uploads are aborted after 1 day.

---

## Alert Runbooks

### `BackupMissed`

**What:** No successful backup in the last 25 hours.

**Check:**
```bash
kubectl get cronjobs -n aura-vault
kubectl get jobs -n aura-vault -l app=postgres-backup
kubectl logs -n aura-vault -l app=postgres-backup --previous
aws s3 ls s3://BACKUP_BUCKET/postgres-backups/ | sort | tail -5
```

**Fix:** Investigate pod logs. If the CronJob is suspended, unsuspend it:
```bash
kubectl patch cronjob postgres-backup -n aura-vault -p '{"spec":{"suspend":false}}'
```
Then trigger a manual backup (see above).

---

### `BackupFailed`

**What:** The backup script explicitly reported `backup_success_total=0`.

**Check:** Same as BackupMissed — check pod logs for the specific step that failed
(pg_dump, encryption, or S3 upload).

---

### `BackupMetricAbsent`

**What:** Prometheus has never seen the `backup_last_success_timestamp_seconds` metric.

**Check:** Verify the Pushgateway is running and the backup has completed at least once:
```bash
kubectl get svc -n aura-vault prometheus-pushgateway
curl http://prometheus-pushgateway:9091/metrics | grep backup
```

---

### `BackupRestoreTestFailed`

**What:** The weekly restore test failed — the backup cannot be restored successfully.

**Action:** This is a P1. Immediately:
1. Run `scripts/restore-test.sh` manually to reproduce.
2. Check if the encryption key matches.
3. Check if the S3 object is intact (`aws s3 ls --recursive s3://BUCKET/postgres-backups/`).
4. If the backup is genuinely corrupt, trigger a new backup and re-run the restore test.

---

### `BackupRestoreTestNotRun`

**What:** The restore test has not run in over 8 days.

**Check:** Verify the GitHub Actions workflow is enabled and has not been manually
disabled. Re-enable via the GitHub UI or trigger it with `workflow_dispatch`.

---

## RTO / RPO Targets

| Scenario | RPO | RTO |
|---|---|---|
| Single table corruption | < 24h | < 2h |
| Full database loss | < 24h | < 4h |
| Region outage | < 24h | < 8h |

---

## Point-in-Time Recovery (Optional Enhancement)

To achieve RPO < 24h, enable WAL archiving:

```ini
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://BUCKET/wal/%f --sse aws:kms'
```

Restore to arbitrary timestamp:

```bash
# recovery.conf (PostgreSQL < 12) or postgresql.conf
restore_command = 'aws s3 cp s3://BUCKET/wal/%f %p'
recovery_target_time = '2026-08-30 03:45:00 UTC'
```
