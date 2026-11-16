/**
 * TransactionTable
 *
 * Reusable transaction-history table with:
 *   - 5 columns: Date, Type, Amount, Shares, Tx Hash
 *   - Sort by Date (asc/desc) via column header button
 *   - Filter by transaction type via dropdown
 *   - Server-side pagination with 10 / 25 / 50 rows-per-page selector
 *   - Tx hash links to Stellar Expert explorer
 *   - Loading skeleton while fetching
 *   - Empty state illustration when no records match
 *   - Accessible: roles, aria-sort, aria-live, focus management
 *
 * Props
 * ─────
 *   fetchPage  — async function called whenever query params change.
 *                Signature: (params: PaginationParams) => Promise<TransactionPage>
 */
import { useId, useCallback } from "react";
import type { FetchFn } from "../lib/useTransactionHistory";
import { useTransactionHistory } from "../lib/useTransactionHistory";
import type { TypeFilter, PageSize, Transaction } from "../lib/transactions";
import { TransactionTableSkeleton } from "./TransactionTableSkeleton";
import { TransactionEmptyState } from "./TransactionEmptyState";

// ── Stellar Expert explorer base URL ────────────────────────────────────────
const STELLAR_EXPLORER = "https://stellar.expert/explorer/public/tx";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function abbreviateTxHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-6)}`;
}

const TYPE_LABELS: Record<Transaction["type"], string> = {
  Deposit: "Deposit",
  Withdraw: "Withdraw",
  Harvest: "Harvest",
};

const TYPE_CSS: Record<Transaction["type"], string> = {
  Deposit: "tx-badge tx-badge--deposit",
  Withdraw: "tx-badge tx-badge--withdraw",
  Harvest: "tx-badge tx-badge--harvest",
};

const PAGE_SIZE_OPTIONS: PageSize[] = [10, 25, 50];

const TYPE_FILTER_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "Deposit", label: "Deposit" },
  { value: "Withdraw", label: "Withdraw" },
  { value: "Harvest", label: "Harvest" },
];

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  fetchPage: FetchFn;
  /** Optional wallet address label shown above the table */
  walletLabel?: string;
}

export function TransactionTable({ fetchPage, walletLabel }: Props) {
  const id = useId();

  const {
    state,
    params,
    totalPages,
    goToPage,
    setPageSize,
    setSortDirection,
    setTypeFilter,
    retry,
  } = useTransactionHistory(fetchPage);

  // Clearing the filter is a common action from the empty state
  const handleClearFilter = useCallback(() => {
    setTypeFilter("all");
  }, [setTypeFilter]);

  // Toggle sort direction (we only support sorting by Date)
  const handleSortToggle = useCallback(() => {
    setSortDirection(params.sortDirection === "desc" ? "asc" : "desc");
  }, [params.sortDirection, setSortDirection]);

  const isLoading = state.status === "loading" || state.status === "idle";
  const isError = state.status === "error";
  const items = state.data?.items ?? [];
  const total = state.data?.total ?? 0;

  // ── Pagination window ────────────────────────────────────────────────────
  // Show up to 5 page buttons centred around the current page
  function buildPageWindow(): number[] {
    const window = 5;
    const half = Math.floor(window / 2);
    let start = Math.max(1, params.page - half);
    const end = Math.min(totalPages, start + window - 1);
    start = Math.max(1, end - window + 1);
    const pages: number[] = [];
    for (let p = start; p <= end; p++) pages.push(p);
    return pages;
  }

  // ── First / last row index for "Showing X–Y of Z" ────────────────────────
  const firstRow = total === 0 ? 0 : (params.page - 1) * params.pageSize + 1;
  const lastRow = Math.min(params.page * params.pageSize, total);

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="tx-table-section"
    >
      {/* ── Section title ──────────────────────────────────────────────────── */}
      <div className="tx-table-header">
        <h2 id={`${id}-title`} className="tx-table-title">
          Transaction History
        </h2>
        {walletLabel && (
          <span className="tx-table-wallet">{walletLabel}</span>
        )}
      </div>

      {/* ── Loading state ─────────────────────────────────────────────────── */}
      {isLoading && (
        <TransactionTableSkeleton rows={params.pageSize <= 10 ? 10 : params.pageSize} />
      )}

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {isError && (
        <div role="alert" className="tx-table-error">
          <p className="tx-table-error__msg">
            {state.error ?? "Failed to load transaction history."}
          </p>
          <button type="button" className="btn--ghost" onClick={retry}>
            Try again
          </button>
        </div>
      )}

      {/* ── Loaded state ──────────────────────────────────────────────────── */}
      {!isLoading && !isError && (
        <>
          {/* Toolbar */}
          <div className="tx-toolbar" role="group" aria-label="Filter and page size">
            {/* Type filter */}
            <div className="tx-toolbar__field">
              <label htmlFor={`${id}-filter`} className="tx-toolbar__label">
                Filter by type
              </label>
              <select
                id={`${id}-filter`}
                value={params.typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                className="input tx-toolbar__select"
                aria-label="Filter transactions by type"
              >
                {TYPE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Rows per page */}
            <div className="tx-toolbar__field">
              <label htmlFor={`${id}-pagesize`} className="tx-toolbar__label">
                Rows per page
              </label>
              <select
                id={`${id}-pagesize`}
                value={params.pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
                className="input tx-toolbar__select"
                aria-label="Rows per page"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Empty state */}
          {items.length === 0 && (
            <TransactionEmptyState
              typeFilter={params.typeFilter}
              onClearFilter={handleClearFilter}
            />
          )}

          {/* Table */}
          {items.length > 0 && (
            <>
              {/* aria-live wrapper so screen readers announce row count changes */}
              <div aria-live="polite" aria-atomic="true" className="sr-only">
                Showing {firstRow} to {lastRow} of {total} transactions
              </div>

              <div className="tx-table-wrapper" tabIndex={0} role="region" aria-label="Transaction history table">
                <table className="tx-table" aria-label="Transaction history">
                  <thead>
                    <tr>
                      {/* Date — sortable */}
                      <th
                        scope="col"
                        aria-sort={
                          params.sortDirection === "asc" ? "ascending" : "descending"
                        }
                        className="tx-th tx-th--sortable"
                      >
                        <button
                          type="button"
                          className="tx-sort-btn"
                          onClick={handleSortToggle}
                          aria-label={`Sort by date ${params.sortDirection === "desc" ? "ascending" : "descending"}`}
                        >
                          Date
                          <span
                            className="tx-sort-icon"
                            aria-hidden="true"
                          >
                            {params.sortDirection === "desc" ? "↓" : "↑"}
                          </span>
                        </button>
                      </th>

                      <th scope="col" className="tx-th">Type</th>
                      <th scope="col" className="tx-th tx-th--right">Amount</th>
                      <th scope="col" className="tx-th tx-th--right">Shares</th>
                      <th scope="col" className="tx-th">Tx Hash</th>
                    </tr>
                  </thead>

                  <tbody>
                    {items.map((tx) => (
                      <tr key={tx.txHash} className="tx-row">
                        {/* Date */}
                        <td className="tx-td tx-td--date">
                          <time dateTime={tx.timestamp}>
                            {formatDate(tx.timestamp)}
                          </time>
                        </td>

                        {/* Type badge */}
                        <td className="tx-td">
                          <span className={TYPE_CSS[tx.type]}>
                            {TYPE_LABELS[tx.type]}
                          </span>
                        </td>

                        {/* Amount */}
                        <td className="tx-td tx-td--num">
                          {tx.amount}
                        </td>

                        {/* Shares — Harvest has no share delta */}
                        <td className="tx-td tx-td--num">
                          {tx.shares === "—" ? (
                            <span className="tx-td--muted" aria-label="Not applicable">—</span>
                          ) : (
                            tx.shares
                          )}
                        </td>

                        {/* Tx Hash — links to Stellar Expert */}
                        <td className="tx-td tx-td--hash">
                          <a
                            href={`${STELLAR_EXPLORER}/${tx.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tx-hash-link"
                            aria-label={`View transaction ${tx.txHash} on Stellar Expert`}
                            title={tx.txHash}
                          >
                            <code className="tx-hash-code">
                              {abbreviateTxHash(tx.txHash)}
                            </code>
                            {/* External link icon */}
                            <svg
                              viewBox="0 0 12 12"
                              className="tx-hash-icon"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <path
                                d="M2 2h8v8M10 2 5 7"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                fill="none"
                              />
                            </svg>
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ── Pagination footer ──────────────────────────────────────── */}
              <div className="tx-pagination" role="navigation" aria-label="Table pagination">
                {/* Summary */}
                <p className="tx-pagination__summary" aria-live="polite">
                  Showing{" "}
                  <strong>{firstRow}</strong>–<strong>{lastRow}</strong>
                  {" "}of <strong>{total}</strong>
                </p>

                {/* Page buttons */}
                <div className="tx-pagination__controls">
                  {/* Previous */}
                  <button
                    type="button"
                    className="tx-page-btn"
                    onClick={() => goToPage(params.page - 1)}
                    disabled={params.page <= 1}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>

                  {/* Page window */}
                  {buildPageWindow().map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`tx-page-btn${p === params.page ? " tx-page-btn--active" : ""}`}
                      onClick={() => goToPage(p)}
                      aria-label={`Page ${p}`}
                      aria-current={p === params.page ? "page" : undefined}
                    >
                      {p}
                    </button>
                  ))}

                  {/* Next */}
                  <button
                    type="button"
                    className="tx-page-btn"
                    onClick={() => goToPage(params.page + 1)}
                    disabled={params.page >= totalPages}
                    aria-label="Next page"
                  >
                    ›
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
