/**
 * Tests for:
 *   - TransactionTable (renders, filter, sort, pagination, loading, error, empty)
 *   - TransactionTableSkeleton (renders accessible loading state)
 *   - TransactionEmptyState (renders, clear-filter call)
 *   - useTransactionHistory (state transitions, goToPage, setPageSize, etc.)
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderHook, act } from "@testing-library/react";
import { TransactionTable } from "../components/TransactionTable";
import { TransactionTableSkeleton } from "../components/TransactionTableSkeleton";
import { TransactionEmptyState } from "../components/TransactionEmptyState";
import { useTransactionHistory } from "../lib/useTransactionHistory";
import type { Transaction, TransactionPage, PaginationParams } from "../lib/transactions";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_TX: Transaction[] = [
  {
    timestamp: "2026-09-25T09:00:00.000Z",
    type: "Deposit",
    amount: "1000.00",
    shares: "999.00",
    txHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  },
  {
    timestamp: "2026-09-24T08:00:00.000Z",
    type: "Withdraw",
    amount: "500.00",
    shares: "498.00",
    txHash: "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
  },
  {
    timestamp: "2026-09-23T07:00:00.000Z",
    type: "Harvest",
    amount: "50.00",
    shares: "—",
    txHash: "111111aaaaaa222222bbbbbb333333cccccc444444dddddd555555eeeeee6666",
  },
];

function makePage(
  items: Transaction[] = MOCK_TX,
  total = MOCK_TX.length
): TransactionPage {
  return { items, total, page: 1, pageSize: 10 };
}

function makeSuccessFetch(page?: TransactionPage) {
  return vi.fn().mockResolvedValue(page ?? makePage());
}

function makeErrorFetch(message = "Network error") {
  return vi.fn().mockRejectedValue(new Error(message));
}

// ── TransactionTableSkeleton ──────────────────────────────────────────────────

describe("TransactionTableSkeleton", () => {
  it("renders with accessible loading role and label", () => {
    render(<TransactionTableSkeleton />);
    expect(
      screen.getByRole("status", { name: /loading transaction history/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/loading transaction history…/i)).toBeInTheDocument();
  });

  it("renders custom number of rows", () => {
    const { container } = render(<TransactionTableSkeleton rows={3} />);
    // 3 skeleton rows + head row
    const rows = container.querySelectorAll(".tx-table-skeleton__row");
    expect(rows).toHaveLength(3);
  });
});

// ── TransactionEmptyState ─────────────────────────────────────────────────────

describe("TransactionEmptyState", () => {
  it("shows generic message when filter is 'all'", () => {
    render(
      <TransactionEmptyState typeFilter="all" onClearFilter={vi.fn()} />
    );
    expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /clear filter/i })).not.toBeInTheDocument();
  });

  it("shows filter-specific message when a type filter is active", () => {
    render(
      <TransactionEmptyState typeFilter="Deposit" onClearFilter={vi.fn()} />
    );
    expect(screen.getByText(/no matching transactions/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear filter/i })).toBeInTheDocument();
  });

  it("calls onClearFilter when Clear filter button is clicked", async () => {
    const onClear = vi.fn();
    render(<TransactionEmptyState typeFilter="Withdraw" onClearFilter={onClear} />);
    await userEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

// ── useTransactionHistory ─────────────────────────────────────────────────────

describe("useTransactionHistory", () => {
  it("starts in loading/idle and transitions to success", async () => {
    const fetchPage = makeSuccessFetch();
    const { result } = renderHook(() => useTransactionHistory(fetchPage));

    // Initially loading
    expect(["idle", "loading"]).toContain(result.current.state.status);

    await waitFor(() => {
      expect(result.current.state.status).toBe("success");
    });

    expect(result.current.state.data?.items).toHaveLength(3);
    expect(result.current.state.error).toBeNull();
  });

  it("transitions to error state on fetch failure", async () => {
    const fetchPage = makeErrorFetch("Connection refused");
    const { result } = renderHook(() => useTransactionHistory(fetchPage));

    await waitFor(() => {
      expect(result.current.state.status).toBe("error");
    });

    expect(result.current.state.error).toMatch(/connection refused/i);
  });

  it("re-fetches when goToPage is called", async () => {
    const fetchPage = makeSuccessFetch(
      makePage(MOCK_TX, 30) // total 30 with pageSize 10 → 3 pages
    );
    const { result } = renderHook(() => useTransactionHistory(fetchPage));

    await waitFor(() => expect(result.current.state.status).toBe("success"));

    act(() => {
      result.current.goToPage(2);
    });

    await waitFor(() => {
      expect(fetchPage).toHaveBeenCalledTimes(2);
    });
    expect(fetchPage.mock.calls[1][0].page).toBe(2);
  });

  it("resets to page 1 when setPageSize changes", async () => {
    // Use a fetch that returns enough total records to have page 2
    const fetchPage = vi.fn().mockResolvedValue(makePage(MOCK_TX, 30));
    const { result } = renderHook(() => useTransactionHistory(fetchPage));
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    // Go to page 2 — triggers fetch #2
    act(() => { result.current.goToPage(2); });
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));

    // Change page size — resets to page 1, triggers fetch #3
    act(() => { result.current.setPageSize(25); });
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(3));
    expect(fetchPage.mock.calls[2][0].page).toBe(1);
    expect(fetchPage.mock.calls[2][0].pageSize).toBe(25);
  });

  it("resets to page 1 when setTypeFilter changes", async () => {
    const fetchPage = makeSuccessFetch();
    const { result } = renderHook(() => useTransactionHistory(fetchPage));
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    act(() => { result.current.setTypeFilter("Deposit"); });
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(fetchPage.mock.calls[1][0].typeFilter).toBe("Deposit");
    expect(fetchPage.mock.calls[1][0].page).toBe(1);
  });

  it("retry bumps the fetch count", async () => {
    const fetchPage = makeSuccessFetch();
    const { result } = renderHook(() => useTransactionHistory(fetchPage));
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    act(() => { result.current.retry(); });
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
  });

  it("passes sortDirection to fetchPage", async () => {
    const fetchPage = makeSuccessFetch();
    const { result } = renderHook(() => useTransactionHistory(fetchPage));
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    act(() => { result.current.setSortDirection("asc"); });
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(fetchPage.mock.calls[1][0].sortDirection).toBe("asc");
  });
});

// ── TransactionTable ──────────────────────────────────────────────────────────

describe("TransactionTable", () => {
  it("renders loading skeleton while fetch is in progress", () => {
    // never resolves
    const fetchPage = vi.fn().mockImplementation((_p: PaginationParams) => new Promise(() => {}));
    render(<TransactionTable fetchPage={fetchPage} />);
    expect(
      screen.getByRole("status", { name: /loading transaction history/i })
    ).toBeInTheDocument();
  });

  it("renders all columns and rows after successful fetch", async () => {
    render(<TransactionTable fetchPage={makeSuccessFetch()} />);

    await waitFor(() =>
      expect(screen.queryByRole("status", { name: /loading/i })).not.toBeInTheDocument()
    );

    // Column headers
    expect(screen.getByRole("columnheader", { name: /date/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /type/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /amount/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /shares/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /tx hash/i })).toBeInTheDocument();

    // All 3 rows
    expect(screen.getAllByRole("row")).toHaveLength(4); // 1 header + 3 data
  });

  it("renders type badges for all transaction types", async () => {
    render(<TransactionTable fetchPage={makeSuccessFetch()} />);
    // Wait for the table to finish loading
    await waitFor(() => screen.getByRole("table"));

    // Badges are <span> elements with a tx-badge class inside <td> cells.
    // Use getAllByText so option-element duplicates don't cause a failure.
    expect(screen.getAllByText("Deposit").some((el) => el.tagName === "SPAN")).toBe(true);
    expect(screen.getAllByText("Withdraw").some((el) => el.tagName === "SPAN")).toBe(true);
    expect(screen.getAllByText("Harvest").some((el) => el.tagName === "SPAN")).toBe(true);
  });

  it("renders Tx Hash links pointing to Stellar Explorer", async () => {
    render(<TransactionTable fetchPage={makeSuccessFetch()} />);
    await waitFor(() => screen.getByRole("table"));

    const links = screen.getAllByRole("link");
    links.forEach((link) => {
      expect(link).toHaveAttribute(
        "href",
        expect.stringContaining("stellar.expert/explorer/public/tx/")
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  it("shows harvest row with em-dash for shares", async () => {
    render(<TransactionTable fetchPage={makeSuccessFetch()} />);
    await waitFor(() => screen.getByRole("table"));

    // The shares cell for Harvest contains "—"
    const dashCells = screen.getAllByLabelText(/not applicable/i);
    expect(dashCells.length).toBeGreaterThanOrEqual(1);
  });

  it("calls fetchPage with updated typeFilter when dropdown changes", async () => {
    const fetchPage = makeSuccessFetch();
    render(<TransactionTable fetchPage={fetchPage} />);
    await waitFor(() => screen.getByRole("table"));

    fireEvent.change(screen.getByRole("combobox", { name: /filter transactions by type/i }), {
      target: { value: "Deposit" },
    });

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(fetchPage.mock.calls[1][0].typeFilter).toBe("Deposit");
  });

  it("toggles sort direction when Date header button is clicked", async () => {
    const fetchPage = makeSuccessFetch();
    render(<TransactionTable fetchPage={fetchPage} />);
    await waitFor(() => screen.getByRole("table"));

    // Default is desc — click to flip to asc
    const sortBtn = screen.getByRole("button", { name: /sort by date ascending/i });
    fireEvent.click(sortBtn);

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(fetchPage.mock.calls[1][0].sortDirection).toBe("asc");
  });

  it("renders the empty state when no items are returned", async () => {
    const fetchPage = vi.fn().mockResolvedValue(makePage([], 0));
    render(<TransactionTable fetchPage={fetchPage} />);

    await waitFor(() =>
      expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument()
    );
  });

  it("renders error state and retry button on fetch failure", async () => {
    const fetchPage = makeErrorFetch("Service unavailable");
    render(<TransactionTable fetchPage={fetchPage} />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument()
    );
    expect(screen.getByText(/service unavailable/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retryBtn);
    // Retry triggers another fetch
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
  });

  it("renders pagination controls with correct aria-current", async () => {
    const fetchPage = vi.fn().mockResolvedValue(makePage(MOCK_TX, 30)); // 3 pages
    render(<TransactionTable fetchPage={fetchPage} />);
    await waitFor(() => screen.getByRole("table"));

    const page1Btn = screen.getByRole("button", { name: /page 1/i });
    expect(page1Btn).toHaveAttribute("aria-current", "page");
  });

  it("navigates to next page on › click", async () => {
    const fetchPage = vi.fn().mockResolvedValue(makePage(MOCK_TX, 30));
    render(<TransactionTable fetchPage={fetchPage} />);
    await waitFor(() => screen.getByRole("table"));

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(fetchPage.mock.calls[1][0].page).toBe(2);
  });

  it("changes page size and resets to page 1", async () => {
    const fetchPage = vi.fn().mockResolvedValue(makePage(MOCK_TX, 30));
    render(<TransactionTable fetchPage={fetchPage} />);
    await waitFor(() => screen.getByRole("table"));

    fireEvent.change(screen.getByRole("combobox", { name: /rows per page/i }), {
      target: { value: "25" },
    });

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    const lastCall = fetchPage.mock.calls[1][0];
    expect(lastCall.pageSize).toBe(25);
    expect(lastCall.page).toBe(1);
  });

  it("renders optional walletLabel", async () => {
    render(
      <TransactionTable
        fetchPage={makeSuccessFetch()}
        walletLabel="GABCDE…FGHIJ"
      />
    );
    await waitFor(() => screen.getByText("GABCDE…FGHIJ"));
    expect(screen.getByText("GABCDE…FGHIJ")).toBeInTheDocument();
  });

  it("has accessible table structure with aria-label", async () => {
    render(<TransactionTable fetchPage={makeSuccessFetch()} />);
    await waitFor(() => screen.getByRole("table"));

    expect(
      screen.getByRole("table", { name: /transaction history/i })
    ).toBeInTheDocument();
  });
});
