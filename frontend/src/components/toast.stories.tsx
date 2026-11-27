import React from "react";
import { ToastProvider, useToast } from "./toast";

const meta = {
  title: "Components/Toast",
  component: ToastProvider,
};

export default meta;

function ToastDemoButtons() {
  const toast = useToast();

  return (
    <div className="flex flex-wrap gap-3 p-6">
      <button
        type="button"
        onClick={() =>
          toast.success(
            "Deposit Confirmed",
            "100.00 USDC deposited into Aura Vault.",
            "https://stellar.expert/explorer/testnet",
          )
        }
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Trigger Success Toast
      </button>

      <button
        type="button"
        onClick={() =>
          toast.error(
            "Transaction Failed",
            "Insufficient balance to complete this operation.",
          )
        }
        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
      >
        Trigger Error Toast
      </button>

      <button
        type="button"
        onClick={() =>
          toast.warning(
            "High Network Congestion",
            "Stellar Horizon fees are slightly elevated.",
          )
        }
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
      >
        Trigger Warning Toast
      </button>

      <button
        type="button"
        onClick={() =>
          toast.info(
            "Transaction Submitted",
            "Waiting for Stellar Horizon confirmation...",
          )
        }
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Trigger Info Toast
      </button>
    </div>
  );
}

export const AllToastTypes = () => (
  <ToastProvider>
    <ToastDemoButtons />
  </ToastProvider>
);
