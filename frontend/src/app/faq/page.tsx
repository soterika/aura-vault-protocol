import type { Metadata } from "next";
import dynamic from "next/dynamic";

export const metadata: Metadata = {
  title: "FAQ — Aura Vault Protocol",
  description:
    "Frequently asked questions about Aura Vault Protocol: deposits, withdrawals, yield, security, and more.",
};

// Code-split route with dynamic import to satisfy bundle budget (<200KB initial JS)
const FAQPage = dynamic(() => import("@/components/FAQPage"), {
  loading: () => <div className="mx-auto max-w-3xl px-4 py-12 animate-pulse" />,
  ssr: true,
});

export default function FAQ() {
  return <FAQPage />;
}
