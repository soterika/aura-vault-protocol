"use client";

import { useState } from "react";
import { parseAddressCsv } from "@/lib/portfolioCsv";

type ResultRow = {
  address: string;
  shares?: string;
  estimatedValue?: string;
  estimatedYield?: string;
  error?: string;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
const CONCURRENCY = 5;
const ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const TOKEN_SCALE = 10_000_000n;

function formatTokens(raw?: string): string {
  if (!raw || !/^\d+$/.test(raw)) return "—";
  const value = BigInt(raw);
  const whole = (value / TOKEN_SCALE).toLocaleString();
  const fraction = (value % TOKEN_SCALE).toString().padStart(7, "0");
  return `${whole}.${fraction}`;
}

function isValidAccountAddress(address: string): boolean {
  if (!ADDRESS_RE.test(address)) return false;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of address) {
    const value = alphabet.indexOf(char);
    if (value < 0) return false;
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  if (bytes.length !== 35 || bytes[0] !== 48) return false;
  let crc = 0;
  for (const byte of bytes.slice(0, 33)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return bytes[33] === (crc & 0xff) && bytes[34] === ((crc >> 8) & 0xff);
}

type VaultStats = { sharePrice?: string; apy30d?: number };

async function fetchVaultStats(): Promise<VaultStats> {
  const response = await fetch(`${API}/api/v1/vault/stats`, { cache: "no-store" });
  if (!response.ok) throw new Error("Vault statistics are unavailable.");
  const envelope = (await response.json()) as { data?: VaultStats } & VaultStats;
  return envelope.data ?? envelope;
}

async function fetchBalance(address: string): Promise<string> {
  const response = await fetch(
    `${API}/api/vault/balance_of?address=${encodeURIComponent(address)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Position lookup failed");
  const envelope = (await response.json()) as { balance?: string | number; data?: { balance?: string | number } };
  const data = envelope.data ?? envelope;
  const balance = Number(data.balance);
  if (!Number.isFinite(balance) || balance < 0) throw new Error("Invalid position response");
  return String(data.balance ?? 0);
}

function downloadCsv(rows: ResultRow[]) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const body = [
    ["address", "shares", "estimated_value", "estimated_yield", "error"].join(","),
    ...rows.map((row) =>
      [row.address, formatTokens(row.shares), formatTokens(row.estimatedValue), formatTokens(row.estimatedYield), row.error ?? ""]
        .map(quote)
        .join(","),
    ),
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", body], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `aura-position-analysis-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PortfolioAnalyzer() {
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function analyze(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setRows([]);
    try {
      const addresses = parseAddressCsv(await file.text());
      if (addresses.length === 0) throw new Error("The CSV has no wallet addresses.");
      const stats = await fetchVaultStats();
      const priceScaled = BigInt(Math.round(Number(stats.sharePrice ?? "1") * Number(TOKEN_SCALE)));
      const output: ResultRow[] = addresses.map((address) => ({ address }));
      let next = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, addresses.length) }, async () => {
        while (next < addresses.length) {
          const index = next++;
          const address = addresses[index];
          if (!isValidAccountAddress(address)) {
            output[index] = { address, error: "Invalid Stellar public address" };
            continue;
          }
          try {
            const shares = await fetchBalance(address);
            const valueRaw = (BigInt(shares) * priceScaled) / TOKEN_SCALE;
            const yieldRaw = BigInt(Math.max(0, Math.round((stats.apy30d ?? 0) * 1_000_000))) * valueRaw / 1_000_000n;
            output[index] = {
              address,
              shares,
              estimatedValue: valueRaw.toString(),
              estimatedYield: yieldRaw.toString(),
            };
          } catch {
            output[index] = { address, error: "Could not load this position" };
          }
        }
      });
      await Promise.all(workers);
      setRows(output);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not parse this CSV.");
    } finally {
      setBusy(false);
    }
  }

  const validRows = rows.filter((row) => !row.error);
  const totalShares = validRows.reduce((sum, row) => sum + BigInt(row.shares ?? "0"), 0n);
  const totalValue = validRows.reduce((sum, row) => sum + BigInt(row.estimatedValue ?? "0"), 0n);
  const totalYield = validRows.reduce((sum, row) => sum + BigInt(row.estimatedYield ?? "0"), 0n);

  return (
    <section className="page-transition mx-auto w-full max-w-5xl p-4 sm:p-8" aria-labelledby="analyzer-title">
      <h1 id="analyzer-title" className="text-2xl font-bold">Portfolio analyser</h1>
      <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
        Upload a CSV with one Stellar public address per row. This read-only tool checks public positions without connecting a wallet. Value uses the current vault share price; yield is an annualized estimate from the latest 30-day APY, not a realized return.
      </p>
      <label className="mt-6 block rounded-xl border-2 border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
        <span className="block font-medium">Choose a CSV file</span>
        <input
          className="mt-3 block w-full text-sm"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void analyze(event.currentTarget.files?.[0])}
          aria-label="Upload wallet address CSV"
          disabled={busy}
        />
      </label>
      {busy && <p role="status" className="mt-4">Loading positions…</p>}
      {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
      {rows.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p aria-live="polite">{validRows.length} positions · {formatTokens(totalShares.toString())} shares · Estimated value {formatTokens(totalValue.toString())} · Estimated annual yield {formatTokens(totalYield.toString())}</p>
            <button type="button" onClick={() => downloadCsv(rows)} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900">
              Export results CSV
            </button>
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800"><tr><th className="p-3">Wallet</th><th className="p-3">Shares</th><th className="p-3">Estimated value</th><th className="p-3">Annual yield estimate</th><th className="p-3">Status</th></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.address} className="border-t border-zinc-200 dark:border-zinc-700"><td className="break-all p-3 font-mono text-xs">{row.address}</td><td className="p-3">{formatTokens(row.shares)}</td><td className="p-3">{formatTokens(row.estimatedValue)}</td><td className="p-3">{formatTokens(row.estimatedYield)}</td><td className={`p-3 ${row.error ? "text-red-700" : "text-emerald-700"}`}>{row.error ?? "Loaded"}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
