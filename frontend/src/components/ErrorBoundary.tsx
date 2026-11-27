"use client";

import React, { type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";
import { useNotifications } from "./notifications";
import { useWalletStore } from "@/lib/walletStore";

export type ErrorCategory = "wallet_error" | "api_error" | "render_error";

export function truncateWalletAddress(
  address: string | null | undefined
): string | undefined {
  if (!address) return undefined;
  if (address.length <= 8) return "[REDACTED]";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function categorizeError(
  error: Error,
  explicitCategory?: ErrorCategory
): ErrorCategory {
  if (explicitCategory) return explicitCategory;
  const msg = `${error.name} ${error.message}`.toLowerCase();
  if (
    msg.includes("wallet") ||
    msg.includes("freighter") ||
    msg.includes("sign") ||
    msg.includes("rejected by user")
  ) {
    return "wallet_error";
  }
  if (
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("api") ||
    msg.includes("http") ||
    msg.includes("timeout")
  ) {
    return "api_error";
  }
  return "render_error";
}

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  section?: string;
  category?: ErrorCategory;
  lastAction?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Error caught:", error, errorInfo);

    const category = categorizeError(error, this.props.category);
    const route =
      typeof window !== "undefined" ? window.location.pathname : undefined;
    const rawAddress = useWalletStore.getState().address;
    const truncatedWallet = truncateWalletAddress(rawAddress);

    Sentry.withScope((scope) => {
      scope.setTag("error_category", category);
      if (this.props.section) {
        scope.setTag("section", this.props.section);
      }
      if (route) {
        scope.setTag("route", route);
      }
      if (truncatedWallet) {
        scope.setUser({ id: truncatedWallet });
      }
      scope.setContext("react", {
        componentStack: errorInfo.componentStack,
      });
      scope.setContext("vault", {
        section: this.props.section ?? "unknown",
        route: route ?? "unknown",
        lastAction: this.props.lastAction,
      });
      Sentry.captureException(error);
    });
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div
            role="alert"
            className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-4"
          >
            <p className="text-sm font-semibold text-red-900 dark:text-red-100">
              Something went wrong
            </p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-1">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button
              type="button"
              onClick={this.reset}
              className="mt-3 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline"
            >
              Retry
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

export function useErrorHandler() {
  const { toast } = useNotifications();

  return {
    handle: (error: unknown, defaultMessage: string = "An error occurred") => {
      const message = error instanceof Error ? error.message : String(error);
      toast("error", defaultMessage, message);
      console.error("[ErrorHandler]", error);
    },
  };
}
