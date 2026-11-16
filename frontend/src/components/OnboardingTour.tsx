"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";

const TOUR_STORAGE_KEY = "aura_tour_completed";

interface TourStep {
  id: string;
  title: string;
  description: string;
  /** CSS selector of the element to spotlight */
  targetSelector?: string;
  /** Which side of the target the tooltip appears on */
  placement?: "center" | "top" | "bottom";
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "connect-wallet",
    title: "Step 1: Connect Your Wallet",
    description:
      "Start by connecting a Stellar wallet (Freighter, MetaMask, or Coinbase Wallet). Your wallet lets you deposit, withdraw, and harvest yield from the vault.",
    targetSelector: "[data-cy='connect-wallet-btn']",
    placement: "bottom",
  },
  {
    id: "view-stats",
    title: "Step 2: View Vault Stats",
    description:
      "The stats panel shows the Total Value Locked (TVL), annual percentage yield (APY), your personal balance, and your vault shares — all updated in real time.",
    targetSelector: "[data-cy='stat-tvl']",
    placement: "bottom",
  },
  {
    id: "deposit",
    title: "Step 3: Make a Deposit",
    description:
      "Deposit underlying tokens (e.g. USDC) to receive vault shares proportional to your contribution. The first deposit uses a 1:1 seed ratio; subsequent deposits follow the share price formula.",
    targetSelector: "[data-cy='deposit-btn']",
    placement: "bottom",
  },
  {
    id: "portfolio",
    title: "Step 4: Track Your Portfolio",
    description:
      "The portfolio section displays your share balance and real-time value. As yield accumulates and is harvested, the share price rises — so your tokens are worth more over time.",
    targetSelector: "[data-cy='portfolio-section']",
    placement: "top",
  },
  {
    id: "harvest",
    title: "Step 5: Harvest Yield",
    description:
      "Any keeper can inject yield into the vault via the Harvest action. Yield is distributed proportionally to all shareholders by increasing the share price — no new shares are minted.",
    targetSelector: "[data-cy='harvest-btn']",
    placement: "top",
  },
];

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function useSpotlight(selector?: string): SpotlightRect | null {
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  useEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    const el = document.querySelector(selector);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top + window.scrollY,
      left: r.left + window.scrollX,
      width: r.width,
      height: r.height,
    });

    function onResize() {
      const updated = el!.getBoundingClientRect();
      setRect({
        top: updated.top + window.scrollY,
        left: updated.left + window.scrollX,
        width: updated.width,
        height: updated.height,
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [selector]);

  return rect;
}

interface TooltipPosition {
  top: number;
  left: number;
}

function computeTooltipPos(
  spotlight: SpotlightRect | null,
  placement: TourStep["placement"] = "center",
  viewportWidth: number,
  viewportHeight: number
): TooltipPosition {
  const tooltipW = 340;
  const tooltipH = 200;
  const gap = 16;

  if (!spotlight) {
    return {
      top: (viewportHeight - tooltipH) / 2 + window.scrollY,
      left: (viewportWidth - tooltipW) / 2,
    };
  }

  const centerX = spotlight.left + spotlight.width / 2;
  const left = Math.max(8, Math.min(centerX - tooltipW / 2, viewportWidth - tooltipW - 8));

  if (placement === "bottom") {
    return { top: spotlight.top + spotlight.height + gap, left };
  }
  return { top: spotlight.top - tooltipH - gap, left };
}

export interface OnboardingTourProps {
  onComplete?: () => void;
}

export function OnboardingTour({ onComplete }: OnboardingTourProps) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 });
  const nextBtnRef = useRef<HTMLButtonElement>(null);

  const currentStep = TOUR_STEPS[stepIndex];
  const spotlight = useSpotlight(active ? currentStep?.targetSelector : undefined);

  useEffect(() => {
    function update() {
      setVpSize({ w: window.innerWidth, h: window.innerHeight });
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Auto-start on first visit
  useEffect(() => {
    if (typeof window === "undefined") return;
    const done = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!done) {
      const t = setTimeout(() => setActive(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  // Focus "Next" button for keyboard navigation
  useEffect(() => {
    if (active) nextBtnRef.current?.focus();
  }, [active, stepIndex]);

  // Scroll target into view
  useEffect(() => {
    if (!active || !currentStep?.targetSelector) return;
    const el = document.querySelector(currentStep.targetSelector);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, stepIndex, currentStep?.targetSelector]);

  const complete = useCallback(() => {
    localStorage.setItem(TOUR_STORAGE_KEY, "true");
    setActive(false);
    setStepIndex(0);
    onComplete?.();
  }, [onComplete]);

  const next = useCallback(() => {
    if (stepIndex < TOUR_STEPS.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      complete();
    }
  }, [stepIndex, complete]);

  const prev = useCallback(() => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  }, [stepIndex]);

  // Dismiss on Escape
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") complete();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, complete]);

  if (!active) return null;

  const PADDING = 8;
  const tooltipPos = computeTooltipPos(spotlight, currentStep?.placement, vpSize.w, vpSize.h);

  return (
    <>
      {/* Screen-reader live region */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {`Step ${stepIndex + 1} of ${TOUR_STEPS.length}: ${currentStep?.title}`}
      </div>

      {/* Dark backdrop */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[9998] bg-black/60"
        onClick={complete}
      />

      {/* Spotlight ring */}
      {spotlight && (
        <div
          aria-hidden="true"
          className="absolute z-[9999] rounded-lg ring-2 ring-indigo-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]"
          style={{
            top: spotlight.top - PADDING,
            left: spotlight.left - PADDING,
            width: spotlight.width + PADDING * 2,
            height: spotlight.height + PADDING * 2,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Onboarding tour: ${currentStep?.title}`}
        aria-describedby="tour-description"
        className="absolute z-[10000] w-[340px] rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl border border-zinc-200 dark:border-zinc-700 p-5 flex flex-col gap-4"
        style={{ top: tooltipPos.top, left: tooltipPos.left }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
              {stepIndex + 1} / {TOUR_STEPS.length}
            </span>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50 leading-snug mt-0.5">
              {currentStep?.title}
            </h2>
          </div>
          <button
            onClick={complete}
            aria-label="Skip tour"
            className="shrink-0 rounded-lg p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Description */}
        <p id="tour-description" className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
          {currentStep?.description}
        </p>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5" role="list" aria-label="Tour progress">
          {TOUR_STEPS.map((s, i) => (
            <div
              key={s.id}
              role="listitem"
              aria-label={`Step ${i + 1}${i === stepIndex ? " (current)" : i < stepIndex ? " (completed)" : ""}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === stepIndex
                  ? "w-5 bg-indigo-600 dark:bg-indigo-400"
                  : i < stepIndex
                  ? "w-1.5 bg-indigo-300 dark:bg-indigo-700"
                  : "w-1.5 bg-zinc-200 dark:bg-zinc-700"
              }`}
            />
          ))}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={complete}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline transition-colors"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                onClick={prev}
                aria-label="Previous step"
                className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <ChevronLeft size={14} />
                Back
              </button>
            )}
            <button
              ref={nextBtnRef}
              onClick={next}
              aria-label={stepIndex < TOUR_STEPS.length - 1 ? "Next step" : "Finish tour"}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              {stepIndex < TOUR_STEPS.length - 1 ? (
                <>Next <ChevronRight size={14} /></>
              ) : (
                "Finish"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Returns a function that clears the tour-completed flag and returns to the
 * home page so the tour auto-starts again.
 */
export function useRestartTour(): () => void {
  return useCallback(() => {
    localStorage.removeItem(TOUR_STORAGE_KEY);
    window.location.href = "/";
  }, []);
}
