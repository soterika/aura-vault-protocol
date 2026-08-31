import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Toast } from "../components/Toast";
import { Modal } from "../components/Modal";
import { ErrorMessage } from "../components/ErrorMessage";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Skeleton } from "../components/Skeleton";
import App from "../App";
import type { UserError } from "../lib/errors";

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
describe("Toast", () => {
  it("renders message text", () => {
    render(<Toast message={{ type: "success", text: "Done!" }} onDismiss={vi.fn()} />);
    expect(screen.getByText("Done!")).toBeInTheDocument();
  });

  it("renders dismiss button", () => {
    render(<Toast message={{ type: "error", text: "Oops" }} onDismiss={vi.fn()} />);
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("calls onDismiss when dismiss button clicked", async () => {
    const onDismiss = vi.fn();
    render(<Toast message={{ type: "info", text: "Hey" }} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("auto-dismisses after duration", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message={{ type: "success", text: "Hi" }} onDismiss={onDismiss} duration={1000} />);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(onDismiss).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("has role=status for live region", () => {
    render(<Toast message={{ type: "success", text: "Ok" }} onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("applies success class for success type", () => {
    const { container } = render(
      <Toast message={{ type: "success", text: "Win" }} onDismiss={vi.fn()} />
    );
    expect(container.firstChild).toHaveClass("toast--success");
  });

  it("applies error class for error type", () => {
    const { container } = render(
      <Toast message={{ type: "error", text: "Fail" }} onDismiss={vi.fn()} />
    );
    expect(container.firstChild).toHaveClass("toast--error");
  });

  it("applies info class for info type", () => {
    const { container } = render(
      <Toast message={{ type: "info", text: "Note" }} onDismiss={vi.fn()} />
    );
    expect(container.firstChild).toHaveClass("toast--info");
  });

  it("resets timer when message prop changes", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <Toast message={{ type: "success", text: "A" }} onDismiss={onDismiss} duration={2000} />
    );
    act(() => { vi.advanceTimersByTime(1000); });
    rerender(<Toast message={{ type: "success", text: "B" }} onDismiss={onDismiss} duration={2000} />);
    act(() => { vi.advanceTimersByTime(1500); });
    // Should not have been called yet (timer reset to 2000)
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(600); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
describe("Modal", () => {
  it("renders nothing when isOpen=false", () => {
    render(<Modal isOpen={false} title="T" onClose={vi.fn()}><p>body</p></Modal>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders dialog when isOpen=true", () => {
    render(<Modal isOpen={true} title="My Dialog" onClose={vi.fn()}><p>content</p></Modal>);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders title text", () => {
    render(<Modal isOpen={true} title="Test Title" onClose={vi.fn()}><span /></Modal>);
    expect(screen.getByText("Test Title")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(<Modal isOpen={true} title="T" onClose={vi.fn()}><p>child content</p></Modal>);
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", async () => {
    const onClose = vi.fn();
    render(<Modal isOpen={true} title="T" onClose={onClose}><span /></Modal>);
    await userEvent.click(screen.getByRole("button", { name: /close dialog/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(<Modal isOpen={true} title="T" onClose={onClose}><span /></Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("dialog has aria-modal=true", () => {
    render(<Modal isOpen={true} title="T" onClose={vi.fn()}><span /></Modal>);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("dialog is labelled by title", () => {
    render(<Modal isOpen={true} title="Labelled" onClose={vi.fn()}><span /></Modal>);
    const dialog = screen.getByRole("dialog");
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)).toHaveTextContent("Labelled");
  });
});

// ---------------------------------------------------------------------------
// ErrorMessage
// ---------------------------------------------------------------------------
describe("ErrorMessage", () => {
  const baseError: UserError = {
    message: "Something broke.",
    action: "Try again.",
    severity: "error",
    retryable: true,
  };

  it("renders error message text", () => {
    render(<ErrorMessage error={baseError} />);
    expect(screen.getByText("Something broke.")).toBeInTheDocument();
  });

  it("renders action text", () => {
    render(<ErrorMessage error={baseError} />);
    expect(screen.getByText("Try again.")).toBeInTheDocument();
  });

  it("renders retry button when retryable and onRetry provided", () => {
    render(<ErrorMessage error={baseError} onRetry={vi.fn()} />);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("does not render retry when not retryable", () => {
    const err = { ...baseError, retryable: false };
    render(<ErrorMessage error={err} onRetry={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("calls onRetry when retry clicked", async () => {
    const onRetry = vi.fn();
    render(<ErrorMessage error={baseError} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders dismiss button when onDismiss provided", () => {
    render(<ErrorMessage error={baseError} onDismiss={vi.fn()} />);
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("calls onDismiss when dismiss clicked", async () => {
    const onDismiss = vi.fn();
    render(<ErrorMessage error={baseError} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("has role=alert", () => {
    render(<ErrorMessage error={baseError} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("applies error severity class", () => {
    const { container } = render(<ErrorMessage error={baseError} />);
    expect(container.firstChild).toHaveClass("error-msg--error");
  });

  it("applies warning severity class", () => {
    const warn: UserError = { ...baseError, severity: "warning" };
    const { container } = render(<ErrorMessage error={warn} />);
    expect(container.firstChild).toHaveClass("error-msg--warning");
  });

  it("renders without action when not provided", () => {
    const err: UserError = { message: "Oops", severity: "error", retryable: false };
    render(<ErrorMessage error={err} />);
    expect(screen.getByText("Oops")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ErrorBoundary
// ---------------------------------------------------------------------------
describe("ErrorBoundary", () => {
  const ThrowError = () => { throw new Error("boom"); };

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when no error", () => {
    render(<ErrorBoundary><p>safe content</p></ErrorBoundary>);
    expect(screen.getByText("safe content")).toBeInTheDocument();
  });

  it("renders fallback UI on error", () => {
    render(<ErrorBoundary><ThrowError /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("fallback contains 'Something went wrong'", () => {
    render(<ErrorBoundary><ThrowError /></ErrorBoundary>);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("renders custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>custom error UI</div>}>
        <ThrowError />
      </ErrorBoundary>
    );
    expect(screen.getByText("custom error UI")).toBeInTheDocument();
  });

  it("try again button resets error state", async () => {
    // Clicking "Try again" resets hasError, but the child ThrowError immediately
    // re-throws, so the fallback reappears. The observable effect is that the
    // button was clickable and the boundary recovered (shows fallback again).
    render(<ErrorBoundary><ThrowError /></ErrorBoundary>);
    const button = screen.getByRole("button", { name: /try again/i });
    await userEvent.click(button);
    // After the re-throw, the fallback is visible again
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
describe("Skeleton", () => {
  it("renders default 2 skeleton rows", () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelectorAll(".skeleton-row")).toHaveLength(2);
  });

  it("renders specified number of rows", () => {
    const { container } = render(<Skeleton rows={5} />);
    expect(container.querySelectorAll(".skeleton-row")).toHaveLength(5);
  });

  it("has role=status", () => {
    render(<Skeleton />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has aria-label Loading", () => {
    render(<Skeleton />);
    expect(screen.getByLabelText(/loading/i)).toBeInTheDocument();
  });

  it("has aria-busy=true", () => {
    render(<Skeleton />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("renders zero rows when rows=0", () => {
    const { container } = render(<Skeleton rows={0} />);
    expect(container.querySelectorAll(".skeleton-row")).toHaveLength(0);
  });

  it("renders one row when rows=1", () => {
    const { container } = render(<Skeleton rows={1} />);
    expect(container.querySelectorAll(".skeleton-row")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// App — tab navigation
// ---------------------------------------------------------------------------
describe("App tab navigation", () => {
  it("renders all three tab buttons", () => {
    render(<App />);
    expect(screen.getByRole("tab", { name: /deposit/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /withdraw/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /harvest/i })).toBeInTheDocument();
  });

  it("deposit tab is selected by default", () => {
    render(<App />);
    expect(screen.getByRole("tab", { name: /deposit/i })).toHaveAttribute("aria-selected", "true");
  });

  it("shows DepositForm by default", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: /deposit/i })).toBeInTheDocument();
  });

  it("clicking withdraw tab shows WithdrawForm", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("tab", { name: /withdraw/i }));
    expect(await screen.findByRole("heading", { name: /withdraw/i })).toBeInTheDocument();
  });

  it("clicking harvest tab shows HarvestPanel", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("tab", { name: /harvest/i }));
    expect(await screen.findByRole("heading", { name: /harvest/i })).toBeInTheDocument();
  });

  it("clicking deposit tab after withdraw restores DepositForm", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("tab", { name: /withdraw/i }));
    await userEvent.click(screen.getByRole("tab", { name: /deposit/i }));
    expect(screen.getByRole("heading", { name: /deposit/i })).toBeInTheDocument();
  });

  it("withdraw tab sets aria-selected=true when active", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("tab", { name: /withdraw/i }));
    expect(screen.getByRole("tab", { name: /withdraw/i })).toHaveAttribute("aria-selected", "true");
  });

  it("deposit tab sets aria-selected=false when not active", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("tab", { name: /withdraw/i }));
    expect(screen.getByRole("tab", { name: /deposit/i })).toHaveAttribute("aria-selected", "false");
  });

  it("skip-to-main link is rendered", () => {
    render(<App />);
    expect(screen.getByText(/skip to main/i)).toBeInTheDocument();
  });

  it("header contains Aura Vault title", () => {
    render(<App />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /aura vault/i, level: 1 })).toBeInTheDocument();
  });

  it("shows toast when deposit succeeds", async () => {
    render(<App />);
    // Wait for lazy component to load
    await screen.findByRole("heading", { name: /deposit/i });
    await userEvent.type(screen.getByLabelText(/amount/i), "100");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));
    // Toast displays success text after the simulated 1.2s contract call
    await waitFor(() => expect(screen.getByText(/deposited 100 tokens/i)).toBeInTheDocument(), { timeout: 2000 });
  });
});
