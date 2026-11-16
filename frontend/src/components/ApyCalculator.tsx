"use client";

/**
 * ApyCalculator — interactive deposit return projector (issue #261).
 *
 * Acceptance criteria:
 *  ✓ Slider and numeric input for deposit amount (sync'd bidirectionally)
 *  ✓ Time-period radio: 1M / 3M / 6M / 12M
 *  ✓ Projected value and profit displayed in real time
 *  ✓ Uses current 7-day APY as the projection rate (fetched from /api/vault/apy)
 *  ✓ Disclaimer: "Projected returns are estimates, not guarantees"
 *  ✓ Accessible inputs with labeled slider and radio group
 */

import { useState, useEffect, useId, useCallback } from "react";

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_DEPOSIT = 0;
const MAX_DEPOSIT = 1_000_000;
const DEFAULT_DEPOSIT = 1_000;
const FALLBACK_APY = 8.5; // % — used until live data is fetched

type Period = "1M" | "3M" | "6M" | "12M";

interface PeriodOption {
  label: string;
  value: Period;
  months: number;
}

const PERIODS: PeriodOption[] = [
  { label: "1 Month", value: "1M", months: 1 },
  { label: "3 Months", value: "3M", months: 3 },
  { label: "6 Months", value: "6M", months: 6 },
  { label: "12 Months", value: "12M", months: 12 },
];

// ── Maths ────────────────────────────────────────────────────────────────────

/**
 * Compound interest formula:
 *   A = P × (1 + r/n)^(n×t)
 * where n = 12 (monthly compounding) and t is in years.
 */
function projectedValue(principal: number, apyPercent: number, months: number): number {
  const r = apyPercent / 100;
  const t = months / 12;
  return principal * Math.pow(1 + r / 12, 12 * t);
}

