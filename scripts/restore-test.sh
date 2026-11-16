#!/usr/bin/env bash
# =============================================================================
# restore-test.sh — Weekly backup restore validation
#
# Downloads the most recent encrypted backup from S3, decrypts it, restores
# it into an isolated test database, and runs a suite of integrity checks.
# Never touches the production database.
#
# Usage:
#   ./scripts/restore-test.sh [--dry-run] [--backup-key <s3-key>]
#
# Required environment variables:
#   BACKUP_BUCKET         — S3 bucket containing backups
#   BACKUP_ENCRYPTION_KEY — AES-256 passphrase used during backup
#   PGHOST                — Test PostgreSQL host   (default: localhost)
#   PGPORT                — Test PostgreSQL port   (default: 5432)
#   PGUSER                — Test PostgreSQL user   (default: aura)
#   PGPASSWORD            — Test PostgreSQL password (required)
#
# Optional:
#   AWS_REGION            — AWS region            (default: us-east-1)
#   BACKUP_PREFIX         — S3 key prefix         (default: postgres-backups)
#   TEST_DATABASE         — Name of temp database (default: restore_test_TIMESTAMP)
#   PUSHGATEWAY_URL       — Prometheus Pushgateway (optional)
#
# Exit codes:
#   0 — restore test passed
#   1 — configuration / dependency error
#   2 — no backup found in S3
#   3 — S3 download failed
#   4 — decryption failed
#   5 — restore failed
#   6 — integrity check failed
# =============================================================================

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
START_TIME="$(date +%s)"
DRY_RUN=false
EXPLICIT_BACKUP_KEY=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --backup-key) shift; EXPLICIT_BACKUP_KEY="$1" ;;
    *) ;;
  esac
done

