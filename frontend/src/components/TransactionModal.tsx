"use client";

/**
 * TransactionModal — Issue #259: Mobile-optimised deposit/withdraw flows
 *
 * Responsive behaviour:
 *   - Mobile (< sm):  full-screen bottom sheet, slides up from bottom,
 *                     swipe-down gesture to dismiss
 *   - Desktop (≥ sm): centred modal overlay (existing behaviour)
 * Accessibility:
 *   - All interactive targets ≥ 44 × 44 px (WCAG 2.5.5)
 *   - amount input uses inputmode="decimal" → numeric keyboard on mobile
 *   - role="dialog" + aria-modal + aria-labelledby
 *   - Escape key closes on desktop; swipe-down closes on mobile
 *   - Focus trapped inside the sheet/modal while open
 *   - Body scroll locked while open
 * No horizontal overflow at 375 px viewport.
 */
import { getStoredReferralCode, clearReferralCode } from "@/lib/referral";
import { useState, useEffect, useRef } from "react";
import { AlertCircle, CheckCircle, XCircle } from "lucide-react";
import PreSignBreakdown from "./PreSignBreakdown";
import { ExplorerMenu } from "./ExplorerMenu";
import { useToast } from "./toast";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type TouchEvent,
} from "react";
import { AlertCircle, CheckCircle, XCircle, GripHorizontal } from "lucide-react";
import AddressPickerInput from "./AddressPickerInput";
// ─── Types ────────────────────────────────────────────────────────────────────
type TxType   = "deposit" | "withdraw";
type Step     = 1 | 2 | 3;
type TxType = "deposit" | "withdraw" | "harvest";
type Step = 1 | 2 | 3;
type TxStatus = "idle" | "pending" | "success" | "error";

