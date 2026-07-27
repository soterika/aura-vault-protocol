#!/usr/bin/env bash
# scripts/measure-gas.sh
#
# Runs the Soroban gas benchmark tests, extracts the GAS_MEASUREMENT JSON lines,
# and writes a gas-report.json to the repository root.
#
# Usage:
#   ./scripts/measure-gas.sh [--output <path>]
#
# Output (gas-report.json):
#   {
#     "generated_at": "2024-01-01T00:00:00Z",
#     "commit": "abc1234",
#     "measurements": {
#       "initialize":   { "cpu_instructions": 12345, "mem_bytes": 6789 },
#       "deposit":      { ... },
#       ...
#     }
#   }
#
# Requires: cargo, python3 (or jq for the JSON assembly step)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT_DIR="${REPO_ROOT}/aura-vault"
OUTPUT_FILE="${REPO_ROOT}/gas-report.json"

# Parse optional --output flag
while [[ $# -gt 0 ]]; do
    case "$1" in
        --output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

echo "=== Aura Vault Gas Measurement ==="
echo "Vault directory : ${VAULT_DIR}"
echo "Output file     : ${OUTPUT_FILE}"
echo ""

# Run the gas benchmarks, capturing stdout (--nocapture exposes println! output)
echo "[1/3] Running gas benchmark tests…"
RAW_OUTPUT=$(
    cd "${VAULT_DIR}" && \
    cargo test gas_bench -- --nocapture --test-threads=1 2>&1
)

echo "[2/3] Extracting GAS_MEASUREMENT lines…"
# Each matching line looks like:
#   GAS_MEASUREMENT: {"function":"deposit","cpu_instructions":12345,"mem_bytes":6789}
MEASUREMENTS=$(echo "${RAW_OUTPUT}" | grep '^GAS_MEASUREMENT: ' | sed 's/^GAS_MEASUREMENT: //')

if [[ -z "${MEASUREMENTS}" ]]; then
    echo "ERROR: No GAS_MEASUREMENT lines found in test output." >&2
    echo "Make sure the gas_bench tests compile and run with --nocapture." >&2
    echo "" >&2
    echo "--- raw output ---" >&2
    echo "${RAW_OUTPUT}" >&2
    exit 1
fi

MEASUREMENT_COUNT=$(echo "${MEASUREMENTS}" | wc -l | tr -d ' ')
echo "  Found ${MEASUREMENT_COUNT} measurement(s)."

echo "[3/3] Writing ${OUTPUT_FILE}…"

# Assemble the JSON report via Python (available on all GitHub Actions runners)
python3 - <<PYEOF
import json, sys, os
from datetime import datetime, timezone

raw = """${MEASUREMENTS}"""

measurements = {}
for line in raw.strip().splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        obj = json.loads(line)
        fn_name = obj["function"]
        measurements[fn_name] = {
            "cpu_instructions": obj["cpu_instructions"],
            "mem_bytes":        obj["mem_bytes"],
        }
    except (json.JSONDecodeError, KeyError) as e:
        print(f"WARNING: could not parse line: {line!r}  ({e})", file=sys.stderr)

# Determine git commit (best-effort)
try:
    import subprocess
    commit = subprocess.check_output(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd="${REPO_ROOT}",
        stderr=subprocess.DEVNULL,
        text=True,
    ).strip()
except Exception:
    commit = "unknown"

report = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "commit":       commit,
    "measurements": measurements,
}

output_path = "${OUTPUT_FILE}"
os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else ".", exist_ok=True)
with open(output_path, "w") as f:
    json.dump(report, f, indent=2)
    f.write("\n")

print(f"Written {len(measurements)} measurements to {output_path}")
for fn, data in sorted(measurements.items()):
    print(f"  {fn:20s}  cpu={data['cpu_instructions']:>12,}  mem={data['mem_bytes']:>10,}")
PYEOF

echo ""
echo "Done. Gas report written to ${OUTPUT_FILE}"
