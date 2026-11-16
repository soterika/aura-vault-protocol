/**
 * Transaction history types and API pagination contracts.
 * Mirrors the shape of the vault's on-chain event log.
 */

// ── Transaction domain types ─────────────────────────────────────────────────

/** The three mutating vault operations that produce on-chain events. */
export type TransactionType = "Deposit" | "Withdraw" | "Harvest";

/** A single vault transaction record returned by the indexer/backend. */
export interface Transaction {
  /** ISO-8601 UTC timestamp e.g. "2026-09-25T09:34:12.405Z" */
  timestamp: string;
  /** On-chain event type */
  type: TransactionType;
  /** Token amount (underlying) — stored as a decimal string to preserve precision */
  amount: string;
  /** Vault share amount — stored as a decimal string; "—" for Harvest */
  shares: string;
  /** Full Stellar transaction hash, 64 hex chars */
  txHash: string;
}

// ── Sort / filter state ──────────────────────────────────────────────────────

export type SortDirection = "asc" | "desc";

/** Only the Date column is sortable per the spec. */
export type SortColumn = "timestamp";

/** "all" is a sentinel meaning no type filter is active. */
export type TypeFilter = TransactionType | "all";

// ── Pagination ───────────────────────────────────────────────────────────────

export type PageSize = 10 | 25 | 50;

export interface PaginationParams {
  /** 1-indexed current page */
  page: number;
  pageSize: PageSize;
  sortDirection: SortDirection;
  typeFilter: TypeFilter;
}

/** Paginated API response envelope */
export interface TransactionPage {
  items: Transaction[];
  /** Total number of matching records across all pages */
  total: number;
  page: number;
  pageSize: PageSize;
}

// ── Fetch state ──────────────────────────────────────────────────────────────

export type FetchStatus = "idle" | "loading" | "success" | "error";

export interface TransactionFetchState {
  status: FetchStatus;
  data: TransactionPage | null;
  error: string | null;
}
