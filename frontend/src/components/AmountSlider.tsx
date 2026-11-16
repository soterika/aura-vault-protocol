"use client";

import { useCallback, useId } from "react";

interface AmountSliderProps {
  /** Total available balance */
  available: number;
  /** Current selected amount */
  value: number;
  /** Called whenever the amount changes */
  onChange: (amount: number) => void;
  /** Token symbol for display */
  symbol?: string;
  /** Optional className on the root element */
  className?: string;
}

const PRESETS = [
  { label: "25%", pct: 25 },
  { label: "50%", pct: 50 },
  { label: "75%", pct: 75 },
  { label: "Max", pct: 100 },
];

function pctOfAvailable(pct: number, available: number): number {
  return Math.floor((pct / 100) * available);
}

function amountToPct(amount: number, available: number): number {
  if (available === 0) return 0;
  return Math.min(100, Math.round((amount / available) * 100));
}

export default function AmountSlider({
  available,
  value,
  onChange,
  symbol = "tokens",
  className = "",
}: AmountSliderProps) {
  const sliderId = useId();
  const pct = amountToPct(value, available);

  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const p = Number(e.target.value);
      onChange(pctOfAvailable(p, available));
    },
    [available, onChange]
  );

  const handlePreset = useCallback(
    (p: number) => {
      onChange(pctOfAvailable(p, available));
    },
    [available, onChange]
  );

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Preset buttons */}
      <div
        className="flex gap-2"
        role="group"
        aria-label="Select percentage of available balance"
      >
        {PRESETS.map(({ label, pct: p }) => (
          <button
            key={p}
            type="button"
            onClick={() => handlePreset(p)}
            aria-pressed={pct === p}
            className={`flex-1 rounded-lg border py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
              pct === p
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 hover:border-indigo-400 text-zinc-700 dark:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Slider with visual fill */}
      <div className="relative flex items-center">
        {/* Background track */}
        <div className="absolute inset-y-0 left-0 right-0 flex items-center pointer-events-none">
          <div className="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>
        {/* Fill track */}
        <div
          className="absolute left-0 h-1.5 rounded-full bg-indigo-500 pointer-events-none transition-all"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={handleSlider}
          aria-label={`Amount as percentage of available balance: ${pct}%`}
          aria-valuetext={`${pct}% — ${value} ${symbol}`}
          className={[
            "relative w-full appearance-none bg-transparent cursor-pointer",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
            // Webkit thumb — 44px touch target
            "[&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:h-[44px]",
            "[&::-webkit-slider-thumb]:w-[44px]",
            "[&::-webkit-slider-thumb]:rounded-full",
            "[&::-webkit-slider-thumb]:bg-indigo-600",
            "[&::-webkit-slider-thumb]:border-2",
            "[&::-webkit-slider-thumb]:border-white",
            "[&::-webkit-slider-thumb]:shadow-md",
            "[&::-webkit-slider-thumb]:cursor-grab",
            "[&::-webkit-slider-thumb]:active:cursor-grabbing",
            // Firefox thumb
            "[&::-moz-range-thumb]:h-[44px]",
            "[&::-moz-range-thumb]:w-[44px]",
            "[&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:bg-indigo-600",
            "[&::-moz-range-thumb]:border-2",
            "[&::-moz-range-thumb]:border-white",
            "[&::-moz-range-thumb]:shadow-md",
            "[&::-moz-range-thumb]:cursor-grab",
          ].join(" ")}
        />
      </div>

      {/* Real-time amount display */}
      <p
        className="text-center text-sm text-zinc-500 dark:text-zinc-400"
        aria-live="polite"
        aria-atomic="true"
      >
        {value.toLocaleString()} {symbol}
        <span className="ml-1 text-xs opacity-70">
          ({pct}% of available)
        </span>
      </p>
    </div>
  );
}
