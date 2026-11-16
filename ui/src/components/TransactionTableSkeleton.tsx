/**
 * TransactionTableSkeleton
 *
 * Shimmer skeleton that mirrors the TransactionTable's visual layout
 * (toolbar row + 5-column table body) so the page doesn't jump when
 * real data arrives.
 */
import { useId } from "react";

interface Props {
  rows?: number;
}

export function TransactionTableSkeleton({ rows = 10 }: Props) {
  const id = useId();

  return (
    <div
      role="status"
      aria-label="Loading transaction history"
      aria-busy="true"
      className="tx-table-skeleton"
    >
      <span className="sr-only">Loading transaction history…</span>

      {/* Toolbar: filter dropdown + page-size selector */}
      <div className="tx-table-skeleton__toolbar">
        <div className="skeleton-row skeleton-row--input" style={{ width: "10rem" }} />
        <div className="skeleton-row skeleton-row--input" style={{ width: "7rem" }} />
      </div>

      {/* Table header */}
      <div className="tx-table-skeleton__head" aria-hidden="true">
        {["Date", "Type", "Amount", "Shares", "Tx Hash"].map((col) => (
          <div key={col} className="skeleton-row skeleton-row--sm" />
        ))}
      </div>

      {/* Table rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={`${id}-r-${r}`} className="tx-table-skeleton__row">
          <div className="skeleton-row" style={{ width: "9rem" }} />
          <div className="skeleton-row" style={{ width: "5rem" }} />
          <div className="skeleton-row" style={{ width: "7rem" }} />
          <div className="skeleton-row" style={{ width: "6rem" }} />
          {/* Tx hash — monospace, wider */}
          <div className="skeleton-row" style={{ width: "12rem" }} />
        </div>
      ))}

      {/* Pagination controls */}
      <div className="tx-table-skeleton__pagination">
        <div className="skeleton-row skeleton-row--sm" style={{ width: "8rem" }} />
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="skeleton-row"
              style={{ width: "2rem", height: "2rem", borderRadius: "var(--radius)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