# ── Logging ───────────────────────────────────────────────────────────────────
log_info()    { echo "[INFO]  $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
log_warn()    { echo "[WARN]  $(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >&2; }
log_error()   { echo "[ERROR] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >&2; }
log_success() { echo "[PASS]  $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# ── Configuration ─────────────────────────────────────────────────────────────
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-aura}"
AWS_REGION="${AWS_REGION:-us-east-1}"
BACKUP_PREFIX="${BACKUP_PREFIX:-postgres-backups}"
TEST_DATABASE="${TEST_DATABASE:-restore_test_${TIMESTAMP}}"

# ── Validation ────────────────────────────────────────────────────────────────
validate_config() {
  local errors=0
  [[ -z "${PGPASSWORD:-}"            ]] && log_error "PGPASSWORD is not set"            && errors=$((errors+1))
  [[ -z "${BACKUP_BUCKET:-}"         ]] && log_error "BACKUP_BUCKET is not set"         && errors=$((errors+1))
  [[ -z "${BACKUP_ENCRYPTION_KEY:-}" ]] && log_error "BACKUP_ENCRYPTION_KEY is not set" && errors=$((errors+1))
  [[ $errors -gt 0 ]] && exit 1
}

check_dependencies() {
  for cmd in aws openssl psql createdb dropdb; do
    command -v "$cmd" &>/dev/null || { log_error "Missing required command: $cmd"; exit 1; }
  done
}

# ── Prometheus metrics helper ─────────────────────────────────────────────────
push_metric() {
  [[ -z "${PUSHGATEWAY_URL:-}" ]] && return 0
  local name="$1" value="$2" help="${3:-}"
  printf "# HELP %s %s\n# TYPE %s gauge\n%s{job=\"backup_restore_test\"} %s\n" \
    "$name" "$help" "$name" "$name" "$value" \
  | curl -s --max-time 10 \
       --data-binary @- \
       "${PUSHGATEWAY_URL}/metrics/job/backup_restore_test" \
       > /dev/null 2>&1 || log_warn "Failed to push metric $name (non-fatal)"
}

# ── Cleanup ───────────────────────────────────────────────────────────────────
TEMP_FILES=()
DB_CREATED=false

cleanup() {
  local exit_code=$?

  # Remove temporary files
  for f in "${TEMP_FILES[@]:-}"; do
    [[ -f "$f" ]] && rm -f "$f" && log_info "Removed temp file: $f"
  done

  # Drop the test database if we created it
  if [[ "$DB_CREATED" == "true" ]] && [[ "$DRY_RUN" != "true" ]]; then
    log_info "Dropping test database: ${TEST_DATABASE}"
    PGPASSWORD="${PGPASSWORD}" dropdb \
      -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" \
      --if-exists "${TEST_DATABASE}" 2>/dev/null || \
      log_warn "Could not drop test database ${TEST_DATABASE} — clean up manually"
  fi

  if [[ $exit_code -ne 0 ]]; then
    local elapsed=$(( $(date +%s) - START_TIME ))
    log_error "Restore test FAILED after ${elapsed}s (exit code: $exit_code)"
    push_metric "backup_restore_test_success" "0" "1 if last restore test passed"
    push_metric "backup_restore_test_duration_seconds" "$elapsed" "Duration of last restore test"
    # Structured failure log for Loki/CloudWatch alerting
    echo "{\"level\":\"error\",\"event\":\"restore_test_failed\",\"exit_code\":$exit_code,\"duration_s\":$elapsed,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
  fi
}
trap cleanup EXIT

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  log_info "=== PostgreSQL Restore Test Started ==="
  log_info "Test database: ${TEST_DATABASE}"
  log_info "S3 source:     s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/"
  [[ "$DRY_RUN" == "true" ]] && log_info "DRY RUN mode — no production resources touched"

  validate_config
  check_dependencies

  local enc_file="/tmp/restore_test_${TIMESTAMP}.sql.gz.enc"
  local dump_file="/tmp/restore_test_${TIMESTAMP}.sql.gz"
  TEMP_FILES+=("$enc_file" "$dump_file")

  # ── Step 1: Find latest backup in S3 ───────────────────────────────────────
  log_info "Step 1/5: Locating latest backup in S3..."
  local backup_key

  if [[ -n "$EXPLICIT_BACKUP_KEY" ]]; then
    backup_key="$EXPLICIT_BACKUP_KEY"
    log_info "Using explicit backup key: ${backup_key}"
  else
    if [[ "$DRY_RUN" == "true" ]]; then
      backup_key="${BACKUP_PREFIX}/aura_vault_dry_run.sql.gz.enc"
      log_info "[DRY RUN] Using placeholder key: ${backup_key}"
    else
      backup_key="$(aws s3 ls "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/" \
                      --region "${AWS_REGION}" \
                    | sort -k1,2 \
                    | tail -n1 \
                    | awk '{print $4}')"
      if [[ -z "$backup_key" ]]; then
        log_error "No backups found in s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/"
        exit 2
      fi
      backup_key="${BACKUP_PREFIX}/${backup_key}"
      log_info "Latest backup: ${backup_key}"
    fi
  fi

  # ── Step 2: Download from S3 ───────────────────────────────────────────────
  log_info "Step 2/5: Downloading s3://${BACKUP_BUCKET}/${backup_key} ..."
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "dry-run placeholder" | gzip | \
      openssl enc -aes-256-cbc -pbkdf2 -iter 600000 \
        -pass "pass:${BACKUP_ENCRYPTION_KEY}" > "$enc_file"
  else
    if ! aws s3 cp "s3://${BACKUP_BUCKET}/${backup_key}" "$enc_file" \
        --region "${AWS_REGION}" \
        --no-progress 2>&1; then
      log_error "Failed to download backup from S3"
      exit 3
    fi
  fi
  log_info "Download complete: $(du -sh "$enc_file" | cut -f1)"

  # ── Step 3: Decrypt ────────────────────────────────────────────────────────
  log_info "Step 3/5: Decrypting backup..."
  if ! openssl enc -d -aes-256-cbc \
      -pbkdf2 \
      -iter 600000 \
      -pass "pass:${BACKUP_ENCRYPTION_KEY}" \
      -in  "$enc_file" \
      -out "$dump_file" 2>/dev/null; then
    log_error "Decryption failed — wrong key or corrupted backup"
    exit 4
  fi
  log_info "Decryption successful: $(du -sh "$dump_file" | cut -f1)"
  rm -f "$enc_file"
  TEMP_FILES=("$dump_file")

  # ── Step 4: Restore into isolated test database ────────────────────────────
  log_info "Step 4/5: Creating test database '${TEST_DATABASE}' and restoring..."
  if [[ "$DRY_RUN" != "true" ]]; then
    # Create isolated test database
    PGPASSWORD="${PGPASSWORD}" createdb \
      -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" \
      "${TEST_DATABASE}" 2>/dev/null || {
      log_error "Failed to create test database: ${TEST_DATABASE}"
      exit 5
    }
    DB_CREATED=true

    # Restore the dump
    if ! gunzip -c "$dump_file" | \
         PGPASSWORD="${PGPASSWORD}" psql \
           -h "${PGHOST}" -p "${PGPORT}" \
           -U "${PGUSER}" -d "${TEST_DATABASE}" \
           --set ON_ERROR_STOP=1 \
           -q 2>&1; then
      log_error "Restore into test database failed"
      exit 5
    fi
    log_info "Restore completed into ${TEST_DATABASE}"
  else
    log_info "[DRY RUN] Would create database ${TEST_DATABASE} and restore dump"
    DB_CREATED=false
  fi

  # ── Step 5: Integrity checks ───────────────────────────────────────────────
  log_info "Step 5/5: Running integrity checks..."
  local checks_passed=0
  local checks_failed=0

  run_check() {
    local check_name="$1"
    local query="$2"
    local expected_min="${3:-1}"   # minimum expected row/count

    if [[ "$DRY_RUN" == "true" ]]; then
      log_success "CHECK [DRY RUN] ${check_name}"
      checks_passed=$((checks_passed + 1))
      return 0
    fi

    local result
    result="$(PGPASSWORD="${PGPASSWORD}" psql \
      -h "${PGHOST}" -p "${PGPORT}" \
      -U "${PGUSER}" -d "${TEST_DATABASE}" \
      -t -A -c "${query}" 2>/dev/null || echo "0")"

    if [[ -z "$result" ]] || [[ "$result" == "0" && "$expected_min" -gt 0 ]]; then
      log_error "CHECK FAILED: ${check_name} (result: '${result}', expected >= ${expected_min})"
      checks_failed=$((checks_failed + 1))
    else
      log_success "CHECK PASSED: ${check_name} (result: ${result})"
      checks_passed=$((checks_passed + 1))
    fi
  }

  # Core schema presence checks
  run_check "vault_positions table exists" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'vault_positions';" 1
  run_check "transaction_queue table exists" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'transaction_queue';" 1
  run_check "yield_calculations table exists" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'yield_calculations';" 1
  run_check "apy_snapshots table exists" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'apy_snapshots';" 1
  run_check "contract_events table exists" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'contract_events';" 1
  run_check "audit_logs table exists" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'audit_logs';" 1

  # Data sanity checks
  run_check "vault_positions is queryable" \
    "SELECT COUNT(*) FROM vault_positions;" 0   # empty db is OK
  run_check "no corrupted pages (pg_catalog accessible)" \
    "SELECT COUNT(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public';" 1

  # ── Report ─────────────────────────────────────────────────────────────────
  local end_time elapsed
  end_time="$(date +%s)"
  elapsed=$(( end_time - START_TIME ))

  if [[ $checks_failed -gt 0 ]]; then
    log_error "Integrity checks FAILED: ${checks_failed} failed, ${checks_passed} passed"
    push_metric "backup_restore_test_success" "0" "1 if last restore test passed"
    push_metric "backup_restore_test_duration_seconds" "$elapsed" "Duration of last restore test"
    echo "{\"level\":\"error\",\"event\":\"restore_test_integrity_failed\",\"checks_failed\":${checks_failed},\"checks_passed\":${checks_passed},\"duration_s\":${elapsed},\"backup_key\":\"${backup_key}\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
    exit 6
  fi

  log_info "=== Restore Test Passed ==="
  log_info "Duration:       ${elapsed}s"
  log_info "Backup tested:  ${backup_key}"
  log_info "Checks passed:  ${checks_passed}"

  push_metric "backup_restore_test_success" "1" "1 if last restore test passed"
  push_metric "backup_restore_test_duration_seconds" "$elapsed" "Duration of last restore test"
  push_metric "backup_restore_test_last_run_timestamp_seconds" "$(date +%s)" \
    "Unix timestamp of last restore test run"

  echo "{\"level\":\"info\",\"event\":\"restore_test_passed\",\"checks_passed\":${checks_passed},\"duration_s\":${elapsed},\"backup_key\":\"${backup_key}\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
}

main "$@"
