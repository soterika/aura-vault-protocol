import { Component, type ReactNode, type ErrorInfo } from "react";
import {
  translateError,
  extractVaultCode,
  errorCodeLabel,
  SentryClient,
  type UserError,
} from "../lib/errors";

// ---------------------------------------------------------------------------
// Props & State
// ---------------------------------------------------------------------------

export interface ContractErrorBoundaryProps {
  children: ReactNode;
  /**
   * Which panel this boundary wraps. Shown in the fallback UI title and sent
   * to Sentry as context so issues are easily triaged per-panel.
   */
  panelName: "deposit" | "withdraw" | "harvest";
  /**
   * Connected wallet public key, forwarded to Sentry for correlation.
   * The value is never displayed to the user.
   */
  walletAddress?: string;
}

interface State {
  hasError: boolean;
  userError: UserError | null;
  /** Raw vault error code extracted from the thrown value, if present. */
  errorCode: number | null;
  /** Incremented on every retry so children fully remount. */
  retryKey: number;
}

// ---------------------------------------------------------------------------
// Dev-only logging — dead-code-eliminated in production builds
// ---------------------------------------------------------------------------

const IS_DEV =
  typeof import.meta !== "undefined" &&
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

function devLog(label: string, ...args: unknown[]): void {
  if (IS_DEV) {
    // eslint-disable-next-line no-console
    console.error(`[ContractErrorBoundary:${label}]`, ...args);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * React error boundary scoped to a single vault-operation panel.
 *
 * Features:
 * - Catches render-time and lifecycle errors thrown inside contract UI panels
 * - Maps vault error codes to user-friendly messages via `translateError`
 * - Shows the specific error code label (e.g. "VaultPaused (11)") in the fallback
 * - Sends the error to Sentry with wallet address and panel context
 * - Logs full error details to the console only in development builds
 * - Provides a retry button that fully remounts the panel subtree
 *
 * Usage:
 * ```tsx
 * <ContractErrorBoundary panelName="deposit" walletAddress={wallet}>
 *   <DepositForm onToast={notify} />
 * </ContractErrorBoundary>
 * ```
 */
export class ContractErrorBoundary extends Component<
  ContractErrorBoundaryProps,
  State
> {
  state: State = {
    hasError: false,
    userError: null,
    errorCode: null,
    retryKey: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    const code = extractVaultCode(error);
    const userError = translateError(error);
    return { hasError: true, userError, errorCode: code };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const { panelName, walletAddress } = this.props;
    const { errorCode } = this.state;

    // 1. Dev-only structured console log — silenced in production
    devLog(panelName, {
      message: error.message,
      code: errorCode,
      stack: error.stack,
      componentStack: info.componentStack,
      walletAddress,
    });

    // 2. Sentry capture — always runs (stub is a no-op without real SDK)
    SentryClient.captureContractError(error, {
      walletAddress,
      panelName,
      errorCode,
    });
  }

  private handleRetry = (): void => {
    this.setState((s) => ({
      hasError: false,
      userError: null,
      errorCode: null,
      retryKey: s.retryKey + 1,
    }));
  };

  render() {
    const { hasError, userError, errorCode, retryKey } = this.state;
    const { children, panelName } = this.props;

    if (!hasError) {
      // key forces full remount after retry — clears any local component state
      return <span key={retryKey}>{children}</span>;
    }

    const title = panelName.charAt(0).toUpperCase() + panelName.slice(1);
    const codeLabel = errorCode !== null ? errorCodeLabel(errorCode) : null;

    return (
      <div role="alert" aria-live="assertive" className="contract-error-boundary">
        <div className="contract-error-boundary__icon" aria-hidden="true">
          ⚠
        </div>

        <h3 className="contract-error-boundary__title">
          {title} unavailable
        </h3>

        <p className="contract-error-boundary__message">
          {userError?.message ?? "An unexpected error occurred."}
        </p>

        {userError?.action && (
          <p className="contract-error-boundary__action">{userError.action}</p>
        )}

        {codeLabel && (
          <p className="contract-error-boundary__code">
            Error: <code>{codeLabel}</code>
          </p>
        )}

        {(userError?.retryable ?? true) && (
          <button
            type="button"
            className="btn btn--primary contract-error-boundary__retry"
            onClick={this.handleRetry}
          >
            Try again
          </button>
        )}
      </div>
    );
  }
}
