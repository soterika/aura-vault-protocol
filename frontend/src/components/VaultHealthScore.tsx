"use client";

interface VaultHealthScoreProps {
  score?: number;
  className?: string;
}
/** Displays a simple health score badge for the vault. */
export default function VaultHealthScore({
  score = 0,
  className = "",
}: VaultHealthScoreProps) {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const color =
    clampedScore >= 80
      ? "text-emerald-600 dark:text-emerald-400"
      : clampedScore >= 50
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";
  return (
    <div
      className={`flex flex-col items-center gap-1 ${className}`}
      aria-label={`Vault health score: ${clampedScore} out of 100`}
    >
      <span className={`text-3xl font-bold font-mono tabular-nums ${color}`}>
        {clampedScore}
      </span>
      <span className="text-xs text-zinc-500 uppercase tracking-wide">
        Health Score
    </div>
  );
export default function VaultHealthScore() { return null; }
export { VaultHealthScore };
