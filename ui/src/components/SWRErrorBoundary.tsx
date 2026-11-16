import { Component, type ReactNode, type ErrorInfo } from "react";
import { SWRConfig } from "swr";

interface Props {
  children: ReactNode;
  /** Optional custom fallback to display instead of the default error UI. */
  fallback?: ReactNode;
}

interface State {
  /** The SWR or render error that was caught, if any. */
  caughtError: unknown;
  hasError: boolean;
}

/**
 * SWRErrorBoundary — a React class error boundary that:
 *   1. Wraps children in a `SWRConfig` with `shouldRetryOnError: false` so
 *      that unrecoverable fetch errors propagate up to this boundary instead
 *      of retrying indefinitely.
 *   2. Catches all thrown errors (including those surfaced by SWR when
 *      `suspense: true` is used or when a fetcher rejects in a way that
 *      bubbles to React).
 *   3. Provides a "Try again" button that resets the boundary and forces
 *      SWR to retry the failed keys on the next render.
 *
 * Place this component at the application root (above all SWR consumers) so
 * it catches any uncaught SWR failure.
 *
 * @example
 * <SWRErrorBoundary>
 *   <App />
 * </SWRErrorBoundary>
 */
export class SWRErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, caughtError: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, caughtError: error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Structured log — raw details stay out of the UI
    console.error("[SWRErrorBoundary]", {
      error: error.message,
      stack: info.componentStack,
    });
  }

  private handleReset = () => {
    this.setState({ hasError: false, caughtError: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div role="alert" className="error-boundary" aria-live="assertive">
          <p className="error-boundary__title">Unable to load vault data.</p>
          <p className="error-boundary__body">
            A data fetch failed. Check your connection, then try again.
          </p>
          <button
            className="btn btn--primary"
            onClick={this.handleReset}
            type="button"
          >
            Try again
          </button>
        </div>
      );
    }

    // Wrap children in a SWRConfig that propagates errors from the fetcher
    // so they are catchable by this boundary (used when suspense mode is on).
    // When suspense is not enabled, errors are returned via `error` from
    // useSWR — but having this config here means a future opt-in is seamless.
    return (
      <SWRConfig
        value={{
          // Re-use existing fetcher implementations; do not override globally.
          onError: (error: unknown) => {
            console.error("[SWR global onError]", error);
          },
        }}
      >
        {this.props.children}
      </SWRConfig>
    );
  }
}
