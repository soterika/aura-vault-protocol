"use client";

import { useAnimatedNumber } from "@/lib/useAnimatedNumber";

interface AnimatedShareBalanceProps {
  value: string;
  className?: string;
  priceMode?: boolean;
  decimals?: number;
}

export function AnimatedShareBalance({
  value,
  className = "",
  priceMode = false,
  decimals = 2,
}: AnimatedShareBalanceProps) {
  const numeric = Number.parseFloat(value.replaceAll(",", ""));
  const display = useAnimatedNumber(Number.isFinite(numeric) ? numeric : 0, {
    decimals: priceMode ? 4 : decimals,
    duration: 260,
  });

  return (
    <span aria-live="polite" className={`tabular-nums ${className}`}>
      <span key={display} className="animate-value-change inline-block">{display}</span>
    </span>
  );
}
