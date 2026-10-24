"use client";

import { useEffect, useState } from "react";
import TransactionHistory, { type Transaction } from "@/components/TransactionHistory";
import { useWalletStore } from "@/lib/walletStore";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type HistoryItem = { type: "deposit" | "withdraw" | "harvest"; amount: string; shares?: string; tx_hash: string; timestamp: string };
type HistoryPage = { data?: HistoryItem[]; pagination?: { total?: number; totalPages?: number } };

async function loadHistory(address: string): Promise<Transaction[]> {
  const first = await fetch(`${API}/api/portfolio/${encodeURIComponent(address)}/history?page=1&pageSize=100`, { cache: "no-store" });
  if (!first.ok) throw new Error("Transaction history is unavailable.");
  const firstPage = (await first.json()) as HistoryPage;
  const totalPages = Math.min(10, Math.max(1, firstPage.pagination?.totalPages ?? 1));
  const rest = await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) =>
    fetch(`${API}/api/portfolio/${encodeURIComponent(address)}/history?page=${index + 2}&pageSize=100`, { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as HistoryPage : { data: [] }),
  ));
  return [firstPage, ...rest].flatMap((page) => page.data ?? []).map((tx) => ({
    hash: tx.tx_hash,
    date: tx.timestamp,
    type: tx.type,
    amount: tx.amount,
    shares: tx.shares,
    status: "confirmed" as const,
  }));
}

export default function TransactionsPage() {
  const address = useWalletStore((state) => state.address);
  const network = useWalletStore((state) => state.network);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!address) {
      setTransactions([]);
      return;
    }
    setLoading(true);
    setError("");
    loadHistory(address)
      .then((items) => { if (active) setTransactions(items); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load transactions."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [address]);

  return (
    <main className="page-transition mx-auto w-full max-w-7xl space-y-5 px-4 py-8 sm:px-6">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">Export the filtered transaction history for your connected wallet. Up to 1,000 recent records are loaded for client-side export.</p>
      {!address && <p role="status" className="rounded-lg bg-amber-50 p-4 text-amber-950">Connect a wallet to view transaction history.</p>}
      {loading && <p role="status">Loading transaction history…</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {address && !loading && !error && <TransactionHistory transactions={transactions} walletAddress={address} network={network === "mainnet" ? "mainnet" : "testnet"} />}
    </main>
  );
}
