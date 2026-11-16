"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { AnimatedShareBalance } from "./AnimatedShareBalance";

export default { title: "Aura Vault/Micro animations" };

export function ShareBalance() {
  const [value, setValue] = useState("128.75");
  return <div><AnimatedShareBalance value={value} /><button onClick={() => setValue((Number(value) + 1.25).toFixed(2))}>Update balance</button></div>;
}

export function ApyChange() {
  const [apy, setApy] = useState(8.42);
  return <div><span key={apy} className="animate-value-change">{apy.toFixed(2)}%</span><button onClick={() => setApy((value) => value + 0.1)}>Update APY</button></div>;
}

export function DepositConfirmed() {
  return <p className="flex items-center gap-2"><CheckCircle2 className="animate-success-check text-emerald-600" /> Deposit confirmed</p>;
}

export function ToastAppears() {
  return <div className="animate-toast-in rounded-lg bg-zinc-900 p-3 text-white">Transaction updated</div>;
}

export function RouteEnters() {
  return <main className="page-transition rounded-lg border p-4">Route content fades in and moves up by a few pixels.</main>;
}
