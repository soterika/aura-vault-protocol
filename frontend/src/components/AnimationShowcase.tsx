"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { AnimatedShareBalance } from "@/components/AnimatedShareBalance";

export default function AnimationShowcase() {
  const [value, setValue] = useState(42.75);
  const [visible, setVisible] = useState(false);
  return (
    <main className="page-transition mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Motion examples</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">These examples use the same short CSS and number transitions used in the vault interface. Reduced-motion preferences disable them.</p>
      <section className="rounded-xl border p-5" aria-label="Share balance animation example">
        <h2 className="font-semibold">Share balance</h2>
        <p className="mt-2 text-2xl"><AnimatedShareBalance value={String(value)} /></p>
        <button type="button" className="btn-interactive mt-3 rounded border px-3 py-2" onClick={() => setValue((current) => current + 3.25)}>Change balance</button>
      </section>
      <section className="rounded-xl border p-5" aria-label="APY animation example">
        <h2 className="font-semibold">APY value</h2>
        <p className="animate-value-change mt-2 text-2xl">8.42%</p>
      </section>
      <section className="rounded-xl border p-5" aria-label="Transaction confirmation animation example">
        <h2 className="font-semibold">Transaction confirmation</h2>
        {visible && <p role="status" className="mt-3 flex items-center gap-2"><CheckCircle2 className="animate-success-check text-emerald-600" /> Deposit confirmed</p>}
        <button type="button" className="btn-interactive mt-3 rounded border px-3 py-2" onClick={() => setVisible((current) => !current)}>Toggle confirmation</button>
      </section>
      <section className="rounded-xl border p-5" aria-label="Toast animation example">
        <h2 className="font-semibold">Toast entrance</h2>
        <div className="animate-toast-in mt-3 rounded-lg bg-zinc-900 p-3 text-white dark:bg-zinc-100 dark:text-zinc-900">Transaction updated</div>
      </section>
    </main>
  );
}