// ── Formatters ───────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtUsd(n: number): string {
  return fmt.format(n);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ApyCalculator() {
  const id = useId();

  const [deposit, setDeposit] = useState<number>(DEFAULT_DEPOSIT);
  // Raw text in the number input — allows partial edits like "1,0" without forcing
  const [inputText, setInputText] = useState<string>(String(DEFAULT_DEPOSIT));
  const [period, setPeriod] = useState<Period>("12M");
  const [apy, setApy] = useState<number>(FALLBACK_APY);
  const [apyLoading, setApyLoading] = useState(true);
  const [apyError, setApyError] = useState(false);

  // ── Fetch live APY ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchApy() {
      try {
        const res = await fetch("/api/vault/apy");
        if (!res.ok) throw new Error("Non-OK response");
        const data = (await res.json()) as { apy7d?: string | number; apy?: string | number };
        const raw = data.apy7d ?? data.apy;
        const parsed = typeof raw === "number" ? raw : parseFloat(raw ?? "");
        if (!cancelled && !isNaN(parsed) && parsed > 0) {
          setApy(parsed);
          setApyError(false);
        } else if (!cancelled) {
          setApyError(true);
        }
      } catch {
        if (!cancelled) setApyError(true);
      } finally {
        if (!cancelled) setApyLoading(false);
      }
    }

    fetchApy();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Derived projections ─────────────────────────────────────────────────────
  const selectedPeriod = PERIODS.find((p) => p.value === period)!;
  const projected = projectedValue(deposit, apy, selectedPeriod.months);
  const profit = projected - deposit;
  const profitPct = deposit > 0 ? (profit / deposit) * 100 : 0;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setDeposit(val);
    setInputText(String(val));
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9.]/g, "");
    setInputText(raw);
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      setDeposit(Math.min(MAX_DEPOSIT, Math.max(MIN_DEPOSIT, parsed)));
    }
  }, []);

  const handleInputBlur = useCallback(() => {
    // Normalise display on blur
    setInputText(String(deposit));
  }, [deposit]);

  const sliderPercent = (deposit / MAX_DEPOSIT) * 100;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {/* Header */}
      <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2
            id={`${id}-heading`}
            className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
          >
            APY Calculator
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Estimate your projected returns
          </p>
        </div>

        {/* Live APY badge */}
        <div
          className="flex items-center gap-2 self-start rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 dark:border-indigo-800 dark:bg-indigo-950"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
            7-Day APY
          </span>
          {apyLoading ? (
            <span
              className="h-4 w-12 animate-pulse rounded bg-indigo-200 dark:bg-indigo-800"
              aria-label="Loading APY…"
            />
          ) : (
            <span
              className="font-mono text-sm font-bold text-indigo-700 dark:text-indigo-300"
              aria-label={`Current 7-day APY: ${apy.toFixed(2)}%`}
            >
              {apy.toFixed(2)}%
              {apyError && (
                <span className="ml-1 text-xs font-normal text-zinc-400" aria-label="(estimated)">
                  *
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ── Left column: inputs ── */}
        <div className="flex flex-col gap-6">

          {/* Deposit amount */}
          <fieldset>
            <legend className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Deposit Amount
            </legend>

            {/* Numeric input */}
            <div className="flex items-center gap-2 mb-4">
              <label
                htmlFor={`${id}-deposit-input`}
                className="sr-only"
              >
                Deposit amount in USD
              </label>
              <div className="relative flex-1">
                <span
                  className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-400 text-sm"
                  aria-hidden="true"
                >
                  $
                </span>
                <input
                  id={`${id}-deposit-input`}
                  type="text"
                  inputMode="decimal"
                  value={inputText}
                  onChange={handleInputChange}
                  onBlur={handleInputBlur}
                  aria-label="Deposit amount in USD"
                  aria-describedby={`${id}-deposit-range`}
                  className="
                    w-full rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-3
                    text-sm font-mono text-zinc-900 placeholder-zinc-400
                    focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30
                    dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50
                    dark:focus:border-indigo-400 dark:focus:ring-indigo-400/30
                  "
                />
              </div>
              <span className="text-xs text-zinc-400 whitespace-nowrap">max $1M</span>
            </div>

            {/* Slider */}
            <div className="relative">
              <label
                htmlFor={`${id}-deposit-slider`}
                className="sr-only"
              >
                Deposit amount slider — {fmtUsd(deposit)}
              </label>
              <input
                id={`${id}-deposit-slider`}
                type="range"
                min={MIN_DEPOSIT}
                max={MAX_DEPOSIT}
                step={100}
                value={deposit}
                onChange={handleSliderChange}
                aria-label={`Deposit amount: ${fmtUsd(deposit)}`}
                aria-valuemin={MIN_DEPOSIT}
                aria-valuemax={MAX_DEPOSIT}
                aria-valuenow={deposit}
                aria-valuetext={fmtUsd(deposit)}
                className="
                  w-full cursor-pointer appearance-none rounded-full bg-zinc-200 h-2
                  dark:bg-zinc-700
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:h-5
                  [&::-webkit-slider-thumb]:w-5
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-indigo-600
                  [&::-webkit-slider-thumb]:dark:bg-indigo-400
                  [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-webkit-slider-thumb]:shadow-md
                  [&::-webkit-slider-thumb]:transition-transform
                  [&::-webkit-slider-thumb]:hover:scale-110
                  [&::-webkit-slider-thumb]:focus-visible:scale-110
                  [&::-moz-range-thumb]:h-5
                  [&::-moz-range-thumb]:w-5
                  [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:border-0
                  [&::-moz-range-thumb]:bg-indigo-600
                  [&::-moz-range-thumb]:dark:bg-indigo-400
                  [&::-moz-range-thumb]:cursor-pointer
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2
                "
                style={{
                  background: `linear-gradient(to right, #4f46e5 ${sliderPercent}%, var(--border) ${sliderPercent}%)`,
                }}
              />
              <span id={`${id}-deposit-range`} className="sr-only">
                Range 0 to 1,000,000 dollars. Step 100 dollars.
              </span>
              <div className="mt-1.5 flex justify-between text-xs text-zinc-400">
                <span>$0</span>
                <span>$1M</span>
              </div>
            </div>
          </fieldset>

          {/* Time period */}
          <fieldset>
            <legend className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Time Period
            </legend>
            <div
              role="radiogroup"
              aria-label="Select projection time period"
              className="grid grid-cols-4 gap-2"
            >
              {PERIODS.map((opt) => (
                <label
                  key={opt.value}
                  className={`
                    flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2
                    text-sm font-medium transition-colors duration-150
                    ${
                      period === opt.value
                        ? "border-indigo-500 bg-indigo-600 text-white dark:border-indigo-400 dark:bg-indigo-600"
                        : "border-zinc-300 bg-white text-zinc-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-indigo-700 dark:hover:bg-indigo-950"
                    }
                    focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2
                  `}
                >
                  <input
                    type="radio"
                    name={`${id}-period`}
                    value={opt.value}
                    checked={period === opt.value}
                    onChange={() => setPeriod(opt.value)}
                    className="sr-only"
                    aria-label={opt.label}
                  />
                  {opt.value}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {/* ── Right column: results ── */}
        <div className="flex flex-col gap-4">
          {/* Projected value card */}
          <div
            className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-800 dark:bg-indigo-950/50"
            aria-live="polite"
            aria-atomic="true"
            aria-label="Projected returns"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
              Projected Value after {selectedPeriod.label}
            </p>
            <p
              className="mt-1 font-mono text-3xl font-bold text-indigo-700 dark:text-indigo-300 tabular-nums"
              data-testid="projected-value"
            >
              {fmtUsd(deposit > 0 ? projected : 0)}
            </p>
          </div>

          {/* Profit breakdown */}
          <div
            className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-800"
            aria-live="polite"
            aria-atomic="true"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Estimated Profit
            </p>
            <p
              className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                profit >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
              data-testid="projected-profit"
            >
              +{fmtUsd(deposit > 0 ? profit : 0)}
            </p>
            <p
              className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400 tabular-nums"
              data-testid="projected-profit-pct"
            >
              +{deposit > 0 ? profitPct.toFixed(2) : "0.00"}% return
            </p>
          </div>

          {/* Breakdown table */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800/60">
            <dt className="text-zinc-500 dark:text-zinc-400">Principal</dt>
            <dd className="text-right font-mono font-medium text-zinc-800 dark:text-zinc-200 tabular-nums">
              {fmtUsd(deposit)}
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">APY rate</dt>
            <dd className="text-right font-mono font-medium text-zinc-800 dark:text-zinc-200 tabular-nums">
              {apy.toFixed(2)}%
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">Period</dt>
            <dd className="text-right font-mono font-medium text-zinc-800 dark:text-zinc-200">
              {selectedPeriod.label}
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">Compounding</dt>
            <dd className="text-right font-mono font-medium text-zinc-800 dark:text-zinc-200">
              Monthly
            </dd>
          </dl>
        </div>
      </div>

      {/* ── Disclaimer ── */}
      <p
        className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        role="note"
        aria-label="Disclaimer"
      >
        <span className="mr-1 font-semibold">⚠ Disclaimer:</span>
        Projected returns are estimates based on the current 7-day APY and are not
        guarantees of future performance. Actual returns may vary due to market
        conditions, vault activity, and compounding frequency.
        {apyError && (
          <span className="block mt-1 text-zinc-500 dark:text-zinc-400">
            * APY data could not be loaded; using an estimated fallback rate of {FALLBACK_APY}%.
          </span>
        )}
      </p>
    </section>
  );
}
