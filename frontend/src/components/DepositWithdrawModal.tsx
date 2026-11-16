"use client";

import { useState, useCallback, useId } from "react";
import { X } from "lucide-react";
import AmountSlider from "./AmountSlider";

type ModalMode = "deposit" | "withdraw";

interface DepositWithdrawModalProps {
  mode: ModalMode;
  /** Available balance in token units */
  available: number;
  /** Token symbol */
  symbol?: string;
  onClose: () => void;
  onSubmit: (amount: number) => void;
}

export default function DepositWithdrawModal({
  mode,
  available,
  symbol = "USDC",
  onClose,
  onSubmit,
}: DepositWithdrawModalProps) {
  const inputId = useId();
  const [amount, setAmount] = useState(0);
  const [inputValue, setInputValue] = useState("");

  // Sync text input → slider
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setInputValue(raw);
      const parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed >= 0) {
        setAmount(Math.min(Math.floor(parsed), available));
      } else {
        setAmount(0);
      }
    },
    [available]
  );

  // Sync slider → text input
  const handleSliderChange = useCallback((val: number) => {
    setAmount(val);
    setInputValue(val === 0 ? "" : String(val));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount > 0) onSubmit(amount);
  };

  const title = mode === "deposit" ? "Deposit" : "Withdraw";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dw-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 id="dw-modal-title" className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Text input */}
          <div>
            <label
              htmlFor={inputId}
              className="text-sm font-medium mb-1.5 block"
            >
              Amount ({symbol})
            </label>
            <div className="relative">
              <input
                id={inputId}
                type="number"
                min={0}
                max={available}
                step={1}
                value={inputValue}
                onChange={handleInputChange}
                placeholder={`0 – ${available.toLocaleString()}`}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2.5 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-describedby="dw-amount-hint"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 pointer-events-none">
                {symbol}
              </span>
            </div>
            <p
              id="dw-amount-hint"
              className="mt-1 text-xs text-zinc-400"
            >
              Available: {available.toLocaleString()} {symbol}
            </p>
          </div>

          {/* Slider — synced with text input */}
          <AmountSlider
            available={available}
            value={amount}
            onChange={handleSliderChange}
            symbol={symbol}
          />

          <button
            type="submit"
            disabled={amount <= 0}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {title}
            {amount > 0 ? ` ${amount.toLocaleString()} ${symbol}` : ""}
          </button>
        </form>
      </div>
    </div>
  );
}
