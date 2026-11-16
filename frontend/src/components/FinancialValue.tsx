"use client";

interface FinancialValueProps {
  value: string | number;
  sentiment?: "positive" | "negative" | "neutral" | "warning";
  className?: string;
}
const sentimentClasses = {
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  neutral: "text-zinc-700 dark:text-zinc-300",
};
export function FinancialValue({
  value,
  sentiment = "neutral",
  className = "",
}: FinancialValueProps) {
  return (
    <span className={`font-mono ${sentimentClasses[sentiment]} ${className}`}>
      {value}
    </span>
  );
interface FinancialValueProps { value: string; sentiment?: "positive"|"negative"|"warning"|"neutral"; className?: string; }
export function FinancialValue({ value, className="" }: FinancialValueProps) { return <span className={className}>{value}</span>; }
