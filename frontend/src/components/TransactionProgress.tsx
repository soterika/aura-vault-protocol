"use client";

const STEPS = [
  "Approve token allowance (if needed)",
  "Sign transaction",
  "Broadcast to Stellar",
  "Wait for ledger confirmation",
  "Update share balance",
];

export default function TransactionProgress({ status, currentStep, onRetry }: {
  status: "pending" | "success" | "error";
  currentStep: number;
  onRetry: () => void;
}) {
  return (
    <div className="mb-5 space-y-3" aria-live="polite" aria-atomic="false">
      <ol aria-label="Transaction progress" className="space-y-2">
        {STEPS.map((label, index) => {
          const skipped = index === 0;
          const failed = status === "error" && index === currentStep;
          const done = status === "success" || (!skipped && index < currentStep);
          const current = status === "pending" && index === currentStep;
          return <li key={label} className="flex items-center gap-2 text-sm" aria-current={current ? "step" : undefined}>
            <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${failed ? "border-red-600 bg-red-600 text-white" : done ? "border-emerald-600 bg-emerald-600 text-white" : current ? "border-indigo-600 text-indigo-700 ring-2 ring-indigo-300" : "border-zinc-400 text-zinc-500"}`}>
              {failed ? "×" : done ? "✓" : skipped ? "–" : index + 1}
            </span>
            <span className={failed ? "text-red-700 dark:text-red-300" : current ? "font-semibold text-indigo-700 dark:text-indigo-300" : "text-zinc-600 dark:text-zinc-300"}>
              {label}{skipped && <span className="ml-1 text-xs text-zinc-500">(not required for this Stellar transaction)</span>}
            </span>
          </li>;
        })}
      </ol>
      {status === "error" && <button type="button" onClick={onRetry} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white">Retry failed step</button>}
      <p className="sr-only" role="status">{status === "success" ? "Transaction complete. Share balance updated." : status === "error" ? `Transaction failed at step ${currentStep + 1}. Retry is available.` : `Transaction in progress: ${STEPS[currentStep]}.`}</p>
    </div>
  );
}
