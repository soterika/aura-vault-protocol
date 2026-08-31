#!/usr/bin/env bash
# scripts/check-gas.sh
#
# Runs the AuraVault gas measurement tests, collects NDJSON output, and
# compares each function's CPU instruction count against the baseline in
# gas-baselines.json using compare_gas.py.
#
# Exit codes:
#   0  — all functions within threshold
#   1  — one or more functions exceeded the allowed threshold
#
# Usage:
#   ./scripts/check-gas.sh
#
# Environment variables:
#   GAS_BASELINE  — path to the baseline file      (default: ./gas-baselines.json)
#   GAS_REPORT    — path to write the JSON report  (default: ./gas-report.json)
#   CARGO_DIR     — directory with Cargo.toml       (default: ./aura-vault)
#   GAS_OUTPUT    — path for NDJSON measurements    (default: ./gas-measurements.json)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

BASELINE="${GAS_BASELINE:-${REPO_ROOT}/gas-baselines.json}"
REPORT="${GAS_REPORT:-${REPO_ROOT}/gas-report.json}"
CARGO_DIR="${CARGO_DIR:-${REPO_ROOT}/aura-vault}"
GAS_OUTPUT_FILE="${GAS_OUTPUT:-${REPO_ROOT}/gas-measurements.json}"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

log()  { echo -e "${CYAN}[gas-check]${RESET} $*"; }
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
fail() { echo -e "${RED}✗${RESET} $*"; }

# ── Dependency checks ──────────────────────────────────────────────────────────
for cmd in cargo python3; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: '$cmd' is required but not found in PATH." >&2
        exit 1
    fi
done

# ── Clean previous measurements ────────────────────────────────────────────────
rm -f "${GAS_OUTPUT_FILE}"

# ── Run gas tests ──────────────────────────────────────────────────────────────
log "Running gas measurement tests in ${CARGO_DIR} …"

GAS_OUTPUT="${GAS_OUTPUT_FILE}" \
    cd "${CARGO_DIR}" && \
    GAS_OUTPUT="${GAS_OUTPUT_FILE}" \
    cargo test gas_ --test-threads=1 -- --nocapture 2>/dev/null | \
    grep "^GAS_MEASURE:" | sed 's/^GAS_MEASURE: //' >> "${GAS_OUTPUT_FILE}" || true

# The test binary also writes directly to GAS_OUTPUT_FILE via the measure() fn.
# The grep/sed above captures any that go only to stdout, ensuring nothing is missed.

if [[ ! -s "${GAS_OUTPUT_FILE}" ]]; then
    # Retry: run without the pipe filter so we see all output for diagnosis.
    log "Retrying without stdout filter to capture measurements…"
    cd "${CARGO_DIR}"
    GAS_OUTPUT="${GAS_OUTPUT_FILE}" \
        cargo test gas_ --test-threads=1 -- --nocapture 2>&1 | \
        grep "^GAS_MEASURE:" | sed 's/^GAS_MEASURE: //' > "${GAS_OUTPUT_FILE}" || true
fi

if [[ ! -s "${GAS_OUTPUT_FILE}" ]]; then
    echo "ERROR: ${GAS_OUTPUT_FILE} is empty. Did the gas_ tests run and produce measurements?" >&2
    exit 1
fi

log "Measurements written to ${GAS_OUTPUT_FILE}"
log "Sample output:"
head -5 "${GAS_OUTPUT_FILE}"

# ── Compare against baselines ──────────────────────────────────────────────────
log "Comparing against baselines in ${BASELINE} …"

cd "${REPO_ROOT}"
set +e
python3 scripts/compare_gas.py \
    --baselines "${BASELINE}" \
    --measurements "${GAS_OUTPUT_FILE}" | tee gas-report.md
EXIT_CODE=${PIPESTATUS[0]}
set -e

# ── Write JSON report for CI artifact ─────────────────────────────────────────
python3 - "${BASELINE}" "${GAS_OUTPUT_FILE}" "${REPORT}" <<'PYEOF'
import json, sys
from pathlib import Path

baseline_path     = sys.argv[1]
measurements_path = sys.argv[2]
report_path       = sys.argv[3]

data = json.loads(Path(baseline_path).read_text())
threshold = int(data.get("_threshold_pct", 10))
baselines = data["baselines"]

measurements = {}
for line in Path(measurements_path).read_text().splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        obj = json.loads(line)
        measurements[obj["function"]] = {
            "cpu_instructions": int(obj["cpu_instructions"]),
            "memory_bytes":     int(obj["memory_bytes"]),
        }
    except Exception:
        pass

results = []
total_pass = total_fail = total_skip = 0

for fn in sorted(set(list(baselines.keys()) + list(measurements.keys()))):
    bl_entry = baselines.get(fn)
    ms_entry = measurements.get(fn)

    if bl_entry is None or ms_entry is None:
        total_skip += 1
        results.append({
            "function": fn,
            "baseline": bl_entry["cpu_instructions"] if bl_entry else None,
            "current":  ms_entry["cpu_instructions"] if ms_entry else None,
            "delta_percent": None,
            "status": "skip",
        })
        continue

    bl  = bl_entry["cpu_instructions"]
    cur = ms_entry["cpu_instructions"]
    delta = ((cur - bl) / bl * 100.0) if bl else 0.0

    if delta > threshold:
        total_fail += 1
        status = "fail"
    else:
        total_pass += 1
        status = "pass"

    results.append({
        "function":      fn,
        "baseline":      bl,
        "current":       cur,
        "delta_percent": round(delta, 2),
        "status":        status,
    })

report = {
    "pass":              total_pass,
    "fail":              total_fail,
    "skip":              total_skip,
    "threshold_percent": threshold,
    "results":           results,
}
Path(report_path).write_text(json.dumps(report, indent=2) + "\n")
print(f"JSON report written to {report_path}")
PYEOF

if [[ $EXIT_CODE -ne 0 ]]; then
    fail "Gas regression threshold exceeded. See ${REPORT} for details."
    echo ""
    echo "To update baselines after an intentional optimisation:"
    echo "  ./scripts/update-gas-baselines.sh"
    exit 1
else
    ok "All gas measurements within threshold."
    exit 0
fi
