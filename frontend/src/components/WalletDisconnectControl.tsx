"use client";

import { useEffect, useRef, useState } from "react";

export function WalletDisconnectControl({ address, onConfirm }: { address: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      if (event.key === "Tab") {
        const first = cancelRef.current;
        const last = confirmRef.current;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return <>
    <button data-testid="disconnect-wallet-btn" type="button" onClick={() => setOpen(true)} className="mt-1 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Disconnect</button>
    {open && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="disconnect-title" aria-describedby="disconnect-warning" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900">
        <h2 id="disconnect-title" className="text-lg font-semibold">Disconnect wallet?</h2>
        <p className="mt-2 text-sm text-zinc-500">{address}</p>
        <p id="disconnect-warning" className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Your wallet session will end. Any pending actions will be cancelled.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={() => setOpen(false)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">Cancel</button>
          <button ref={confirmRef} type="button" onClick={() => { setOpen(false); onConfirm(); }} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white">Confirm Disconnect</button>
        </div>
      </section>
    </div>}
  </>;
}
