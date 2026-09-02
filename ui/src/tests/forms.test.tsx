import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DepositForm } from "../components/DepositForm";
import { WithdrawForm } from "../components/WithdrawForm";
import { HarvestPanel } from "../components/HarvestPanel";

// ---------------------------------------------------------------------------
// DepositForm
// ---------------------------------------------------------------------------
describe("DepositForm", () => {
  let onToast: ReturnType<typeof vi.fn>;
  beforeEach(() => { onToast = vi.fn(); });
  afterEach(() => { vi.useRealTimers(); });

  it("renders amount input and submit button", () => {
    render(<DepositForm onToast={onToast} />);
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deposit/i })).toBeInTheDocument();
  });

  it("shows field error when submitted empty", async () => {
    render(<DepositForm onToast={onToast} />);
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for zero amount", async () => {
    render(<DepositForm onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/amount/i), "0");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for negative amount", async () => {
    render(<DepositForm onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/amount/i), "-5");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for non-numeric input", async () => {
    render(<DepositForm onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/amount/i), "abc");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("does not show field error for valid positive amount", async () => {
    render(<DepositForm onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/amount/i), "100");
    // No submit — no alert yet
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows skeleton while loading on submit", async () => {
    render(<DepositForm onToast={onToast} />);
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
    render(<DepositForm onToast={onToast} />);
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText(/amount/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("input has no aria-invalid before submission", () => {
    render(<DepositForm onToast={onToast} />);
    expect(screen.getByLabelText(/amount/i)).toHaveAttribute("aria-invalid", "false");
  });

  it("amount input has placeholder 0.00", () => {
    render(<DepositForm onToast={onToast} />);
    expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument();
  });

  it("form has heading Deposit", () => {
    render(<DepositForm onToast={onToast} />);
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
    render(<WithdrawForm onToast={onToast} />);
    expect(screen.getByLabelText(/shares/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /withdraw/i })).toBeInTheDocument();
  });

  it("shows field error when submitted empty", async () => {
    render(<WithdrawForm onToast={onToast} />);
    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for zero shares", async () => {
    render(<WithdrawForm onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/shares/i), "0");
    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for negative shares", async () => {
    render(<WithdrawForm onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/shares/i), "-1");
    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows field error for non-numeric input", async () => {
    render(<WithdrawForm onToast={onToast} />);
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
    render(<WithdrawForm onToast={onToast} />);
    await userEvent.type(screen.getByLabelText(/shares/i), "50");
    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(await screen.findByRole("status", { name: /loading/i })).toBeInTheDocument();
  });

  it("form heading is Withdraw", () => {
    render(<WithdrawForm onToast={onToast} />);
    expect(screen.getByRole("heading", { name: /withdraw/i })).toBeInTheDocument();
  });

  it("input has placeholder 0.00", () => {
    render(<WithdrawForm onToast={onToast} />);
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
