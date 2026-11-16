"use client";

/**
 * VaultActions (#478 update, #269 keyboard shortcuts update)
 *
 * Deposit / Withdraw action panel.
 * The Deposit button now uses <DepositButton> which shows:
 *   - Spinner while a deposit is pending
 *   - Checkmark on success (auto-resets after 2 s)
 *   - × on failure (auto-resets after 2 s)
 * #269: accepts an optional `externalModal` prop so that keyboard
 * shortcuts registered in a parent component can open a modal
 * without pointer interaction.
 * VaultActions — Issue #478 + #262
 * Issue #478: DepositButton shows spinner / checkmark / × states.
 * Issue #262: Accepts `initialAction` and `initialAmount` props so external
 *   deep-links (?action=deposit&amount=100) can pre-open the modal with a
 *   pre-filled amount. After the modal closes the caller's `onDeepLinkHandled`
 *   callback fires so the parent can strip the query params from the URL.
 */
import { useState, useEffect, useRef } from "react";
import TransactionModal from "./TransactionModal";
import DepositButton, { type ButtonTxState } from "./DepositButton";
import { useOnboarding } from "@/components/OnboardingChecklist";
import type { DeepLinkAction } from "@/lib/useDeepLink";
type Tab = "deposit" | "withdraw";
interface VaultActionsProps {
  /**
   * When set by a parent (e.g. via keyboard shortcut), immediately opens
   * the specified modal.  The parent is responsible for resetting this to
   * `null` after the modal closes (via `onExternalModalClose`).
   */
  externalModal?: Tab | null;
  /** Called after an externally-triggered modal has been closed. */
  onExternalModalClose?: () => void;
}
export default function VaultActions({
  externalModal,
  onExternalModalClose,
}: VaultActionsProps = {}) {
type Tab = "deposit" | "withdraw" | "harvest";
export default function VaultActions() {
  const [tab, setTab] = useState<Tab>("deposit");
  const [modal, setModal] = useState<Tab | null>(null);
  const [balance, setBalance] = useState("1000");
  const [depositState, setDepositState] = useState<ButtonTxState>("idle");
  const [isPaused, setIsPaused] = useState(false);
  const [sharePrice, setSharePrice] = useState("1.0");
  const [sharePriceUpdatedAt, setSharePriceUpdatedAt] = useState<
    number | undefined
  >(undefined);
interface Props {
  /** Pre-open this modal type on first render (from deep-link). */
  initialAction?: DeepLinkAction | null;
  /** Pre-fill the amount input (from deep-link). */
  initialAmount?: string | null;
  /** Called once after the deep-link-triggered modal is closed so the parent
   *  can remove the query params from the canonical URL. */
  onDeepLinkHandled?: () => void;
  initialAction = null,
  initialAmount = null,
  onDeepLinkHandled,
}: Props) {
  const [tab,                setTab]                = useState<Tab>(initialAction ?? "deposit");
  const [modal,              setModal]              = useState<Tab | null>(null);
  const [balance,            setBalance]            = useState("1000");
  const [depositState,       setDepositState]       = useState<ButtonTxState>("idle");
  const [sharePrice,         setSharePrice]         = useState("1.0");
  const [sharePriceUpdatedAt, setSPUpdatedAt]       = useState<number | undefined>(undefined);
  const deepLinkFired = useRef(false);
  const { markComplete } = useOnboarding();
 * VaultActions
 * Deposit / Withdraw / Harvest action panel.
 * Pause integration: all action buttons are disabled when the vault is paused.
 * The component accepts an optional `isPaused` prop so the parent can pass down
 * the shared pause state (avoiding duplicate polls). If the prop is omitted the
 * component falls back to its own `useVaultPause` call.
import { useState, useEffect, useCallback } from "react";
import { useVaultPause } from "@/lib/useVaultPause";
export interface VaultActionsProps {
   * Optional: pass the vault pause state from a parent that already calls
   * `useVaultPause`, so the hook is not duplicated. When omitted the component
   * manages its own pause state.
  isPaused?: boolean | undefined;
export default function VaultActions({ isPaused: isPausedProp }: VaultActionsProps = {}) {
  // Use the passed-in value when available, otherwise poll independently.
  const { isPaused: isPausedLocal } = useVaultPause();
  const isPaused = isPausedProp !== undefined ? isPausedProp : isPausedLocal;
  const paused = isPaused === true;
  const fetchBalance = useCallback(async () => {
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
      const res = await fetch(`${apiBase}/api/vault/balance_of?address=mock`);
      if (res.ok) {
        const d = await res.json() as { balance?: string };
        if (d?.balance) setBalance(d.balance);
      }
    } catch {
      // Ignore — keep the existing balance
    }
  }, []);

  // Fetch live balance
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vault/balance_of?address=mock`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
      .then((d: { balance?: string } | null) => {
      })
      .catch(() => {});
  // Sync the internal modal state when the parent requests an open.
    if (externalModal) {
      if (externalModal === "deposit") {
        setTab("deposit");
        setDepositState("pending");
      } else {
        setTab("withdraw");
      setModal(externalModal);
  }, [externalModal]);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
    fetch(`${apiUrl}/api/vault/balance_of?address=mock`)
    fetch(`${apiUrl}/api/vault/status`)
        if (d?.paused !== undefined) setIsPaused(d.paused);
        else if (d?.is_paused !== undefined) setIsPaused(d.is_paused);
   * Called when TransactionModal closes.
   * Accepts an optional outcome so we can animate the button.
   * Signature matches TransactionModal's onClose prop: (outcome?) => void
  function handleModalClose(type: Tab, outcome?: "success" | "error") {
    setModal(null);
    // Notify the parent that an externally-triggered modal has closed.
    onExternalModalClose?.();
  // Issue #262: open modal from deep-link on first render only
    if (deepLinkFired.current) return;
    if (!initialAction) return;
    deepLinkFired.current = true;
    // Switch the visible tab to match the action
    setTab(initialAction);
    // For deposit, drive the animated button state through pending
    if (initialAction === "deposit") setDepositState("pending");
    setModal(initialAction);
  }, [initialAction]);
  // ── Handlers ──────────────────────────────────────────────────────────────
    if (type === "deposit") {
      markComplete("make_first_deposit");
      if (outcome === "success") {
        setDepositState("success");
        setTimeout(() => setDepositState("idle"), 2000);
      } else if (outcome === "error") {
        setDepositState("error");
        // Dismissed without completing
        setDepositState("idle");
    // Issue #262: notify parent to strip query params from the canonical URL.
    // Only fires once — when the deep-link-triggered modal is closed.
    if (deepLinkFired.current) {
      onDeepLinkHandled?.();
      // Reset so subsequent manual opens don't retrigger the callback
      deepLinkFired.current = false;
    void fetchBalance();
  }, [fetchBalance]);
  function handleModalClose() {
  }

  // ── Disabled-button helper ─────────────────────────────────────────────
  // When paused: cursor-not-allowed, reduced opacity, aria-disabled.

  const pausedClasses =
    "opacity-50 cursor-not-allowed pointer-events-none";

  const actionButtonBase =
    "w-full rounded-lg py-2.5 text-sm font-semibold transition-colors";

  const primaryButtonClasses = [
    actionButtonBase,
    "bg-zinc-900 text-white hover:bg-zinc-700",
    "dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300",
    paused ? pausedClasses : "",
  ]
    .join(" ")
    .trim();

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section
      className="w-full rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
      aria-label="Vault actions"
    >
      {/* Tabs */}
      <div className="flex gap-2 mb-4" role="tablist" aria-label="Action type">
        <button
          role="tab"
          aria-selected={tab === "deposit"}
          data-cy="deposit-tab"
          onClick={() => setTab("deposit")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
            tab === "deposit"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
              : "border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
          }`}
        >
          Deposit
        </button>
        <button
          role="tab"
          aria-selected={tab === "withdraw"}
          data-cy="withdraw-tab"
          onClick={() => setTab("withdraw")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
            tab === "withdraw"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
              : "border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
          }`}
        >
          Withdraw
        </button>
        <button
          data-cy="harvest-tab"
          onClick={() => setTab("harvest")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
            tab === "harvest"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
              : "border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
          }`}
        >
          Harvest
        </button>
      </div>

      <p className="text-sm text-zinc-500 mb-4">
        Balance:{" "}
        <span
          data-cy="vault-balance"
          className="font-mono font-semibold text-zinc-800 dark:text-zinc-200"
        >
          {balance}
        </span>
      </p>

      {/* Deposit tab */}
      {tab === "deposit" && (
        <DepositButton
          data-cy="open-deposit-modal"
          txState={depositState}
          onClick={handleOpenDeposit}
          disabled={isPaused || depositState === "pending"}
          className="w-full"
      {/* Pause notice — shown inside the panel in addition to the page-level banner */}
      {paused && (
        <p
          className="mb-3 text-xs font-medium text-red-600 dark:text-red-400"
          aria-live="polite"
        >
          Actions are disabled while the vault is paused.
        </p>
          {isPaused ? "Vault Paused" : "Deposit"}
        </DepositButton>
      )}

          type="button"
          disabled={paused}
          aria-disabled={paused}
          onClick={() => !paused && setModal("deposit")}
          className={primaryButtonClasses}
      {/* Withdraw tab */}
      {tab === "withdraw" && (
        <button
          data-cy="open-withdraw-modal"
          type="button"
          disabled={paused}
          aria-disabled={paused}
          onClick={() => !paused && setModal("withdraw")}
          className={primaryButtonClasses}
        >
          Withdraw
        </button>
      )}

      {/* Modal — passes initialAmount so TransactionModal can pre-fill Step 1 */}
      {/* Harvest tab */}
      {tab === "harvest" && (
          data-cy="open-harvest-modal"
          onClick={() => setModal("harvest")}
          className="w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
      {/* Modal */}
      {modal && (
        <TransactionModal
          type={modal}
          balance={balance}
          sharePrice={sharePrice}
          sharePriceUpdatedAt={sharePriceUpdatedAt}
          initialAmount={modal === initialAction ? (initialAmount ?? undefined) : undefined}
          onClose={(outcome) => handleModalClose(modal, outcome)}
          onClose={() => handleModalClose(modal)}
      {/* Harvest — always visible in case the user switches tabs */}
      <button
        data-cy="open-harvest-modal"
        type="button"
        disabled={paused}
        aria-disabled={paused}
        onClick={() => !paused && setModal(null /* harvest handled separately */)}
        className={[
          actionButtonBase,
          "mt-2 border border-zinc-300 hover:bg-zinc-50",
          "dark:border-zinc-600 dark:hover:bg-zinc-800",
          paused ? pausedClasses : "",
        ]
          .join(" ")
          .trim()}
      >
        Harvest
      </button>
      {/* Modal */}
      {modal && !paused && (
          sharePrice="1.0"
          onClose={handleModalClose}
        />
      )}
    </section>
  );
}
