import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DepositForm } from "../components/DepositForm";
import { WithdrawForm } from "../components/WithdrawForm";
import { HarvestPanel } from "../components/HarvestPanel";

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------
// DepositForm and WithdrawForm use useUserPosition (an SWR hook) internally.
// Wrapping in SWRConfig with an isolated provider prevents the real fetcher
// from running and avoids cross-test cache contamination.
// walletAddress={null} causes useUserPosition to skip fetching entirely
// (null key is the SWR no-op convention), keeping tests fast and synchronous.
// ---------------------------------------------------------------------------

function renderDeposit(onToast: ReturnType<typeof vi.fn>) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <DepositForm onToast={onToast} walletAddress={null} />
    </SWRConfig>
  );
}

function renderWithdraw(onToast: ReturnType<typeof vi.fn>) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <WithdrawForm onToast={onToast} walletAddress={null} />
    </SWRConfig>
  );
}

// ---------------------------------------------------------------------------
// DepositForm
// ---------------------------------------------------------------------------
describe("DepositForm", () => {
  let onToast: ReturnType<typeof vi.fn>;
  beforeEach(() => { onToast = vi.fn(); });
  afterEach(() => { vi.useRealTimers(); });

  it("renders amount input and submit button", () => {
    renderDeposit(onToast);
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deposit/i })).toBeInTheDocument();
  });

  it("shows field error when submitted empty", async () => {
    renderDeposit(onToast);
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for zero amount", async () => {
    renderDeposit(onToast);
    await userEvent.type(screen.getByLabelText(/amount/i), "0");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for negative amount", async () => {
    renderDeposit(onToast);
    await userEvent.type(screen.getByLabelText(/amount/i), "-5");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for non-numeric input", async () => {
    renderDeposit(onToast);
    await userEvent.type(screen.getByLabelText(/amount/i), "abc");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("does not show field error for valid positive amount", async () => {
    renderDeposit(onToast);
    await userEvent.type(screen.getByLabelText(/amount/i), "100");
    // No submit — no alert yet
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows skeleton while loading on submit", async () => {
    renderDeposit(onToast);
    await userEvent.type(screen.getByLabelText(/amount/i), "100");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    expect(await screen.findByRole("status", { name: /loading/i })).toBeInTheDocument();
  });

  it("calls onToast with success after valid submission", async () => {
    render(<DepositForm onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/amount/i), "500");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" })
    ), { timeout: 2000 });
  });

  it("clears amount after successful submission", async () => {
    render(<DepositForm onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/amount/i), "100");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    // Wait for loading skeleton to disappear and form to re-appear
    await waitFor(() => expect(screen.queryByRole("status", { name: /loading/i })).toBeNull(), { timeout: 2000 });
    expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe("");
  });

  it("input has aria-invalid true when field error shown", async () => {
    renderDeposit(onToast);
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText(/amount/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("input has no aria-invalid before submission", () => {
    renderDeposit(onToast);
    expect(screen.getByLabelText(/amount/i)).toHaveAttribute("aria-invalid", "false");
  });

  it("amount input has placeholder 0.00", () => {
    renderDeposit(onToast);
    expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument();
  });

  it("form has heading Deposit", () => {
    renderDeposit(onToast);
    expect(screen.getByRole("heading", { name: /deposit/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// WithdrawForm
// ---------------------------------------------------------------------------
describe("WithdrawForm", () => {
  let onToast: ReturnType<typeof vi.fn>;
  beforeEach(() => { onToast = vi.fn(); });
  afterEach(() => { vi.useRealTimers(); });

  it("renders shares input and submit button", () => {
    renderWithdraw(onToast);
    expect(screen.getByLabelText(/shares/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeInTheDocument();
  });

  it("shows field error when submitted empty", async () => {
    renderWithdraw(onToast);
    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for zero shares", async () => {
    renderWithdraw(onToast);
    await userEvent.type(screen.getByLabelText(/shares/i), "0");
    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for negative shares", async () => {
    renderWithdraw(onToast);
    await userEvent.type(screen.getByLabelText(/shares/i), "-1");
    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for non-numeric input", async () => {
    renderWithdraw(onToast);
    await userEvent.type(screen.getByLabelText(/shares/i), "xyz");
    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("calls onToast with success on valid submit", async () => {
    render(<WithdrawForm onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/shares/i), "50");
    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" })
    ), { timeout: 2000 });
  });

  it("shows skeleton while loading", async () => {
    renderWithdraw(onToast);
    await userEvent.type(screen.getByLabelText(/shares/i), "50");
    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(await screen.findByRole("status", { name: /loading/i })).toBeInTheDocument();
  });

  it("form heading is Withdraw", () => {
    renderWithdraw(onToast);
    expect(screen.getByRole("heading", { name: /withdraw/i })).toBeInTheDocument();
  });

  it("input has placeholder 0.00", () => {
    renderWithdraw(onToast);
    expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// HarvestPanel
// ---------------------------------------------------------------------------
describe("HarvestPanel", () => {
  let onToast: ReturnType<typeof vi.fn>;
  beforeEach(() => { onToast = vi.fn(); });
  afterEach(() => { vi.useRealTimers(); });

  it("renders yield amount input and submit button", () => {
    render(<HarvestPanel onToast={onToast} />);
    expect(screen.getByLabelText(/yield amount/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /harvest/i })).toBeInTheDocument();
  });

  it("shows field error when submitted empty", async () => {
    render(<HarvestPanel onToast={onToast} />);
    await userEvent.click(screen.getByRole("button", { name: /harvest/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for zero yield", async () => {
    render(<HarvestPanel onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/yield amount/i), "0");
    await userEvent.click(screen.getByRole("button", { name: /harvest/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for negative yield", async () => {
    render(<HarvestPanel onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/yield amount/i), "-100");
    await userEvent.click(screen.getByRole("button", { name: /harvest/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("calls onToast with success on valid submit", async () => {
    render(<HarvestPanel onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/yield amount/i), "200");
    await userEvent.click(screen.getByRole("button", { name: /harvest/i }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" })
    ), { timeout: 2000 });
  });

  it("shows informational description text", () => {
    render(<HarvestPanel onToast={onToast} />);
    expect(screen.getByText(/inject yield/i)).toBeInTheDocument();
  });

  it("form heading is Harvest", () => {
    render(<HarvestPanel onToast={onToast} />);
    expect(screen.getByRole("heading", { name: /harvest/i })).toBeInTheDocument();
  });

  it("shows skeleton while loading", async () => {
    render(<HarvestPanel onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/yield amount/i), "100");
    await userEvent.click(screen.getByRole("button", { name: /harvest/i }));
    expect(await screen.findByRole("status", { name: /loading/i })).toBeInTheDocument();
  });
});
