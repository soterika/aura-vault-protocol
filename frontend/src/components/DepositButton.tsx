"use client";

import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { LoadingSpinner } from "./LoadingSpinner";
export type ButtonTxState = "idle" | "pending" | "success" | "error";
interface DepositButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  txState?: ButtonTxState;
  children?: ReactNode;
}
const stateConfig: Record<ButtonTxState, { label: string; classes: string }> = {
  idle: {
    label: "",
    classes: "bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600",
  },
  pending: {
    label: "Processing…",
    classes: "bg-indigo-400 cursor-not-allowed text-white",
  success: {
    label: "✓ Success",
    classes: "bg-emerald-600 text-white",
  error: {
    label: "✕ Failed",
    classes: "bg-red-600 text-white",
};
export default function DepositButton({
  txState = "idle",
  children,
  disabled,
  className = "",
  ...props
}: DepositButtonProps) {
  const config = stateConfig[txState];
  const isPending = txState === "pending";
  const isDisabled = disabled || isPending;
  return (
    <button
      {...props}
      disabled={isDisabled}
      aria-busy={isPending}
      aria-label={config.label || (typeof children === "string" ? children : "Deposit")}
      className={`
        inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5
        text-sm font-semibold transition-all duration-200
        disabled:opacity-70 disabled:cursor-not-allowed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2
        ${config.classes} ${className}
      `}
    >
      {isPending && <LoadingSpinner size="sm" />}
      {config.label || children}
    </button>
  );
import { ReactNode } from "react";
export type ButtonTxState = "idle"|"pending"|"success"|"error";
interface DepositButtonProps { txState?: ButtonTxState; onClick?: () => void; className?: string; children?: ReactNode; "data-cy"?: string; }
export default function DepositButton({ onClick, className="", children }: DepositButtonProps) {
  return <button onClick={onClick} className={className}>{children}</button>;
}
