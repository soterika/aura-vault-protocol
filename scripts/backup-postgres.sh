#!/usr/bin/env bash
# =============================================================================
# backup-postgres.sh — PostgreSQL backup with AES-256 encryption and S3 upload
#
# Usage:
#   ./scripts/backup-postgres.sh [--dry-run]
#
# Required environment variables:
#   PGHOST        — PostgreSQL host            (default: postgres-service)
#   PGPORT        — PostgreSQL port            (default: 5432)
#   PGUSER        — PostgreSQL user            (default: aura)
#   PGDATABASE    — PostgreSQL database name   (default: aura_vault)
#   PGPASSWORD    — PostgreSQL password        (required)
#   BACKUP_BUCKET — S3 bucket name             (required)
#   BACKUP_ENCRYPTION_KEY — AES-256 passphrase (required, min 32 chars)
#
# Optional environment variables:
#   AWS_REGION    — AWS region                 (default: us-east-1)
#   BACKUP_PREFIX — S3 key prefix              (default: postgres-backups)
#   RETENTION_DAYS — local temp file cleanup   (default: 1)
#   PUSHGATEWAY_URL — Prometheus Pushgateway   (optional, enables metrics push)
#
# Exit codes:
#   0 — success
#   1 — configuration error
#   2 — pg_dump failed
#   3 — encryption failed
#   4 — S3 upload failed
# =============================================================================

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────────────
SCRIPT_NAME="$(basename "$0")"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
START_TIME="$(date +%s)"
DRY_RUN=false

# ── Parse arguments ───────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "[WARN] Unknown argument: $arg" ;;
  esac
done

