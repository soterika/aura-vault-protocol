"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle, Circle, X, ChevronDown, ChevronUp } from "lucide-react";
// ─── Types ───────────────────────────────────────────────────────────────────
export type ChecklistItemId =
  | "connect_wallet"
  | "view_dashboard"
  | "make_first_deposit"
  | "earn_first_yield";
interface ChecklistItem {
  id: ChecklistItemId;
  label: string;
  description: string;
}
const CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    id: "connect_wallet",
    label: "Connect Wallet",
    description: "Link your Stellar wallet to get started.",
  },
    id: "view_dashboard",
    label: "View Dashboard",
    description: "Explore your vault position and stats.",
    id: "make_first_deposit",
    label: "Make First Deposit",
    description: "Deposit tokens to receive vault shares.",
    id: "earn_first_yield",
    label: "Earn First Yield",
    description: "Let your shares accrue yield over time.",
];
// ─── Storage helpers ─────────────────────────────────────────────────────────
function storageKey(walletAddress: string | null): string {
  return walletAddress
    ? `aura_onboarding_${walletAddress}`
    : "aura_onboarding_anonymous";
function loadProgress(walletAddress: string | null): Set<ChecklistItemId> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(storageKey(walletAddress));
    if (!raw) return new Set();
    const parsed: ChecklistItemId[] = JSON.parse(raw);
    return new Set(parsed);
  } catch {
    return new Set();
  }
function saveProgress(
  walletAddress: string | null,
  completed: Set<ChecklistItemId>
): void {
    localStorage.setItem(
      storageKey(walletAddress),
      JSON.stringify(Array.from(completed))
    );
    // localStorage not available (SSR / private browsing)
function loadDismissed(walletAddress: string | null): boolean {
  if (typeof window === "undefined") return false;
    return localStorage.getItem(`${storageKey(walletAddress)}_dismissed`) === "true";
    return false;
function saveDismissed(walletAddress: string | null): void {
    localStorage.setItem(`${storageKey(walletAddress)}_dismissed`, "true");
    // noop
// ─── Context / hook ──────────────────────────────────────────────────────────
import { createContext, useContext, type ReactNode } from "react";
interface OnboardingContextValue {
  markComplete: (id: ChecklistItemId) => void;
const OnboardingContext = createContext<OnboardingContextValue | null>(null);
export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingChecklist");
  return ctx;
// ─── Component ───────────────────────────────────────────────────────────────
interface OnboardingChecklistProps {
  /** Current wallet address; used to namespace localStorage key. */
  walletAddress?: string | null;
  children?: ReactNode;
export function OnboardingChecklist({
  walletAddress = null,
  children,
}: OnboardingChecklistProps) {
  const [completed, setCompleted] = useState<Set<ChecklistItemId>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Hydrate from localStorage after mount (SSR-safe)
  useEffect(() => {
    setCompleted(loadProgress(walletAddress));
    setDismissed(loadDismissed(walletAddress));
    setMounted(true);
  }, [walletAddress]);
  const markComplete = useCallback(
    (id: ChecklistItemId) => {
      setCompleted((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        saveProgress(walletAddress, next);
        return next;
      });
    },
    [walletAddress]
  );
  const handleDismiss = useCallback(() => {
    setDismissed(true);
    saveDismissed(walletAddress);
  const completedCount = completed.size;
  const totalCount = CHECKLIST_ITEMS.length;
  const allDone = completedCount === totalCount;
  const progressPct = Math.round((completedCount / totalCount) * 100);
  // Hide if dismissed or not yet mounted (avoids hydration flash)
  if (!mounted || dismissed) {
    return (
      <OnboardingContext.Provider value={{ markComplete }}>
        {children}
      </OnboardingContext.Provider>
import { createContext, useContext, useCallback } from "react";
type MilestoneId = string;
  markComplete: (id: MilestoneId) => void;
const OnboardingContext = createContext<OnboardingContextValue>({
  markComplete: () => {},
});
  return useContext(OnboardingContext);
export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const markComplete = useCallback((id: MilestoneId) => {
    // Persist milestone completion to localStorage
    try {
      const key = `aura_onboarding_${id}`;
      localStorage.setItem(key, "true");
    } catch {
      // Ignore storage errors
    }
  }, []);
  return (
    <OnboardingContext.Provider value={{ markComplete }}>
      {children}
      {/* Floating checklist card */}
      <div
        role="complementary"
        aria-label="Onboarding checklist"
        className="fixed bottom-6 right-6 z-40 w-72 rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 transition-all"
        data-cy="onboarding-checklist"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Getting Started
            </span>
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              {completedCount}/{totalCount}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="rounded p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
              aria-label={collapsed ? "Expand checklist" : "Collapse checklist"}
            >
              {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {allDone && (
              <button
                onClick={handleDismiss}
                className="rounded p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                aria-label="Dismiss onboarding checklist"
                data-cy="onboarding-dismiss"
              >
                <X size={16} />
              </button>
            )}
        </div>
        {/* Progress bar */}
        <div className="px-4 pt-3">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${progressPct}% complete`}
          >
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          <p className="mt-1 text-right text-xs text-zinc-400">{progressPct}% complete</p>
        {/* Items */}
        {!collapsed && (
          <ul className="divide-y divide-zinc-50 px-2 pb-3 dark:divide-zinc-800" role="list">
            {CHECKLIST_ITEMS.map((item) => {
              const done = completed.has(item.id);
              return (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-lg px-2 py-2.5"
                  data-cy={`checklist-item-${item.id}`}
                >
                  <span
                    className={`mt-0.5 shrink-0 ${
                      done
                        ? "text-emerald-500 dark:text-emerald-400"
                        : "text-zinc-300 dark:text-zinc-600"
                    }`}
                    aria-hidden="true"
                  >
                    {done ? <CheckCircle size={18} /> : <Circle size={18} />}
                  </span>
                  <div className="min-w-0">
                    <p
                      className={`text-sm font-medium leading-tight ${
                        done
                          ? "text-zinc-400 line-through dark:text-zinc-500"
                          : "text-zinc-800 dark:text-zinc-200"
                      }`}
                    >
                      {item.label}
                    </p>
                    {!done && (
                      <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                        {item.description}
                      </p>
                    )}
                  </div>
                  {done && (
                    <span className="sr-only">completed</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {/* All done banner */}
        {allDone && !collapsed && (
          <div className="mx-4 mb-4 rounded-xl bg-emerald-50 px-3 py-2.5 dark:bg-emerald-950/40">
            <p className="text-center text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              🎉 You're all set! Dismiss when ready.
            </p>
      </div>
    </OnboardingContext.Provider>
// Stub for OnboardingChecklist — full implementation tracked in a separate issue.
export type OnboardingMilestone =
  | "make_first_deposit";
export function useOnboarding() {
  return {
    markComplete: (_milestone: OnboardingMilestone) => {},
    completedMilestones: [] as OnboardingMilestone[],
  };
}
