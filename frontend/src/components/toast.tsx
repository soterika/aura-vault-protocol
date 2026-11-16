"use client";

/**
 * Toast Notification System — Issue #257
 *
 * - Four variants: success | error | warning | info
 * - Auto-dismiss after 5 s; error toasts persist until manually dismissed
 * - Max 3 toasts visible at once; extras are queued and shown when space frees up
 * - Position: top-right on desktop, top-center on mobile
 * - Accessible: role="alert", aria-live="assertive" for errors,
 *               aria-live="polite" for the rest
 * - "View on Explorer" action link in tx-success toasts
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastOptions {
  /** Variant controls colour, icon, and dismissal behaviour. */
  variant: ToastVariant;
  /** Short headline shown in bold. */
  title: string;
  /** Optional supporting text. */
  message?: string;
  /**
   * Link shown as "View on Explorer" — typically a Stellar/EVM explorer URL
   * for a confirmed transaction hash.
   */
  explorerUrl?: string;
  /**
   * Override auto-dismiss duration (ms). Pass `0` to disable auto-dismiss.
   * Defaults to 5000 ms. Error toasts always persist (auto-dismiss is disabled
   * regardless of this value).
   */
  duration?: number;
}

export interface Toast extends ToastOptions {
  id: string;
  /** UNIX ms timestamp of when the toast was enqueued. */
  createdAt: number;
}

interface ToastContextValue {
  /**
   * Add a toast.  Returns the assigned id so callers can dismiss it
   * programmatically if needed.
   */
  addToast: (options: ToastOptions) => string;
  /** Dismiss a specific toast by id. */
  dismissToast: (id: string) => void;
  /** Convenience wrappers. */
  success: (title: string, message?: string, explorerUrl?: string) => string;
  error: (title: string, message?: string) => string;
  warning: (title: string, message?: string) => string;
  info: (title: string, message?: string) => string;
  /** Convenience for transaction-confirmed pattern. */
  txSuccess: (title: string, explorerUrl: string, message?: string) => string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_VISIBLE = 3;
const DEFAULT_DURATION_MS = 5_000;

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  /** All toasts that have been added but not yet dismissed (visible + queued). */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    // Clear any pending auto-dismiss timer
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const scheduleAutoDismiss = useCallback(
    (id: string, variant: ToastVariant, duration: number) => {
      // Error toasts always persist — never auto-dismiss
      if (variant === "error") return;
      // duration of 0 means manual-dismiss-only
      if (duration === 0) return;
      const timer = setTimeout(() => removeToast(id), duration);
      timersRef.current.set(id, timer);
    },
    [removeToast],
  );

  const addToast = useCallback(
    (options: ToastOptions): string => {
      const id = crypto.randomUUID();
      const duration =
        options.variant === "error"
          ? 0 // errors never auto-dismiss
          : (options.duration ?? DEFAULT_DURATION_MS);

      const toast: Toast = {
        ...options,
        id,
        createdAt: Date.now(),
        duration,
      };

      setToasts((prev) => [...prev, toast]);
      scheduleAutoDismiss(id, options.variant, duration);
      return id;
    },
    [scheduleAutoDismiss],
  );

  // Clean up all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  const success = useCallback(
    (title: string, message?: string, explorerUrl?: string) =>
      addToast({ variant: "success", title, message, explorerUrl }),
    [addToast],
  );

  const error = useCallback(
    (title: string, message?: string) =>
      addToast({ variant: "error", title, message }),
    [addToast],
  );

  const warning = useCallback(
    (title: string, message?: string) =>
      addToast({ variant: "warning", title, message }),
    [addToast],
  );

  const info = useCallback(
    (title: string, message?: string) =>
      addToast({ variant: "info", title, message }),
    [addToast],
  );

  const txSuccess = useCallback(
    (title: string, explorerUrl: string, message?: string) =>
      addToast({ variant: "success", title, message, explorerUrl }),
    [addToast],
  );

  const value: ToastContextValue = {
    addToast,
    dismissToast: removeToast,
    success,
    error,
    warning,
    info,
    txSuccess,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `useToast` — returns all toast actions.
 *
 * Must be rendered inside `<ToastProvider>`.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function IconSuccess() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5 shrink-0 text-emerald-500"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"
      />
    </svg>
  );
}

