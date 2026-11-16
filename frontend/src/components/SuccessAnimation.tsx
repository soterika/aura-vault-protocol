"use client";

import { useEffect, useRef, useCallback } from "react";
import { X, ExternalLink } from "lucide-react";

export type ActionType = "deposit" | "withdraw" | "harvest";

export interface SuccessAnimationProps {
  /** Which action was confirmed on-chain */
  action: ActionType;
  /** Token amount involved */
  amount: number;
  /** Token symbol */
  symbol?: string;
  /** Updated share balance after the action */
  newShareBalance?: number;
  /** Stellar explorer URL for the transaction */
  explorerUrl?: string;
  /** Called when the modal should close */
  onClose: () => void;
}

const ACTION_LABELS: Record<ActionType, string> = {
  deposit: "Deposit Confirmed",
  withdraw: "Withdrawal Confirmed",
  harvest: "Harvest Confirmed",
};

const ACTION_DESCRIPTIONS: Record<ActionType, string> = {
  deposit: "Your tokens have been deposited and shares minted.",
  withdraw: "Your shares have been burned and tokens returned.",
  harvest: "Yield has been injected into the vault.",
};

// ---------------------------------------------------------------------------
// CSS-only confetti — zero external files, well under 50 KB budget
// ---------------------------------------------------------------------------
const CONFETTI_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#3b82f6",
];

function Confetti() {
  const count = 28;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
    >
      {Array.from({ length: count }, (_, i) => {
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        const left = `${((i / count) * 100).toFixed(1)}%`;
        const delay = `${(i * 0.055).toFixed(2)}s`;
        const duration = `${(0.85 + (i % 5) * 0.14).toFixed(2)}s`;
        const size = [8, 6, 10][i % 3];
        const isCircle = i % 2 === 0;
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              top: "-12px",
              left,
              width: size,
              height: size,
              borderRadius: isCircle ? "50%" : "2px",
              backgroundColor: color,
              animationName: "auraConfettiFall",
              animationDuration: duration,
              animationDelay: delay,
              animationTimingFunction: "ease-in",
              animationFillMode: "both",
            }}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function SuccessAnimation({
  action,
  amount,
  symbol = "USDC",
  newShareBalance,
  explorerUrl,
  onClose,
}: SuccessAnimationProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onClose();
  }, [onClose]);

  // Auto-close after 3 seconds
  useEffect(() => {
    timerRef.current = setTimeout(close, 3000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [close]);

  return (
    <>
      {/*
        Keyframes injected inline — pure CSS, respects prefers-reduced-motion.
        No external files; total addition to bundle is ~0 KB.
      */}
      <style>{`
        @keyframes auraConfettiFall {
          0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(320px) rotate(720deg); opacity: 0; }
        }
        @keyframes auraCheckPop {
          0%   { transform: scale(0.3); opacity: 0; }
          60%  { transform: scale(1.18); }
          100% { transform: scale(1); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes auraConfettiFall { 0%, 100% { opacity: 0; } }
          @keyframes auraCheckPop    { 0%, 100% { transform: scale(1); opacity: 1; } }
        }
      `}</style>

      {/* Backdrop — click outside to dismiss */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
        onClick={close}
        role="presentation"
      >
        {/* Modal card */}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="success-title"
          className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl p-8 overflow-hidden text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Confetti />

          {/* Dismiss button */}
          <button
            type="button"
            onClick={close}
            className="absolute top-3 right-3 rounded-lg p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Close"
          >
            <X size={16} />
          </button>

          {/* Animated checkmark */}
          <div
            className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30"
            style={{
              animationName: "auraCheckPop",
              animationDuration: "0.45s",
              animationTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)",
              animationFillMode: "both",
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7 16.5l6 6 12-13"
                stroke="#10b981"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {/*
            aria-live region — result announced to screen readers as soon as
            the component mounts. aria-atomic ensures the full message is read.
          */}
          <div aria-live="polite" aria-atomic="true">
            <h2
              id="success-title"
              className="text-lg font-semibold mb-1.5"
            >
              {ACTION_LABELS[action]}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-5">
              {ACTION_DESCRIPTIONS[action]}
            </p>

            {/* Summary card */}
            <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3 mb-5 text-sm text-left space-y-1.5">
              <div className="flex justify-between">
                <span className="text-zinc-500">Amount</span>
                <span className="font-medium">
                  {amount.toLocaleString()} {symbol}
                </span>
              </div>
              {newShareBalance !== undefined && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Share balance</span>
                  <span className="font-medium">
                    {newShareBalance.toLocaleString()} shares
                  </span>
                </div>
              )}
            </div>
          </div>

          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
            >
              View Transaction
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
    </>
  );
}
