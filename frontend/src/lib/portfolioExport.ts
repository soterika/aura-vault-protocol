/**
 * Client-side portfolio export utilities for Aura Vault Protocol.
 *
 * Generates CSV and JSON files entirely in the browser — no server round-trip —
 * so the user's transaction data never leaves their device.
 *
 * ## CSV schema
 * date, type, amount, shares, tx_hash, price_at_time
 *
 * ## JSON schema (documented below in `PortfolioExportSchema`)
 *
 * ## File naming
 * aura-portfolio-{address}-{YYYY-MM-DD}.csv
 * aura-portfolio-{address}-{YYYY-MM-DD}.json
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExportFormat = "csv" | "json";

/** A single transaction row for export. */
export interface ExportTransaction {
  date: string;           // ISO-8601, e.g. "2024-03-15T10:22:00Z"
  type: "deposit" | "withdraw" | "harvest";
  amount: string;         // decimal string, e.g. "500.00"
  shares: string;         // decimal string (shares minted/burned)
  txHash: string;         // Stellar transaction hash
  priceAtTime: string;    // underlying token price in USD at the time of the tx
}

/** Current vault position snapshot for the export. */
export interface PortfolioPosition {
  shares: string;
  underlyingBalance: string;
  pricePerShare: string;
  apy: string;
  yieldEarned: string;
}

/** Root payload for the JSON export. */
export interface PortfolioExportSchema {
  /** Schema version — bump on breaking changes */
  schemaVersion: "1.0";
  exportedAt: string;       // ISO-8601
  walletAddress: string;
  network: "mainnet" | "testnet" | string;
  position: PortfolioPosition;
  transactions: ExportTransaction[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return today's date as YYYY-MM-DD in local time. */
function todayString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Truncate a Stellar address for use in a filename.
 * E.g. "GABC...XYZ" → "GABC_XYZ"
 */
function addressSlug(address: string): string {
  if (!address || address.length < 8) return address || "unknown";
  return `${address.slice(0, 4)}_${address.slice(-4)}`;
}

/** Escape a CSV field — wraps in quotes if it contains comma, quote, or newline. */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Trigger a file download from a Blob in the browser. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Release the object URL after a short delay so the download has time to start
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── CSV export ────────────────────────────────────────────────────────────────

const CSV_HEADER = ["date", "type", "amount", "shares", "tx_hash", "price_at_time"] as const;

/**
 * Build a CSV string from the given transactions.
 * Includes a UTF-8 BOM so Excel opens it correctly.
 */
export function buildCsv(transactions: ExportTransaction[]): string {
  const headerRow = CSV_HEADER.join(",");
  const rows = transactions.map((tx) =>
    [
      csvEscape(tx.date),
      csvEscape(tx.type),
      csvEscape(tx.amount),
      csvEscape(tx.shares),
      csvEscape(tx.txHash),
      csvEscape(tx.priceAtTime),
    ].join(",")
  );
  // UTF-8 BOM (\uFEFF) ensures proper encoding when opened in Excel
  return "\uFEFF" + [headerRow, ...rows].join("\r\n");
}

/**
 * Download the portfolio as a CSV file.
 *
 * @param transactions  Array of transactions to include
 * @param address       Wallet address — used in the filename
 */
export function exportPortfolioCsv(
  transactions: ExportTransaction[],
  address: string
): void {
  const csv = buildCsv(transactions);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const filename = `aura-portfolio-${addressSlug(address)}-${todayString()}.csv`;
  downloadBlob(blob, filename);
}

// ── JSON export ───────────────────────────────────────────────────────────────

/**
 * Build the JSON export payload.
 *
 * @param params  Export parameters
 */
export function buildJsonExport(params: {
  walletAddress: string;
  network?: string;
  position: PortfolioPosition;
  transactions: ExportTransaction[];
}): PortfolioExportSchema {
  return {
    schemaVersion: "1.0",
    exportedAt: new Date().toISOString(),
    walletAddress: params.walletAddress,
    network: params.network ?? "mainnet",
    position: params.position,
    transactions: params.transactions,
  };
}

/**
 * Download the portfolio as a JSON file.
 *
 * @param params  Same parameters as `buildJsonExport`
 */
export function exportPortfolioJson(params: {
  walletAddress: string;
  network?: string;
  position: PortfolioPosition;
  transactions: ExportTransaction[];
}): void {
  const payload = buildJsonExport(params);
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
  const filename = `aura-portfolio-${addressSlug(params.walletAddress)}-${todayString()}.json`;
  downloadBlob(blob, filename);
}

// ── Unified export entry-point ─────────────────────────────────────────────

/**
 * Export the portfolio in the requested format.
 * This is the single entry-point called by the UI export button.
 */
export function exportPortfolio(
  format: ExportFormat,
  params: {
    walletAddress: string;
    network?: string;
    position: PortfolioPosition;
    transactions: ExportTransaction[];
  }
): void {
  if (format === "csv") {
    exportPortfolioCsv(params.transactions, params.walletAddress);
  } else {
    exportPortfolioJson(params);
  }
}
