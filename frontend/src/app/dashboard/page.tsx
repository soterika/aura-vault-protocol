"use client";

import ApyCalculator from "@/components/ApyCalculator";
import dynamic from "next/dynamic";
import CollapsibleSection from "@/components/CollapsibleSection";

/**
 * /dashboard — main vault overview page.
 *
 * Issue #498: uses SortableDashboardGrid which supports:
 *  - Drag-and-drop widget reordering (@dnd-kit/sortable)
 *  - Keyboard reordering (arrow keys on grip handle)
 *  - Widget visibility controlled from /settings
 *  - Layout persisted to localStorage
 *  - Smooth 60fps drag animation via CSS transform + DragOverlay
 * Issue #261: APY Calculator added below PerformanceCharts.
 * Code-split routes with dynamic imports to enforce bundle size budgets.
 */
const DashboardGrid = dynamic(
  () => import("@/components/dashboard/DashboardGrid").then((mod) => mod.DashboardGrid),
  {
    loading: () => (
      <div className="h-96 w-full animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
    ),
    ssr: true,
  }
);

const PerformanceCharts = dynamic(
  () => import("@/components/PerformanceCharts"),
  {
    loading: () => (
      <div className="h-72 w-full animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
    ),
    ssr: false, // Charts are client-side canvas visualization
  }
);

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <CollapsibleSection id="vault-stats" title="Vault Stats">
        <DashboardGrid />
      </CollapsibleSection>
      <CollapsibleSection id="apy-chart" title="APY Chart">
        <PerformanceCharts />
      </CollapsibleSection>

      {/* APY Calculator — issue #261 */}
      <div className="mx-auto w-full max-w-4xl px-4 pb-8">
        <ApyCalculator />
      </div>
    </div>
  );
}