# ── Logging helpers ───────────────────────────────────────────────────────────
log_info()  { echo "[INFO]  $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
log_warn()  { echo "[WARN]  $(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >&2; }
log_error() { echo "[ERROR] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >&2; }

# ── Configuration with defaults ───────────────────────────────────────────────
PGHOST="${PGHOST:-postgres-service}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-aura}"
PGDATABASE="${PGDATABASE:-aura_vault}"
AWS_REGION="${AWS_REGION:-us-east-1}"
BACKUP_PREFIX="${BACKUP_PREFIX:-postgres-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-1}"

# ── Validate required variables ───────────────────────────────────────────────
validate_config() {
  local errors=0

  if [[ -z "${PGPASSWORD:-}" ]]; then
    log_error "PGPASSWORD is not set"
    errors=$((errors + 1))
  fi

  if [[ -z "${BACKUP_BUCKET:-}" ]]; then
    log_error "BACKUP_BUCKET is not set"
    errors=$((errors + 1))
  fi

  if [[ -z "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
    log_error "BACKUP_ENCRYPTION_KEY is not set"
    errors=$((errors + 1))
  elif [[ ${#BACKUP_ENCRYPTION_KEY} -lt 32 ]]; then
    log_error "BACKUP_ENCRYPTION_KEY must be at least 32 characters"
    errors=$((errors + 1))
  fi

  if [[ $errors -gt 0 ]]; then
    log_error "Configuration validation failed with $errors error(s)"
    exit 1
  fi
}

# ── Check required binaries ───────────────────────────────────────────────────
check_dependencies() {
  local missing=0
  for cmd in pg_dump gzip openssl aws; do
    if ! command -v "$cmd" &>/dev/null; then
      log_error "Required command not found: $cmd"
      missing=$((missing + 1))
    fi
  done
  if [[ $missing -gt 0 ]]; then
    log_error "$missing required command(s) are missing"
    exit 1
  fi
}

# ── Push metrics to Prometheus Pushgateway ────────────────────────────────────
push_metric() {
  local metric_name="$1"
  local metric_value="$2"
  local metric_help="${3:-}"

  if [[ -z "${PUSHGATEWAY_URL:-}" ]]; then
    return 0
  fi

  local payload
  payload="# HELP ${metric_name} ${metric_help}
# TYPE ${metric_name} gauge
${metric_name}{job=\"postgres_backup\",database=\"${PGDATABASE}\",environment=\"${ENVIRONMENT:-production}\"} ${metric_value}"

  if curl -s --max-time 10 \
       --data-binary "$payload" \
       "${PUSHGATEWAY_URL}/metrics/job/postgres_backup/instance/${PGDATABASE}" \
       > /dev/null 2>&1; then
    log_info "Pushed metric ${metric_name}=${metric_value} to Pushgateway"
  else
    log_warn "Failed to push metric to Pushgateway (non-fatal)"
  fi
}

# ── Cleanup temporary files ───────────────────────────────────────────────────
TEMP_FILES=()
cleanup() {
  local exit_code=$?
  for f in "${TEMP_FILES[@]:-}"; do
    if [[ -f "$f" ]]; then
      rm -f "$f"
      log_info "Cleaned up temp file: $f"
    fi
  done

  if [[ $exit_code -ne 0 ]]; then
    local elapsed=$(( $(date +%s) - START_TIME ))
    log_error "Backup FAILED after ${elapsed}s (exit code: $exit_code)"
    push_metric "backup_last_success_timestamp_seconds" "0" \
      "Unix timestamp of last successful backup completion"
    push_metric "backup_last_duration_seconds" "$elapsed" \
      "Duration in seconds of last backup attempt"
    push_metric "backup_success_total" "0" \
      "1 if last backup succeeded, 0 otherwise"
  fi
}
trap cleanup EXIT

# ── Main backup flow ──────────────────────────────────────────────────────────
main() {
  log_info "=== PostgreSQL Backup Started ==="
  log_info "Database:  ${PGHOST}:${PGPORT}/${PGDATABASE}"
  log_info "S3 target: s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/"
  log_info "Timestamp: ${TIMESTAMP}"
  [[ "$DRY_RUN" == "true" ]] && log_info "DRY RUN mode — no data will be written"

  validate_config
  check_dependencies

  # ── File naming ────────────────────────────────────────────────────────────
  local backup_base="aura_vault_${TIMESTAMP}"
  local dump_file="/tmp/${backup_base}.sql.gz"
  local enc_file="/tmp/${backup_base}.sql.gz.enc"
  local s3_key="${BACKUP_PREFIX}/${backup_base}.sql.gz.enc"
  TEMP_FILES+=("$dump_file" "$enc_file")

  # ── Step 1: pg_dump + gzip ─────────────────────────────────────────────────
  log_info "Step 1/3: Running pg_dump..."
  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would run: pg_dump -h ${PGHOST} -p ${PGPORT} -U ${PGUSER} -d ${PGDATABASE} | gzip > ${dump_file}"
    # Create a tiny placeholder so downstream steps have something to work with
    echo "dry-run placeholder" | gzip > "$dump_file"
  else
    if ! PGPASSWORD="${PGPASSWORD}" pg_dump \
        -h "${PGHOST}" \
        -p "${PGPORT}" \
        -U "${PGUSER}" \
        -d "${PGDATABASE}" \
        --no-password \
        --format=plain \
        --no-privileges \
        --no-tablespaces \
        2>/tmp/pg_dump_stderr.txt | gzip > "$dump_file"; then
      log_error "pg_dump failed:"
      cat /tmp/pg_dump_stderr.txt >&2
      exit 2
    fi
  fi

  local dump_size
  dump_size="$(du -sh "$dump_file" | cut -f1)"
  log_info "Dump size (compressed): ${dump_size}"

  # ── Step 2: AES-256-CBC encryption ────────────────────────────────────────
  log_info "Step 2/3: Encrypting with AES-256-CBC..."
  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would encrypt: openssl enc -aes-256-cbc -pbkdf2 -iter 600000 ..."
    cp "$dump_file" "$enc_file"
  else
    # -pbkdf2 + 600000 iterations makes brute-force attacks expensive
    if ! openssl enc -aes-256-cbc \
        -pbkdf2 \
        -iter 600000 \
        -pass "pass:${BACKUP_ENCRYPTION_KEY}" \
        -in  "$dump_file" \
        -out "$enc_file" 2>/dev/null; then
      log_error "Encryption failed"
      exit 3
    fi
  fi

  local enc_size
  enc_size="$(du -sh "$enc_file" | cut -f1)"
  log_info "Encrypted size: ${enc_size}"

  # Immediately wipe the unencrypted dump from disk
  rm -f "$dump_file"
  TEMP_FILES=("$enc_file")  # only enc_file remains for cleanup

  # ── Step 3: Upload to S3 ───────────────────────────────────────────────────
  log_info "Step 3/3: Uploading to s3://${BACKUP_BUCKET}/${s3_key} ..."
  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would run: aws s3 cp ${enc_file} s3://${BACKUP_BUCKET}/${s3_key}"
  else
    if ! aws s3 cp "$enc_file" "s3://${BACKUP_BUCKET}/${s3_key}" \
        --region "${AWS_REGION}" \
        --storage-class STANDARD_IA \
        --sse aws:kms \
        --metadata "database=${PGDATABASE},timestamp=${TIMESTAMP},host=${PGHOST}" \
        --no-progress 2>&1; then
      log_error "S3 upload failed"
      exit 4
    fi
  fi

  # ── Verify the upload ──────────────────────────────────────────────────────
  if [[ "$DRY_RUN" != "true" ]]; then
    local s3_size
    s3_size="$(aws s3 ls "s3://${BACKUP_BUCKET}/${s3_key}" --region "${AWS_REGION}" \
               | awk '{print $3}')"
    local local_size
    local_size="$(stat -c%s "$enc_file")"
    if [[ "$s3_size" != "$local_size" ]]; then
      log_error "Upload verification failed: local=${local_size} bytes, S3=${s3_size} bytes"
      exit 4
    fi
    log_info "Upload verified: ${s3_size} bytes at s3://${BACKUP_BUCKET}/${s3_key}"
  fi

  # ── Summary ────────────────────────────────────────────────────────────────
  local end_time
  end_time="$(date +%s)"
  local elapsed=$(( end_time - START_TIME ))
  local success_ts
  success_ts="$(date +%s)"

  log_info "=== Backup Completed Successfully ==="
  log_info "Duration:      ${elapsed}s"
  log_info "Dump size:     ${dump_size} (compressed)"
  log_info "Encrypted:     ${enc_size}"
  log_info "S3 path:       s3://${BACKUP_BUCKET}/${s3_key}"
  log_info "Timestamp:     ${TIMESTAMP}"

  # Push success metrics to Prometheus Pushgateway
  push_metric "backup_last_success_timestamp_seconds" "$success_ts" \
    "Unix timestamp of last successful backup completion"
  push_metric "backup_last_duration_seconds" "$elapsed" \
    "Duration in seconds of last backup attempt"
  push_metric "backup_last_size_bytes" "$(stat -c%s "$enc_file" 2>/dev/null || echo 0)" \
    "Size in bytes of last encrypted backup file"
  push_metric "backup_success_total" "1" \
    "1 if last backup succeeded, 0 otherwise"

  # Structured log line for log-based alerting (Loki/CloudWatch)
  echo "{\"level\":\"info\",\"event\":\"backup_complete\",\"database\":\"${PGDATABASE}\",\"duration_s\":${elapsed},\"dump_size\":\"${dump_size}\",\"s3_key\":\"${s3_key}\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
}

main "$@"
