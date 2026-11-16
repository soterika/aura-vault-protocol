/**
 * Accessibility Tests — Issue #63 WCAG 2.1 AA
 * Covers: axe violations, keyboard navigation, ARIA labels, focus management,
 *         screen reader announcements, form error announcements.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { expect, describe, it, vi } from "vitest";
import { DepositForm } from "../components/DepositForm";
import { WithdrawForm } from "../components/WithdrawForm";
import { HarvestPanel } from "../components/HarvestPanel";
import { Toast } from "../components/Toast";
import { Modal } from "../components/Modal";
import { LiveRegion } from "../components/LiveRegion";

expect.extend(toHaveNoViolations);

const noop = vi.fn();

// ---------------------------------------------------------------------------
// axe: no WCAG 2.1 AA violations
// ---------------------------------------------------------------------------

describe("axe — no violations", () => {
  it("DepositForm", async () => {
    const { container } = render(<DepositForm onToast={noop} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("WithdrawForm", async () => {
    const { container } = render(<WithdrawForm onToast={noop} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("HarvestPanel", async () => {
    const { container } = render(<HarvestPanel onToast={noop} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Toast success", async () => {
    const { container } = render(
      <Toast message={{ type: "success", text: "Done" }} onDismiss={noop} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Toast error", async () => {
    const { container } = render(
      <Toast message={{ type: "error", text: "Failed" }} onDismiss={noop} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Modal open", async () => {
    render(
      <Modal isOpen={true} title="Confirm withdrawal" onClose={noop}>
        <p>Are you sure?</p>
      </Modal>
    );
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// ARIA labels and roles
// ---------------------------------------------------------------------------

describe("ARIA attributes", () => {
  it("DepositForm input has aria-required", () => {
    render(<DepositForm onToast={noop} />);
    expect(screen.getByRole("spinbutton")).toHaveAttribute("aria-required", "true");
  });

  it("DepositForm input starts without aria-invalid", () => {
    render(<DepositForm onToast={noop} />);
    expect(screen.getByRole("spinbutton")).toHaveAttribute("aria-invalid", "false");
  });

  it("WithdrawForm input has aria-required", () => {
    render(<WithdrawForm onToast={noop} />);
    expect(screen.getByRole("spinbutton")).toHaveAttribute("aria-required", "true");
  });

  it("Toast has role=status for polite announcement", () => {
    render(<Toast message={{ type: "success", text: "ok" }} onDismiss={noop} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("Toast close button has accessible label", () => {
    render(<Toast message={{ type: "info", text: "info" }} onDismiss={noop} />);
    expect(screen.getByRole("button", { name: /dismiss notification/i })).toBeInTheDocument();
  });

  it("Modal has role=dialog and aria-modal", () => {
    render(<Modal isOpen={true} title="Test" onClose={noop}><p>body</p></Modal>);
    // Modal renders into document.body via createPortal
    const dialog = document.querySelector("[role='dialog']")!;
    expect(dialog).toBeTruthy();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
  });

  it("DepositForm section has aria-labelledby pointing to heading", () => {
    render(<DepositForm onToast={noop} />);
    const section = screen.getByRole("region");
    const labelId = section.getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelId)?.textContent).toBe("Deposit");
  });

  it("LiveRegion has aria-live=polite by default", () => {
    const { container } = render(<LiveRegion />);
    const region = container.firstElementChild!;
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
  });

  it("LiveRegion assertive has role=alert", () => {
    const { container } = render(<LiveRegion politeness="assertive" />);
    expect(container.firstElementChild).toHaveAttribute("role", "alert");
  });
});

// ---------------------------------------------------------------------------
// Form validation — error announcement
// ---------------------------------------------------------------------------

describe("form error announcements", () => {
  it("DepositForm shows role=alert on invalid submit", async () => {
    const user = userEvent.setup();
    render(<DepositForm onToast={noop} />);
    await user.click(screen.getByRole("button", { name: /deposit/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toMatch(/valid amount/i);
  });

  it("WithdrawForm shows role=alert on invalid submit", async () => {
    const user = userEvent.setup();
    render(<WithdrawForm onToast={noop} />);
    await user.click(screen.getByRole("button", { name: /withdraw/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/valid share amount/i);
  });

  it("DepositForm sets aria-invalid=true on error", async () => {
    const user = userEvent.setup();
    render(<DepositForm onToast={noop} />);
    await user.click(screen.getByRole("button", { name: /deposit/i }));
    await screen.findByRole("alert");
    expect(screen.getByRole("spinbutton")).toHaveAttribute("aria-invalid", "true");
  });

  it("DepositForm clears error when user starts typing", async () => {
    const user = userEvent.setup();
    render(<DepositForm onToast={noop} />);
    await user.click(screen.getByRole("button", { name: /deposit/i }));
    await screen.findByRole("alert");
    await user.type(screen.getByRole("spinbutton"), "100");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("input is described by hint when no error", () => {
    render(<DepositForm onToast={noop} />);
    const input = screen.getByRole("spinbutton");
    const hintId = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(hintId)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

describe("keyboard navigation", () => {
  it("DepositForm submit button reachable via Tab", async () => {
    const user = userEvent.setup();
    render(<DepositForm onToast={noop} />);
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: /deposit/i })).toHaveFocus();
  });

  it("Modal closes on Escape key", () => {
    render(<Modal isOpen={true} title="Test" onClose={noop}><p>x</p></Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(noop).toHaveBeenCalled();
  });

  it("Modal close button is keyboard-focusable", () => {
    render(<Modal isOpen={true} title="Test" onClose={noop}><p>x</p></Modal>);
    // Modal renders via createPortal — query from document.body
    const closeBtn = document.querySelector(".modal-close") as HTMLElement;
    expect(closeBtn).toBeTruthy();
    expect(closeBtn).toHaveAttribute("aria-label");
    closeBtn.focus();
    expect(closeBtn).toHaveFocus();
  });

  it("WithdrawForm submit on Enter key", async () => {
    const user = userEvent.setup();
    render(<WithdrawForm onToast={noop} />);
    await user.type(screen.getByRole("spinbutton"), "0");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Skip link
// ---------------------------------------------------------------------------

describe("skip link", () => {
  it("skip-to-main link exists in App", async () => {
    const { default: App } = await import("../App");
    render(<App />);
    const skip = document.querySelector(".skip-link");
    expect(skip).toBeInTheDocument();
    expect(skip).toHaveAttribute("href", "#main");
  });
});
