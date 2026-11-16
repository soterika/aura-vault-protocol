import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ErrorMessage } from "../components/ErrorMessage";
import type { UserError } from "../lib/errors";

/**
 * Error UI components used throughout the Aura Vault app.
 *
 * - **`ErrorBoundary`** — React class component that catches unhandled render errors
 *   and displays a recovery UI instead of a blank screen.
 * - **`ErrorMessage`** — Inline error banner with optional retry and dismiss actions,
 *   used inside forms when a contract call fails.
 *
 * ## Accessibility
 * - `ErrorBoundary` fallback uses `role="alert"`
 * - `ErrorMessage` uses `role="alert"` + `aria-live="assertive"` for immediate announcement
 */
const meta = {
  title: "Feedback/ErrorUI",
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj;

// ── ErrorBoundary ────────────────────────────────────────────────────────────

/** `ErrorBoundary` default fallback — shown when a child component throws. */
export const BoundaryFallback: Story = {
  render: () => (
    <div style={{ width: "400px" }}>
      <ErrorBoundary
        fallback={
          <div role="alert" className="error-boundary">
            <p className="error-boundary__title">Something went wrong.</p>
            <p className="error-boundary__body">
              Please refresh the page. If this keeps happening, contact support.
            </p>
            <button className="btn btn--primary" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        }
      >
        {/* Healthy children — no error shown */}
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
          ErrorBoundary is wrapping healthy content. Trigger an error to see the fallback.
        </p>
      </ErrorBoundary>
    </div>
  ),
};

/** Custom fallback slot. */
export const CustomFallback: Story = {
  render: () => (
    <div style={{ width: "400px" }}>
      <ErrorBoundary
        fallback={
          <div role="alert" style={{ padding: "1rem", border: "1px solid red", borderRadius: "8px" }}>
            <strong>Custom fallback UI</strong>
            <p style={{ margin: "0.5rem 0 0" }}>Chart failed to render. Try refreshing.</p>
          </div>
        }
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>Healthy children here.</p>
      </ErrorBoundary>
    </div>
  ),
};

// ── ErrorMessage ─────────────────────────────────────────────────────────────

const retryableError: UserError = {
  message: "Transaction failed: network timeout.",
  action: "Check your connection and try again.",
  severity: "error",
  retryable: true,
  code: "NETWORK_TIMEOUT",
};

const fatalError: UserError = {
  message: "Vault is currently paused by admin.",
  action: "Wait for the vault to be unpaused before transacting.",
  severity: "error",
  retryable: false,
  code: "VAULT_PAUSED",
};

const warningError: UserError = {
  message: "High network congestion detected.",
  action: "Your transaction may take longer than usual.",
  severity: "warning",
  retryable: false,
  code: "HIGH_CONGESTION",
};

/** Retryable error — shows Retry + Dismiss buttons. */
export const Retryable: Story = {
  render: () => (
    <div style={{ width: "400px" }}>
      <ErrorMessage
        error={retryableError}
        onRetry={() => alert("Retrying…")}
        onDismiss={() => alert("Dismissed")}
      />
    </div>
  ),
};

/** Non-retryable fatal error — only Dismiss. */
export const Fatal: Story = {
  render: () => (
    <div style={{ width: "400px" }}>
      <ErrorMessage
        error={fatalError}
        onDismiss={() => alert("Dismissed")}
      />
    </div>
  ),
};

/** Warning severity — lower-urgency alert. */
export const Warning: Story = {
  render: () => (
    <div style={{ width: "400px" }}>
      <ErrorMessage error={warningError} />
    </div>
  ),
};

/** All states stacked. */
export const AllStates: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", width: "400px" }}>
      <ErrorMessage error={retryableError} onRetry={() => undefined} onDismiss={() => undefined} />
      <ErrorMessage error={fatalError}     onDismiss={() => undefined} />
      <ErrorMessage error={warningError} />
    </div>
  ),
};
