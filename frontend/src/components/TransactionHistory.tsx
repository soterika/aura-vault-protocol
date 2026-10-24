"use client";

import { useMemo, useState } from "react";
import { downloadTransactionPdf } from "@/lib/transactionPdf";
import { resolveNetwork, stellarExpertTxUrl, type StellarNetwork } from "@/lib/explorerLinks";

export type TxType = "deposit" | "withdraw" | "harvest" | "all";
export type TxStatus = "confirmed" | "pending" | "failed" | "all";

export interface Transaction {
  hash: string;
  date: string;
  type: Exclude<TxType, "all">;
  amount: string;
  shares?: string;
  status: Exclude<TxStatus, "all">;
}

export interface TransactionHistoryProps {
  transactions: Transaction[];
  walletAddress?: string;
  network?: StellarNetwork;
  /** @deprecated Provide `network`; retained for callers using the prior prop. */
  explorerBase?: string;
}

const PAGE_SIZE = 25;

function exportTransactions(transactions: Transaction[], address: string, format: "csv" | "json", from: string, to: string) {
  const rangeStart = from || "all";
  const rangeEnd = to || "all";
  const safeAddress = address.slice(0, 8);
  const rows = transactions.map((tx) => ({ date: tx.date, type: tx.type, amount: tx.amount, shares: tx.shares ?? "", txHash: tx.hash }));
  const content = format === "json"
    ? JSON.stringify(rows, null, 2)
    : ["date,type,amount,shares,txHash", ...rows.map((row) => [row.date, row.type, row.amount, row.shares, row.txHash].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))].join("\r\n");
  const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeAddress}_${rangeStart}_${rangeEnd}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function TransactionHistory({
  transactions,
  walletAddress = "",
  network,
  explorerBase,
}: TransactionHistoryProps) {
  const resolvedNetwork = network ?? (explorerBase?.includes("mainnet") ? "mainnet" : resolveNetwork());
  const [type, setType] = useState<TxType>("all");
  const [status, setStatus] = useState<TxStatus>("all");
  const defaultTo = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => transactions.filter((tx) => {
    if (type !== "all" && tx.type !== type) return false;
    if (status !== "all" && tx.status !== status) return false;
    const parsedDate = new Date(tx.date);
    if (Number.isNaN(parsedDate.getTime())) return false;
    const date = parsedDate.toISOString().slice(0, 10);
    if (from && date < from) return false;
    if (to && date > to) return false;
    return !query || tx.hash.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => b.date.localeCompare(a.date)), [transactions, type, status, from, to, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const currentRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const dateRange = [from || "Start", to || "Now"].join(" to ");

  return (
    <section className="space-y-4" aria-labelledby="transaction-history-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="transaction-history-title" className="text-xl font-semibold">Transaction history</h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => exportTransactions(filtered, walletAddress, "csv", from, to)} disabled={!filtered.length} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900">Export CSV</button>
          <button type="button" onClick={() => exportTransactions(filtered, walletAddress, "json", from, to)} disabled={!filtered.length} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50">Export JSON</button>
          <button type="button" onClick={() => downloadTransactionPdf({ transactions: filtered, address: walletAddress, dateRange })} disabled={!filtered.length} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50">Export PDF</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm">Search transaction
          <input className="mt-1 block w-full rounded border p-2 dark:bg-zinc-900" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </label>
        <label className="text-sm">Type
          <select className="mt-1 block w-full rounded border p-2 dark:bg-zinc-900" value={type} onChange={(event) => { setType(event.target.value as TxType); setPage(1); }}>
            <option value="all">All types</option><option value="deposit">Deposit</option><option value="withdraw">Withdraw</option><option value="harvest">Yield</option>
          </select>
        </label>
        <label className="text-sm">Status
          <select className="mt-1 block w-full rounded border p-2 dark:bg-zinc-900" value={status} onChange={(event) => { setStatus(event.target.value as TxStatus); setPage(1); }}>
            <option value="all">All statuses</option><option value="confirmed">Confirmed</option><option value="pending">Pending</option><option value="failed">Failed</option>
          </select>
        </label>
        <label className="text-sm">From
          <input type="date" min={to ? new Date(new Date(`${to}T00:00:00Z`).getTime() - 366 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : undefined} max={to || undefined} className="mt-1 block w-full rounded border p-2 dark:bg-zinc-900" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
        </label>
        <label className="text-sm">To
          <input type="date" min={from || undefined} max={new Date().toISOString().slice(0, 10)} className="mt-1 block w-full rounded border p-2 dark:bg-zinc-900" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800"><tr><th className="p-3">Date</th><th className="p-3">Type</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3">Transaction</th></tr></thead>
          <tbody>
            {currentRows.map((tx) => (
              <tr key={tx.hash} className="border-t border-zinc-200 dark:border-zinc-700">
                <td className="p-3">{new Date(tx.date).toLocaleString()}</td><td className="p-3 capitalize">{tx.type}</td><td className="p-3">{tx.amount}</td><td className="p-3 capitalize">{tx.status}</td>
                <td className="p-3"><a className="text-blue-700 underline dark:text-blue-300" href={stellarExpertTxUrl(tx.hash, resolvedNetwork)} target="_blank" rel="noreferrer">{tx.hash.slice(0, 8)}…{tx.hash.slice(-6)}</a></td>
              </tr>
            ))}
            {currentRows.length === 0 && <tr><td className="p-5 text-center text-zinc-500" colSpan={5}>No transactions match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>{filtered.length} matching transactions</span>
        <div className="flex items-center gap-2">
          <button type="button" className="rounded border px-3 py-1 disabled:opacity-40" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
          <span aria-live="polite">Page {currentPage} of {pages}</span>
          <button type="button" className="rounded border px-3 py-1 disabled:opacity-40" disabled={currentPage === pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next</button>
        </div>
      </div>
    </section>
  );
}
