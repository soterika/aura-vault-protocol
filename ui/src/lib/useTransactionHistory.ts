/**
 * useTransactionHistory
 *
 * Handles server-side pagination, sorting, and filtering for the
 * transaction history table.  Keeps all query state in one place so
 * the UI can remain a thin presentation layer.
 *
 * The `fetchPage` dependency is caller-supplied so the hook stays
 * fully testable without mocking globals.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type {
  PaginationParams,
  PageSize,
  SortDirection,
  TypeFilter,
  TransactionPage,
  TransactionFetchState,
} from "./transactions";

export type FetchFn = (params: PaginationParams) => Promise<TransactionPage>;

export interface UseTransactionHistoryReturn {
  state: TransactionFetchState;
  params: PaginationParams;
  totalPages: number;
  /** Navigate to an explicit page number (1-indexed, clamped) */
  goToPage: (page: number) => void;
  setPageSize: (size: PageSize) => void;
  setSortDirection: (dir: SortDirection) => void;
  setTypeFilter: (filter: TypeFilter) => void;
  /** Manually re-run the current query (e.g. after an error) */
  retry: () => void;
}

export function useTransactionHistory(
  fetchPage: FetchFn
): UseTransactionHistoryReturn {
  const [params, setParams] = useState<PaginationParams>({
    page: 1,
    pageSize: 10,
    sortDirection: "desc",
    typeFilter: "all",
  });

  const [state, setState] = useState<TransactionFetchState>({
    status: "idle",
    data: null,
    error: null,
  });

  // Stable ref so the effect closure always calls the latest fetchPage
  // without adding it to the dependency array (avoids re-fetching when
  // the caller re-creates the function reference on every render).
  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  });

  // retryToken bumps to force a re-fetch with the same params
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setState((prev) => ({ ...prev, status: "loading", error: null }));

    fetchRef.current(params).then(
      (data) => {
        if (!cancelled) {
          setState({ status: "success", data, error: null });
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to load transaction history.";
          setState({ status: "error", data: null, error: message });
        }
      }
    );

    return () => {
      cancelled = true;
    };
    // retryToken intentionally included so `retry()` forces a re-fetch
  }, [params, retryToken]);

  const totalPages =
    state.data
      ? Math.max(1, Math.ceil(state.data.total / params.pageSize))
      : 1;

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, totalPages));
      setParams((prev) => (prev.page === clamped ? prev : { ...prev, page: clamped }));
    },
    [totalPages]
  );

  const setPageSize = useCallback((size: PageSize) => {
    setParams((prev) => ({ ...prev, pageSize: size, page: 1 }));
  }, []);

  const setSortDirection = useCallback((dir: SortDirection) => {
    setParams((prev) => ({ ...prev, sortDirection: dir, page: 1 }));
  }, []);

  const setTypeFilter = useCallback((filter: TypeFilter) => {
    setParams((prev) => ({ ...prev, typeFilter: filter, page: 1 }));
  }, []);

  const retry = useCallback(() => {
    setRetryToken((t) => t + 1);
  }, []);

  return {
    state,
    params,
    totalPages,
    goToPage,
    setPageSize,
    setSortDirection,
    setTypeFilter,
    retry,
  };
}
