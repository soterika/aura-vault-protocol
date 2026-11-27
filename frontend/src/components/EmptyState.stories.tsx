"use client";

import { EmptyState } from "./EmptyState";

export default {
  title: "Aura Vault/Empty States",
  component: EmptyState,
};

export function TransactionHistoryEmpty() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <EmptyState variant="no-transactions" />
    </div>
  );
}

export function LeaderboardEmpty() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <EmptyState variant="no-leaderboard" />
    </div>
  );
}

export function VaultPositionsEmpty() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <EmptyState variant="no-positions" />
    </div>
  );
}

export function NotificationsEmpty() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <EmptyState variant="no-notifications" />
    </div>
  );
}
