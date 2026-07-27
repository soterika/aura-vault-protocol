#!/usr/bin/env python3
"""
scripts/compare-gas.py
======================
Compares a freshly generated gas-report.json against the committed
gas-baselines.json and exits non-zero if any contract function exceeds the
allowed regression threshold.

Usage
-----
  python3 scripts/compare-gas.py \\
      --baseline gas-baselines.json \\
      --report   gas-report.json \\
      [--output  gas-diff.md]      \\
      [--update-baseline]

Arguments
---------
  --baseline PATH       Path to the baseline JSON file (default: gas-baselines.json)
  --report PATH         Path to the current measurement JSON (default: gas-report.json)
  --output PATH         Write a Markdown summary to this file (optional)
  --update-baseline     If all checks pass, overwrite the baseline with the
                        current report (use after intentional optimisations)

Exit codes
----------
  0  All functions within threshold (or --update-baseline was used successfully)
  1  One or more functions exceeded the threshold
  2  Input file error or argument error
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

CHECKMARK = "✅"
WARNING   = "⚠️"
CROSS     = "❌"
ARROW_UP  = "⬆️"
ARROW_DN  = "⬇️"
DASH      = "➖"


def load_json(path: str) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"ERROR: File not found: {path}", file=sys.stderr)
        sys.exit(2)
    except json.JSONDecodeError as exc:
        print(f"ERROR: Invalid JSON in {path}: {exc}", file=sys.stderr)
        sys.exit(2)


def pct_change(baseline: int, current: int) -> float:
    """Return signed percentage change from baseline to current."""
    if baseline == 0:
        return 0.0
    return (current - baseline) / baseline * 100.0


def fmt_count(n: int) -> str:
    return f"{n:,}"


def fmt_pct(p: float) -> str:
    sign = "+" if p > 0 else ""
    return f"{sign}{p:.1f}%"


def trend_icon(p: float, threshold: float) -> str:
    if abs(p) < 0.5:
        return DASH
    if p > threshold:
        return CROSS
    if p > 0:
        return WARNING
    return ARROW_DN  # regression impossible (decreased) — good


# ──────────────────────────────────────────────────────────────────────────────
# Main comparison logic
# ──────────────────────────────────────────────────────────────────────────────

def compare(baseline_path: str, report_path: str, output_path: str | None, update: bool) -> int:
    baseline_data = load_json(baseline_path)
    report_data   = load_json(report_path)

    threshold_pct: float = float(baseline_data.get("threshold_pct", 10))
    baseline_ms: dict = baseline_data.get("measurements", {})
    report_ms:   dict = report_data.get("measurements", {})

    failures: list[str] = []
    rows: list[dict]    = []

    all_functions = sorted(set(baseline_ms) | set(report_ms))

    for fn in all_functions:
        if fn not in baseline_ms:
            rows.append({
                "fn":      fn,
                "status":  WARNING,
                "note":    "new (no baseline)",
                "b_cpu":   None,
                "c_cpu":   report_ms[fn]["cpu_instructions"],
                "d_cpu":   None,
                "b_mem":   None,
                "c_mem":   report_ms[fn]["mem_bytes"],
                "d_mem":   None,
            })
            continue

        if fn not in report_ms:
            rows.append({
                "fn":     fn,
                "status": WARNING,
                "note":   "missing from report",
                "b_cpu":  baseline_ms[fn]["cpu_instructions"],
                "c_cpu":  None,
                "d_cpu":  None,
                "b_mem":  baseline_ms[fn]["mem_bytes"],
                "c_mem":  None,
                "d_mem":  None,
            })
            continue

        b_cpu = baseline_ms[fn]["cpu_instructions"]
        c_cpu = report_ms[fn]["cpu_instructions"]
        b_mem = baseline_ms[fn]["mem_bytes"]
        c_mem = report_ms[fn]["mem_bytes"]

        dp_cpu = pct_change(b_cpu, c_cpu)
        dp_mem = pct_change(b_mem, c_mem)

        exceeded = dp_cpu > threshold_pct or dp_mem > threshold_pct

        if exceeded:
            failures.append(fn)
            icon = CROSS
        elif dp_cpu > 0 or dp_mem > 0:
            icon = WARNING
        else:
            icon = CHECKMARK

        rows.append({
            "fn":     fn,
            "status": icon,
            "note":   "exceeded threshold!" if exceeded else "",
            "b_cpu":  b_cpu,
            "c_cpu":  c_cpu,
            "d_cpu":  dp_cpu,
            "b_mem":  b_mem,
            "c_mem":  c_mem,
            "d_mem":  dp_mem,
        })

    # ── Build Markdown report ──────────────────────────────────────────────
    commit = report_data.get("commit", "unknown")
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    overall_status = CROSS if failures else CHECKMARK

    lines: list[str] = [
        "## Gas Usage Report",
        "",
        f"**{overall_status} Overall status**: {'FAILED — regressions detected' if failures else 'PASSED — all functions within threshold'}",
        f"**Commit**: `{commit}`",
        f"**Threshold**: +{threshold_pct:.0f}% above baseline triggers failure",
        f"**Generated**: {now_str}",
        "",
        "### CPU Instructions",
        "",
        "| Function | Baseline | Current | Δ% | Status |",
        "| --- | ---: | ---: | ---: | :---: |",
    ]

    for r in rows:
        fn   = r["fn"]
        icon = r["status"]
        if r["b_cpu"] is None:
            lines.append(f"| `{fn}` | — | {fmt_count(r['c_cpu'])} | new | {icon} |")
        elif r["c_cpu"] is None:
            lines.append(f"| `{fn}` | {fmt_count(r['b_cpu'])} | — | missing | {icon} |")
        else:
            ti = trend_icon(r["d_cpu"], threshold_pct)
            lines.append(
                f"| `{fn}` | {fmt_count(r['b_cpu'])} | {fmt_count(r['c_cpu'])} "
                f"| {fmt_pct(r['d_cpu'])} {ti} | {icon} |"
            )

    lines += [
        "",
        "### Memory Bytes",
        "",
        "| Function | Baseline | Current | Δ% | Status |",
        "| --- | ---: | ---: | ---: | :---: |",
    ]

    for r in rows:
        fn   = r["fn"]
        icon = r["status"]
        if r["b_mem"] is None:
            lines.append(f"| `{fn}` | — | {fmt_count(r['c_mem'])} | new | {icon} |")
        elif r["c_mem"] is None:
            lines.append(f"| `{fn}` | {fmt_count(r['b_mem'])} | — | missing | {icon} |")
        else:
            ti = trend_icon(r["d_mem"], threshold_pct)
            lines.append(
                f"| `{fn}` | {fmt_count(r['b_mem'])} | {fmt_count(r['c_mem'])} "
                f"| {fmt_pct(r['d_mem'])} {ti} | {icon} |"
            )

    if failures:
        lines += [
            "",
            "### ❌ Failures",
            "",
            "The following functions exceeded the allowed +{:.0f}% threshold:".format(threshold_pct),
            "",
        ]
        for fn in failures:
            r = next(x for x in rows if x["fn"] == fn)
            detail_parts = []
            if r["d_cpu"] is not None and r["d_cpu"] > threshold_pct:
                detail_parts.append(f"CPU {fmt_pct(r['d_cpu'])}")
            if r["d_mem"] is not None and r["d_mem"] > threshold_pct:
                detail_parts.append(f"mem {fmt_pct(r['d_mem'])}")
            lines.append(f"- `{fn}`: {', '.join(detail_parts)}")

        lines += [
            "",
            "> **To fix**: optimise the function(s) above and re-run the benchmarks.",
            "> **To accept**: update the baseline intentionally with:",
            "> ```",
            "> python3 scripts/compare-gas.py --update-baseline",
            "> ```",
        ]
    else:
        lines += [
            "",
            "> All functions are within the allowed threshold. "
            "To intentionally update the baseline after optimisations, run:",
            "> ```",
            "> python3 scripts/compare-gas.py --update-baseline",
            "> ```",
        ]

    lines.append("")
    md_content = "\n".join(lines)

    # ── Print to stdout ────────────────────────────────────────────────────
    print(md_content)

    # ── Write to file ──────────────────────────────────────────────────────
    if output_path:
        os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else ".", exist_ok=True)
        with open(output_path, "w") as f:
            f.write(md_content)
        print(f"\nMarkdown report written to {output_path}", file=sys.stderr)

    # ── Update baseline if requested (only when no failures) ──────────────
    if update:
        if failures:
            print(
                "\nERROR: --update-baseline requested but there are failures. "
                "Fix regressions before updating the baseline.",
                file=sys.stderr,
            )
            return 1
        # Merge new measurements into the existing baseline file
        baseline_data["measurements"] = report_ms
        baseline_data["generated_at"] = datetime.now(timezone.utc).isoformat()
        baseline_data["commit"]       = commit
        with open(baseline_path, "w") as f:
            json.dump(baseline_data, f, indent=2)
            f.write("\n")
        print(f"\nBaseline updated: {baseline_path}", file=sys.stderr)

    return 1 if failures else 0


# ──────────────────────────────────────────────────────────────────────────────
# CLI entry-point
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare gas-report.json against gas-baselines.json",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--baseline",
        default="gas-baselines.json",
        metavar="PATH",
        help="Baseline file (default: gas-baselines.json)",
    )
    parser.add_argument(
        "--report",
        default="gas-report.json",
        metavar="PATH",
        help="Current measurement report (default: gas-report.json)",
    )
    parser.add_argument(
        "--output",
        default=None,
        metavar="PATH",
        help="Write Markdown summary to this file (optional)",
    )
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="Overwrite the baseline with the current report when all checks pass",
    )

    args = parser.parse_args()
    rc = compare(args.baseline, args.report, args.output, args.update_baseline)
    sys.exit(rc)


if __name__ == "__main__":
    main()
