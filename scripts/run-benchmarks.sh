#!/usr/bin/env bash
# scripts/run-benchmarks.sh
#
# Primary benchmark script for AuraVault contract functions.
#
# Uses Soroban's built-in instruction counter (env.cost_estimate().budget())
# to measure CPU instructions and memory bytes for every public entry-point.
# Results are written as NDJSON to gas-measurements.json and a human-readable
# summary is printed to stdout.
#
# Usage:
#   ./scripts/run-benchmarks.sh [--update-baselines] [--output <path>]
#
# Options:
#   --update-baselines   After measuring, update gas-baselines.json in-place.
#   --output <path>      Where to write NDJSON measurements
#                        (default: ./gas-measurements.json)
#   --compare            Compare results against baselines after measuring
#                        (default: enabled unless --no-compare is passed)
#   --no-compare         Skip baseline comparison step.
#
# Environment variables:
#   GAS_OUTPUT           Override the measurements output path.
#   CARGO_DIR            Directory containing aura-vault/Cargo.toml
#                        (default: ./aura-vault)
#
# Exit codes:
#   0  — benchmarks ran; all functions within threshold (or --no-compare)
#   1  — one or more functions exceeded the regression threshold
#   2  — benchmark run itself failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CARGO_DIR="${CARGO_DIR:-${REPO_ROOT}/aura-vault}"

# ── Defaults ──────────────────────────────────────────────────────────────────
OUTPUT_FILE="${GAS_OUTPUT:-${REPO_ROOT}/gas-measurements.json}"
BASELINES_FILE="${REPO_ROOT}/gas-baselines.json"
DO_COMPARE=true
UPDATE_BASELINES=false

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --update-baselines) UPDATE_BASELINES=true ;;
        --no-compare)       DO_COMPARE=false ;;
        --compare)          DO_COMPARE=true ;;
        --output)           shift; OUTPUT_FILE="$1" ;;
        -h|--help)
            sed -n '3,35p' "$0"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log()   { echo -e "${CYAN}[benchmark]${RESET} $*"; }
ok()    { echo -e "${GREEN}✓${RESET} $*"; }
warn()  { echo -e "${YELLOW}⚠${RESET}  $*"; }
fail()  { echo -e "${RED}✗${RESET} $*"; }
title() { echo -e "\n${BOLD}$*${RESET}"; }

# ── Dependency checks ─────────────────────────────────────────────────────────
for cmd in cargo python3; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: '$cmd' is required but not in PATH." >&2
        exit 2
    fi
done

# ── Banner ────────────────────────────────────────────────────────────────────
title "AuraVault Gas Benchmarks"
echo  "  Soroban instruction counter — CPU instructions + memory bytes"
echo  "  Rust: $(rustc --version)"
echo  "  Output: ${OUTPUT_FILE}"
echo  "  Baselines: ${BASELINES_FILE}"
echo

# ── Clean previous run ────────────────────────────────────────────────────────
rm -f "${OUTPUT_FILE}"

# ── Run gas measurement tests ─────────────────────────────────────────────────
# --test-threads=1 ensures each test gets a fresh budget counter without
# cross-contamination from parallel test execution.
title "Running gas_ tests (single-threaded for stable counters) …"
log "Working directory: ${CARGO_DIR}"

set +e
GAS_OUTPUT="${OUTPUT_FILE}" \
    cargo test --manifest-path "${CARGO_DIR}/Cargo.toml" \
        gas_ \
        --test-threads=1 \
        -- --nocapture 2>&1 | tee /tmp/gas-raw-output.txt
CARGO_EXIT=$?
set -e

# Extract any GAS_MEASURE lines that went only to stdout (belt-and-suspenders).
grep "^GAS_MEASURE:" /tmp/gas-raw-output.txt 2>/dev/null \
    | sed 's/^GAS_MEASURE: //' >> "${OUTPUT_FILE}" || true

if [[ $CARGO_EXIT -ne 0 ]]; then
    fail "cargo test exited with code ${CARGO_EXIT}."
    echo "--- raw output ---"
    cat /tmp/gas-raw-output.txt
    exit 2
fi

if [[ ! -s "${OUTPUT_FILE}" ]]; then
    fail "No measurements were written to ${OUTPUT_FILE}."
    echo "Check that gas_ tests call measure() and GAS_OUTPUT is set."
    exit 2
fi

# ── Print measurement summary ─────────────────────────────────────────────────
title "Measurements"
python3 - "${OUTPUT_FILE}" <<'PYEOF'
import json, sys
from pathlib import Path

measurements = {}
for line in Path(sys.argv[1]).read_text().splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        obj  = json.loads(line)
        fn   = obj["function"]
        cpu  = int(obj["cpu_instructions"])
        mem  = int(obj["memory_bytes"])
        # last write wins (idempotent re-runs)
        measurements[fn] = {"cpu_instructions": cpu, "memory_bytes": mem}
    except Exception as e:
        print(f"  WARNING: skipping malformed line ({e}): {line!r}", file=sys.stderr)

print(f"  {'Function':<30} {'CPU instructions':>18} {'Memory bytes':>14}")
print("  " + "─" * 64)
for fn in sorted(measurements):
    cpu = measurements[fn]["cpu_instructions"]
    mem = measurements[fn]["memory_bytes"]
    print(f"  {fn:<30} {cpu:>18,} {mem:>14,}")
print()
print(f"  Total functions measured: {len(measurements)}")
PYEOF

# ── Optionally update baselines ───────────────────────────────────────────────
if [[ "${UPDATE_BASELINES}" == "true" ]]; then
    title "Updating baselines …"
    python3 "${SCRIPT_DIR}/update_baselines.py" \
        --baselines "${BASELINES_FILE}" \
        --measurements "${OUTPUT_FILE}"
    ok "Baselines updated. Review and commit ${BASELINES_FILE}."
fi

# ── Optionally compare against baselines ──────────────────────────────────────
if [[ "${DO_COMPARE}" == "true" ]]; then
    title "Comparing against baselines (threshold: $(
        python3 -c "import json; d=json.load(open('${BASELINES_FILE}')); print(d.get('_threshold_pct', 10))"
    )%) …"
    set +e
    python3 "${SCRIPT_DIR}/compare_gas.py" \
        --baselines  "${BASELINES_FILE}" \
        --measurements "${OUTPUT_FILE}"
    COMPARE_EXIT=$?
    set -e

    if [[ $COMPARE_EXIT -ne 0 ]]; then
        fail "Gas regression detected."
        echo
        echo "  If this change intentionally increases gas usage, update baselines:"
        echo "    ./scripts/run-benchmarks.sh --update-baselines"
        echo "    git add gas-baselines.json"
        echo '    git commit -m "chore: update gas baselines"'
        exit 1
    else
        ok "All functions within threshold."
    fi
fi

echo
ok "Benchmark run complete. Results: ${OUTPUT_FILE}"