function IconError() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5 shrink-0 text-red-500"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5 shrink-0 text-amber-500"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9 3.75h.008v.008H12v-.008z"
      />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5 shrink-0 text-blue-500"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9-3.75h.008v.008H12V8.25z"
      />
    </svg>
  );
}

const ICONS: Record<ToastVariant, () => React.ReactElement> = {
  success: IconSuccess,
  error: IconError,
  warning: IconWarning,
  info: IconInfo,
};

// ─────────────────────────────────────────────────────────────────────────────
// Variant styles
// ─────────────────────────────────────────────────────────────────────────────

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success:
    "bg-white dark:bg-zinc-900 border-emerald-200 dark:border-emerald-800",
  error: "bg-white dark:bg-zinc-900 border-red-200 dark:border-red-800",
  warning:
    "bg-white dark:bg-zinc-900 border-amber-200 dark:border-amber-800",
  info: "bg-white dark:bg-zinc-900 border-blue-200 dark:border-blue-800",
};

// ─────────────────────────────────────────────────────────────────────────────
// ToastItem
// ─────────────────────────────────────────────────────────────────────────────

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const Icon = ICONS[toast.variant];
  const isError = toast.variant === "error";

  return (
    <div
      role="alert"
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      data-testid="toast"
      data-variant={toast.variant}
      className={[
        "pointer-events-auto flex w-full items-start gap-3",
        "rounded-xl border shadow-lg backdrop-blur-sm p-4",
        "animate-in slide-in-from-right-5 fade-in duration-300",
        VARIANT_STYLES[toast.variant],
      ].join(" ")}
    >
      {/* Icon */}
      <div className="mt-0.5">
        <Icon />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {toast.title}
        </p>
        {toast.message && (
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {toast.message}
          </p>
        )}
        {toast.explorerUrl && (
          <a
            href={toast.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 underline-offset-2 hover:underline"
          >
            View on Explorer
            <svg
              aria-hidden="true"
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
              />
            </svg>
          </a>
        )}
      </div>

      {/* Dismiss button */}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18 18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ToastContainer
// ─────────────────────────────────────────────────────────────────────────────

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

/**
 * Renders up to MAX_VISIBLE (3) toasts.  Remaining toasts are queued and will
 * appear automatically once a visible toast is dismissed or auto-dismissed.
 *
 * Position:
 *   - desktop (sm+): fixed top-right  (top-4 right-4)
 *   - mobile  (<sm): fixed top-centre (top-4 left-1/2 -translate-x-1/2)
 */
export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  const visible = toasts.slice(-MAX_VISIBLE); // most-recent N
  const queuedCount = Math.max(0, toasts.length - MAX_VISIBLE);

  return (
    /*
     * On mobile the container is centred horizontally.
     * On sm+ it is anchored to the top-right corner.
     */
    <div
      aria-label="Notifications"
      className={[
        "fixed z-[100] flex flex-col gap-2",
        // Mobile: top-center
        "top-4 left-1/2 -translate-x-1/2 w-[calc(100vw-2rem)] max-w-sm",
        // Desktop: top-right (overrides mobile classes)
        "sm:left-auto sm:right-4 sm:translate-x-0 sm:w-80",
      ].join(" ")}
    >
      {visible.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}

      {/* Queue indicator */}
      {queuedCount > 0 && (
        <p
          aria-live="polite"
          className="text-center text-xs text-zinc-500 dark:text-zinc-400"
        >
          +{queuedCount} more notification{queuedCount > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