interface Props {
  type:               TxType;
  balance:            string;
  /** Optional: current share price, used for display */
  sharePrice?:        string;
  /** Optional: timestamp of last share price update */
  type:                 TxType;
  balance:              string;
  sharePrice?:          string;
  sharePriceUpdatedAt?: number;
  /** Issue #262: pre-fill the amount input from a deep-link query param. */
  initialAmount?:       string;
  onClose:              (outcome?: "success" | "error") => void;
}
interface GasEstimate {
  baseFee:     string;
  priorityFee: string;
  totalGas:    string;
// ─── Small helpers ────────────────────────────────────────────────────────────
  type: TxType;
  balance: string;
  /** Current share price (XLM per share) used in the pre-sign breakdown. */
  sharePrice?: string;
  /** Timestamp (epoch ms) when sharePrice was last updated. */
  onClose: () => void;
function Spinner() {
  return (
    <svg
      className="animate-spin h-5 w-5 text-current"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12" cy="12" r="10"
        stroke="currentColor" strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TransactionModal({ type, balance, sharePrice = "1.0", sharePriceUpdatedAt: _sharePriceUpdatedAt, onClose }: Props) {
export default function TransactionModal({ type, balance, onClose }: Props) {
  const { info, txSuccess, error: toastError } = useToast();
  const [step, setStep] = useState<Step>(1);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [status, setStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState("");
  const [txError, setTxError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

export default function TransactionModal({
  type,
  balance,
  initialAmount,
  onClose,
}: Props) {
  const [step,         setStep]         = useState<Step>(1);
  const [amount,       setAmount]       = useState(initialAmount ?? "");
  const [recipient,    setRecipient]    = useState("");
  const [recipientErr, setRecipientErr] = useState<string | null>(null);
  const [amountError,  setAmountError]  = useState("");
  const [status,       setStatus]       = useState<TxStatus>("idle");
  const [txHash,       setTxHash]       = useState("");
  const [txError,      setTxError]      = useState("");
  const [gasEstimate,  setGasEstimate]  = useState<GasEstimate | null>(null);
  const [gasLoading,   setGasLoading]   = useState(false);
  const [retryCount,   setRetryCount]   = useState(0);
  // Controls CSS exit animation before unmounting
  const [closing,      setClosing]      = useState(false);
  const inputRef      = useRef<HTMLInputElement>(null);
  const sheetRef      = useRef<HTMLDivElement>(null);
  const titleId       = useRef(`tx-modal-title-${Math.random().toString(36).slice(2)}`);
  // ── Touch / swipe-down state ─────────────────────────────────────────────
  const touchStartY   = useRef<number | null>(null);
  const touchCurrentY = useRef<number | null>(null);
  const SWIPE_THRESHOLD = 80; // px downward to trigger dismiss
  // ── Body-scroll lock ─────────────────────────────────────────────────────
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  // ── Escape key (desktop) ──────────────────────────────────────────────────
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") triggerClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // ── Auto-focus amount input on step 1 ────────────────────────────────────
    if (step === 1) {
      // Small timeout lets the sheet animation settle first
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [step]);
  // ── Focus trap ───────────────────────────────────────────────────────────
    const sheet = sheetRef.current;
    if (!sheet) return;
    const focusable = sheet.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (focusable.length === 0) { e.preventDefault(); return; }
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [step, status]); // re-run when focusable elements change
  // ── Swipe handlers ────────────────────────────────────────────────────────
  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    touchStartY.current   = e.touches[0]?.clientY ?? null;
    touchCurrentY.current = touchStartY.current;
  };
  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    touchCurrentY.current = e.touches[0]?.clientY ?? null;
    const delta = (touchCurrentY.current ?? 0) - (touchStartY.current ?? 0);
    if (delta > 0 && sheetRef.current) {
      // Translate the sheet down as the finger drags — visual feedback
      sheetRef.current.style.transform = `translateY(${delta}px)`;
      sheetRef.current.style.transition = "none";
  const handleTouchEnd = () => {
    if (sheetRef.current) {
      sheetRef.current.style.transform = "";
      sheetRef.current.style.transition = "";
    if (delta >= SWIPE_THRESHOLD) {
      triggerClose();
    touchStartY.current   = null;
    touchCurrentY.current = null;
  // ── Close with exit animation ─────────────────────────────────────────────
  const triggerClose = useCallback((outcome?: "success" | "error") => {
    setClosing(true);
    setTimeout(() => onClose(outcome), 320);
  // Focus management on mount and unmount
    // Capture trigger element before modal takes focus
    triggerRef.current = document.activeElement as HTMLElement | null;
    // Move focus into modal: first input or modal heading
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      } else if (headingRef.current) {
        headingRef.current.focus();
      } else if (modalRef.current) {
        modalRef.current.focus();
    }, 30);
    return () => {
      clearTimeout(timer);
      // Return focus to trigger element on close
      triggerRef.current?.focus();
  // Update focus when step changes
      inputRef.current?.focus();
    } else if (headingRef.current) {
      headingRef.current.focus();
  // Focus trap & Escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      if (e.key === "Tab") {
        if (!modalRef.current) return;
        const focusableSelector =
          'button:not([disabled]):not([aria-hidden="true"]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(focusableSelector)
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const firstEl = focusables[0];
        const lastEl = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === firstEl || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            lastEl.focus();
          }
        } else {
          if (document.activeElement === lastEl) {
            firstEl.focus();
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // ── Gas estimate ─────────────────────────────────────────────────────────
  async function estimateGas(txAmount: string): Promise<void> {
    setGasLoading(true);
    try {
      const res = await fetch("/api/vault/estimate-gas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, amount: txAmount }),
      });
      const data = res.ok ? await res.json() : {};
      setGasEstimate({
        baseFee:     data.baseFee     ?? "0.001",
        priorityFee: data.priorityFee ?? "0.0005",
        totalGas:    data.totalGas    ?? "0.0015",
    } catch {
      setGasEstimate({ baseFee: "0.001", priorityFee: "0.0005", totalGas: "0.0015" });
    } finally {
      setGasLoading(false);
  }
  // ── Validation ────────────────────────────────────────────────────────────
  function validateAmount(): boolean {
    const n = parseFloat(amount);
    if (!amount || isNaN(n) || n <= 0) {
      setAmountError("Enter an amount greater than 0");
      return false;
    }
    if (n > parseFloat(balance)) {
      setAmountError("Amount exceeds your balance");
      return false;
    }
    setAmountError("");
    return true;
  }

  function validateRecipient(): boolean {
    // Only required for withdrawals
    if (type !== "withdraw") return true;
    if (!recipient.trim()) {
      setRecipientErr("Recipient address is required");
      return false;
    }
    // Basic Stellar address length / prefix check (StrKey validated in AddressPickerInput)
    if (!/^G[A-Z2-7]{55}$/.test(recipient.trim())) {
      setRecipientErr("Not a valid Stellar address");
      return false;
    }
    setRecipientErr(null);
    return true;
  }

  // ── Step navigation ───────────────────────────────────────────────────────
  async function handleNext() {
    if (step === 1 && validateAmount()) {
    if (step === 1 && validateAmount() && validateRecipient()) {
      await estimateGas(amount);
      setStep(2);
    } else if (step === 2) {
      setStep(3);
      await handleSubmit();
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(retrying = false) {
    if (!retrying) { setStatus("pending"); setTxError(""); }
    if (!retrying) {
      setStatus("pending");
      setTxError("");
      // Toast: transaction submitted
      info(`${label} submitted`, "Waiting for wallet confirmation…");
    try {
      // Attach the referral code (if any) as metadata on deposit transactions.
      // The backend uses this to credit the referrer and register the referral.
      const referralCode =
        type === "deposit" ? getStoredReferralCode() : null;

      const payload: Record<string, unknown> = { type, amount };
      if (referralCode) {
        payload.referralCode = referralCode;
      }

      const res = await fetch("/api/vault/transactions/submit", {
        method:  "POST",
        body:    JSON.stringify(payload),
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Transaction failed");
      setTxHash((data as { hash?: string }).hash ?? `tx-${Date.now()}`);
      setStatus("success");
      setRetryCount(0);
      const hash: string = data.hash || `tx-${Date.now()}`;
      setTxHash(hash);
      // Toast: transaction confirmed — includes "View on Explorer" link
      const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${hash}`;
      txSuccess(`${label} confirmed!`, explorerUrl, `Amount: ${amount} XLM`);
    } catch (err: unknown) {
      const errorMsg = (err instanceof Error ? err.message : "Transaction failed") ?? "Transaction failed";
      setTxError(errorMsg);
      setStatus("error");

      // Clear the stored referral code after a successful deposit so it is
      // not re-used on subsequent transactions.
      if (type === "deposit" && referralCode) {
        clearReferralCode();
      }
      setTxError(err instanceof Error ? err.message : "Transaction failed");
      if (retrying) setRetryCount((c) => c + 1);
      // Toast: transaction failed — error variant persists until dismissed
      toastError(`${label} failed`, errorMsg);
    }
  }

  function handleRetry() {
    setStatus("idle");
    setRetryCount((c) => c + 1);
    void handleSubmit(true);
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const label      = type === "deposit" ? "Deposit" : "Withdraw";
  const labelMap: Record<TxType, string> = {
    deposit: "Deposit",
    withdraw: "Withdraw",
    harvest: "Harvest",
  const label = labelMap[type] ?? "Deposit";
  const balanceNum = parseFloat(balance);
  const amountNum  = parseFloat(amount) || 0;
  const totalWithGas = amountNum + parseFloat(gasEstimate?.totalGas ?? "0");

  // ── Shared button class — ensures ≥ 44 px touch target (WCAG 2.5.5) ──────
  const btnPrimary =
    "flex w-full items-center justify-center rounded-xl bg-zinc-900 px-4 py-3.5 text-sm font-semibold text-white " +
    "min-h-[44px] hover:bg-zinc-700 active:scale-[0.98] transition-all " +
    "disabled:opacity-50 disabled:cursor-not-allowed " +
    "dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300";

  const btnSecondary =
    "flex w-full items-center justify-center rounded-xl border border-zinc-300 px-4 py-3.5 text-sm font-semibold " +
    "min-h-[44px] hover:bg-zinc-50 active:scale-[0.98] transition-all " +
    "dark:border-zinc-600 dark:hover:bg-zinc-800";

  const btnClose =
    "absolute right-4 top-4 flex items-center justify-center rounded-xl text-zinc-400 " +
    "min-h-[44px] min-w-[44px] hover:bg-zinc-100 hover:text-zinc-700 transition-colors " +
    "dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    /*
     * Backdrop — full-screen overlay.
     * On mobile the sheet sits at the bottom; on sm+ it centres the panel.
     */
    <div
      className={`fixed inset-0 z-50 bg-black/50 backdrop-blur-sm
        ${closing ? "animate-fade-out" : "animate-modal-backdrop"}
        /* mobile: align sheet to bottom; desktop: centre panel */
        flex items-end sm:items-center justify-center`}
      role="presentation"
      onClick={() => triggerClose()}
      {/*
       * Sheet / Modal panel.
       * Mobile:  full-width, rounded top corners, max-height 92 dvh, slides up
       * Desktop: max-w-md, rounded all corners, centred
       */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        data-cy="tx-modal"
        onClick={(e) => e.stopPropagation()}
        /* swipe-down to dismiss on mobile */
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`
          relative w-full bg-white dark:bg-zinc-900 shadow-2xl
          flex flex-col overflow-hidden
          will-change-transform
          /* mobile: bottom sheet shape + max height */
          rounded-t-2xl max-h-[92dvh]
          /* desktop: centred modal shape */
          sm:rounded-2xl sm:max-w-md sm:max-h-[90vh] sm:mx-4
          /* entry / exit animations */
          ${closing
            ? "animate-sheet-out sm:animate-fade-out"
            : "animate-sheet-in  sm:animate-modal-content"}
        `}
      >
        {/* ── Drag handle (mobile only) ── */}
        <div
          className="flex justify-center pt-3 pb-1 sm:hidden"
          aria-hidden="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      data-cy="tx-modal"
        ref={modalRef}
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900 animate-modal-content"
        tabIndex={-1}
        <button
          data-cy="modal-close"
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          aria-label="Close"
        >
          <GripHorizontal
            size={24}
            className="text-zinc-300 dark:text-zinc-600"
          />
        </div>

        {/* ── Header ── */}
        <div className="relative flex items-center px-5 pt-3 pb-4 sm:pt-5">
          <h2
            id={titleId.current}
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {label}
          </h2>
        <h2
          id="modal-title"
          ref={headingRef}
          tabIndex={-1}
          className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50 outline-none"
          {label}
        </h2>

          <button
            data-cy="modal-close"
            onClick={() => triggerClose()}
            className={btnClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* ── Step indicator ── */}
        <div className="flex gap-1.5 px-5 pb-4" aria-hidden="true">
          {([1, 2, 3] as Step[]).map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                s <= step
                  ? "bg-zinc-900 dark:bg-zinc-100"
                  : "bg-zinc-200 dark:bg-zinc-700"
              }`}
            />
          ))}
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-6">

          {/* ──────────── Step 1: Amount Input ──────────── */}
          {step === 1 && (
            <div data-cy="modal-step-1" className="flex flex-col gap-4">
              <p className="text-sm text-zinc-500">
                Available:{" "}
                <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                  {balance}
                </span>
              </p>

              {/* Issue #258: recipient address picker for withdrawals */}
              {type === "withdraw" && (
                <AddressPickerInput
                  value={recipient}
                  onChange={(addr) => { setRecipient(addr); setRecipientErr(null); }}
                  label="Recipient address"
                  error={recipientErr}
                />
              )}

              {/*
               * inputmode="decimal"  → numeric keyboard with decimal on iOS/Android
               * type="text"          → avoids browser spinners and step rounding
               * pattern="[0-9]*"     → additional hint for numeric keyboard on older Android
               */}
              <input
                ref={inputRef}
                data-cy="modal-amount-input"
                id="tx-amount"
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                autoComplete="off"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  // Allow only valid decimal input
                  const val = e.target.value;
                  if (val === "" || /^\d*\.?\d*$/.test(val)) {
                    setAmount(val);
                    setAmountError("");
                  }
                }}
                aria-label="Amount"
                aria-describedby={amountError ? "amount-error" : undefined}
                aria-invalid={!!amountError}
                /* min-h-[44px] ensures touch target even with large text */
                className="w-full min-h-[44px] rounded-xl border border-zinc-300 px-4 py-3
                  font-mono text-xl focus:outline-none focus:ring-2 focus:ring-zinc-900
                  dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100
                  dark:focus:ring-zinc-100"
              />

              {/* Quick-percentage buttons — min-h-[44px] for WCAG 2.5.5 */}
              <div className="grid grid-cols-4 gap-2">
                {([25, 50, 75, 100] as const).map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      const amt = (balanceNum * pct) / 100;
                      setAmount(amt.toFixed(2));
                      setAmountError("");
                    }}
                    className="min-h-[44px] rounded-xl bg-zinc-100 px-2 text-sm font-medium
                      hover:bg-zinc-200 active:scale-[0.97] transition-all
                      dark:bg-zinc-800 dark:hover:bg-zinc-700"
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              {amountError && (
                <p
                  id="amount-error"
                  data-cy="modal-amount-error"
                  role="alert"
                  className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400"
                >
                  <AlertCircle size={16} aria-hidden="true" />
                  {amountError}
                </p>
              )}
              <button
                data-cy="modal-next-btn"
                type="button"
                onClick={() => void handleNext()}
                className={btnPrimary}
              >
                Next
              </button>
            </div>
          )}
          {/* ──────────── Step 2: Review ──────────── */}
          {step === 2 && (
            <div data-cy="modal-step-2" className="flex flex-col gap-4">
              <dl className="flex flex-col gap-3 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-800">
                <div className="flex justify-between text-sm">
                  <dt className="text-zinc-500">Amount</dt>
                  <dd data-cy="modal-review-amount" className="font-mono font-semibold">
                    {amount}
                  </dd>
                </div>
                {type === "withdraw" && recipient && (
                  <div className="flex justify-between text-sm">
                    <dt className="text-zinc-500">Recipient</dt>
                    <dd className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all text-right max-w-[60%]">
                      {recipient}
                    </dd>
                  </div>
                )}
                {gasLoading ? (
                  <div className="flex justify-between text-sm">
                    <dt className="text-zinc-500">Est. Gas</dt>
                    <dd className="flex items-center gap-1.5">
                      <Spinner />
                      <span className="text-xs text-zinc-500">Estimating…</span>
                    </dd>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-sm">
                      <dt className="text-zinc-500">Base Fee</dt>
                      <dd data-cy="modal-base-fee" className="font-mono">
                        {gasEstimate?.baseFee ?? "0.001"} XLM
                      </dd>
                    </div>
                      <dt className="text-zinc-500">Priority Fee</dt>
                      <dd data-cy="modal-priority-fee" className="font-mono">
                        {gasEstimate?.priorityFee ?? "0.0005"} XLM
                    <div className="flex justify-between border-t border-zinc-200 pt-3 text-sm font-semibold dark:border-zinc-700">
                      <dt className="text-zinc-600 dark:text-zinc-300">Total Gas</dt>
                      <dd data-cy="modal-gas-estimate" className="font-mono">
                        {gasEstimate?.totalGas ?? "0.0015"} XLM
                  </>
                )}
                <div className="flex justify-between border-t border-zinc-200 pt-3 text-base font-bold dark:border-zinc-700">
                  <dt className="text-zinc-900 dark:text-zinc-100">Total (with gas)</dt>
                  <dd
                    data-cy="modal-total"
                    className={`font-mono ${
                      totalWithGas > balanceNum
                        ? "text-red-600 dark:text-red-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                    {totalWithGas.toFixed(4)}
              </dl>
              {totalWithGas > balanceNum && (
                <p className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  Insufficient balance for gas fees
              <div className="flex gap-3">
                <button
                  data-cy="modal-back-btn"
                  type="button"
                  onClick={() => setStep(1)}
                  className={btnSecondary}
                  Back
                </button>
                  data-cy="modal-next-btn"
                  onClick={() => void handleNext()}
                  disabled={totalWithGas > balanceNum || gasLoading}
                  className={btnPrimary}
                  Confirm
          {/* ──────────── Step 3: Signing / Result ──────────── */}
          {step === 3 && (
              data-cy="modal-step-3"
              className="flex flex-col items-center gap-5 py-4 text-center"
            >
              {status === "pending" && (
                <>
                  <Spinner />
                  <p className="text-sm text-zinc-500">Confirming in wallet…</p>
                    data-cy="modal-confirm-btn"
                    disabled
                    className={`${btnPrimary} opacity-50 cursor-not-allowed`}
                    Waiting…
                </>
              {status === "success" && (
                <div data-cy="modal-success" className="flex flex-col items-center gap-4 w-full">
                  <CheckCircle
                    size={52}
                    className="animate-success-check text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  <p className="font-semibold text-zinc-900 dark:text-zinc-50 text-lg">
                    {label} successful!
                  </p>
                  <p className="text-xs text-zinc-500">
                    Tx:{" "}
                    <span data-cy="modal-tx-hash" className="font-mono">
                      {txHash.slice(0, 16)}…
                    </span>
        {/* Step 2: Pre-sign Breakdown */}
        {step === 2 && (
          <div data-cy="modal-step-2">
            <PreSignBreakdown
              type={type}
              amount={amount}
              sharePrice={sharePrice}
              onCancel={() => setStep(1)}
              onProceed={handleNext}
          </div>
        )}
        {/* Step 3: Signing / Result */}
        {step === 3 && (
          <div
            data-cy="modal-step-3"
            className="flex flex-col items-center gap-4 py-4 text-center"
            {status === "pending" && (
              <>
                <Spinner />
                <p className="text-sm text-zinc-500">Confirming in wallet…</p>
                  data-cy="modal-confirm-btn"
                  disabled
                  className="rounded-lg bg-zinc-200 px-4 py-2.5 font-semibold text-zinc-400 dark:bg-zinc-700 dark:text-zinc-500"
                  Waiting…
              </>
            )}
            {status === "success" && (
              <div data-cy="modal-success" className="flex flex-col items-center gap-3">
                <CheckCircle size={48} className="text-green-600 dark:text-green-400" />
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {label} successful!
                <p className="text-xs text-zinc-500">
                  Tx:{" "}
                  <ExplorerMenu
                    data-cy="modal-tx-hash"
                    className="font-mono"
                    {txHash.slice(0, 16)}…
                  </span>
                    value={txHash}
                    type="tx"
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                  onClick={onClose}
                  className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black"
                  Done
            {status === "error" && (
              <div data-cy="modal-error" className="flex flex-col items-center gap-3">
                <XCircle size={48} className="text-red-600 dark:text-red-400" />
                <p className="text-sm text-red-600 dark:text-red-400">
                  {txError || "Transaction failed"}
                {retryCount < 3 && (
                  <button
                    type="button"
                    onClick={() => triggerClose("success")}
                    className={btnPrimary}
                  >
                    Done
                  </button>
                </div>
              )}

              {status === "error" && (
                <div data-cy="modal-error" className="flex flex-col items-center gap-4 w-full">
                  <XCircle
                    size={52}
                    className="text-red-600 dark:text-red-400"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {txError || "Transaction failed"}
                  </p>
                  {retryCount < 3 && (
                    <button
                      data-cy="modal-retry-btn"
                      type="button"
                      onClick={handleRetry}
                      className={btnPrimary}
                    >
                      Retry {retryCount > 0 && `(${retryCount}/3)`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className={btnSecondary}
                  >
                    Start Over
                  </button>
                </div>
              )}
            </div>
          )}

        </div>{/* end scrollable body */}
      </div>{/* end sheet/modal */}
    </div>   /* end backdrop */
  );
}
