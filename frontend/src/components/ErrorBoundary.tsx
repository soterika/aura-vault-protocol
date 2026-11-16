"use client";

import React, { type ReactNode } from "react";
import { useNotifications } from "./notifications";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
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
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-4">
            <p className="text-sm font-semibold text-red-900 dark:text-red-100">
              Something went wrong
            </p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-1">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-3 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline"
            >
              Try again
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
