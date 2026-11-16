"use client";

type EmptyVariant = "no-transactions" | "no-data" | "no-positions" | string;
interface EmptyStateProps {
  variant?: EmptyVariant;
  title?: string;
  description?: string;
  className?: string;
}
const variantDefaults: Record<string, { title: string; description: string; icon: string }> = {
  "no-transactions": {
    title: "No transactions yet",
    description: "Your transaction history will appear here.",
    icon: "📋",
  },
  "no-data": {
    title: "No data available",
    description: "Data will appear here once it's available.",
    icon: "📊",
  "no-positions": {
    title: "No positions",
    description: "Deposit tokens to get started.",
    icon: "💰",
};
export function EmptyState({
  variant = "no-data",
  title,
  description,
  className = "",
}: EmptyStateProps) {
  const defaults = variantDefaults[variant] ?? variantDefaults["no-data"];
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 text-center py-8 ${className}`}
      role="status"
      aria-label={title ?? defaults.title}
    >
      <span className="text-3xl" aria-hidden="true">
        {defaults.icon}
      </span>
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {title ?? defaults.title}
      </p>
      <p className="text-xs text-zinc-400">
        {description ?? defaults.description}
    </div>
  );
interface EmptyStateProps { variant?: string; className?: string; }
export function EmptyState({ className="" }: EmptyStateProps) { return <div className={className} />; }
