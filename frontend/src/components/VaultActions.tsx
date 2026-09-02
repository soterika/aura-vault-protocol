"use client";

/**
 * VaultActions (#478 update)
 *
 * Deposit / Withdraw action panel.
 * The Deposit button now uses <DepositButton> which shows:
 *   - Spinner while a deposit is pending
 *   - Checkmark on success (auto-resets after 2 s)
 *   - × on failure (auto-resets after 2 s)
 */

import { useState, useEffect } from "react";
import TransactionModal from "./TransactionModal";
import DepositButton, { type ButtonTxState } from "./DepositButton";
import { useOnboarding } from "@/components/OnboardingChecklist";

type Tab = "deposit" | "withdraw";

export default function VaultActions() {
  const [tab, setTab] = useState<Tab>("deposit");
  const [modal, setModal] = useState<Tab | null>(null);
  const [balance, setBalance] = useState("1000");
  const [depositState, setDepositState] = useState<ButtonTxState>("idle");
  const [sharePrice, setSharePrice] = useState("1.0");
  const [sharePriceUpdatedAt, setSharePriceUpdatedAt] = useState<number | undefined>(undefined);
  const { markComplete } = useOnboarding();

  useEffect(() => {
   useEffect(() => {
  fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vault/balance_of?address=mock`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d?.balance) setBalance(d.balance);
    })
    .catch(() => {});
}, []);
  /**
   * Called when TransactionModal closes.
   * Accepts an optional outcome so we can animate the button.
   */
  function handleModalClose(type: Tab, outcome?: "success" | "error") {
    setModal(null);
    if (type === "deposit") {
      markComplete("make_first_deposit");
      if (outcome === "success") {
        setDepositState("success");
        setTimeout(() => setDepositState("idle"), 2000);
      } else if (outcome === "error") {
        setDepositState("error");
        setTimeout(() => setDepositState("idle"), 2000);
      }
    }
  }

  function handleOpenDeposit() {
    setDepositState("pending");
    setModal("deposit");
  }

  return (
    <section className="w-full rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button
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

      {/* Deposit tab — uses animated DepositButton */}
      {tab === "deposit" && (
        <DepositButton
          data-cy="open-deposit-modal"
          txState={depositState}
          onClick={handleOpenDeposit}
          className="w-full"
        >
          Deposit
        </DepositButton>
      )}

      {/* Withdraw tab — standard button */}
      {tab === "withdraw" && (
        <button
          data-cy="open-withdraw-modal"
          onClick={() => setModal("withdraw")}
          className="w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
        >
          Withdraw
        </button>
      )}

      {/* Modal */}
      {modal && (
        <TransactionModal
          type={modal}
          balance={balance}
          sharePrice={sharePrice}
          sharePriceUpdatedAt={sharePriceUpdatedAt}
          onClose={() => handleModalClose(modal)}
        />
      )}
    </section>
  );
}
