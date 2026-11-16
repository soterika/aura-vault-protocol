/**
 * Next.js instrumentation hook — called for every page navigation.
 * Forwards Core Web Vitals to the /api/metrics/vitals endpoint.
 *
 * This file must live at `src/app/` (or root of the Next.js project)
 * and export a `reportWebVitals` function that Next.js calls automatically.
 *
 * @see https://nextjs.org/docs/pages/building-your-application/optimizing/analytics
 */
import { sendWebVitals } from "@/lib/webVitals";
import type { NextWebVitalsMetric } from "next/app";

/**
 * Called by Next.js for each Core Web Vitals metric.
 * Receives: LCP, FID, CLS, FCP, TTFB, and the custom Next.js metrics
 * (Next.js-hydration, Next.js-route-change-to-render, Next.js-render).
 */
export function reportWebVitals(metric: NextWebVitalsMetric): void {
  // Only forward standard CWV + custom Next.js metrics to the ingest endpoint
  sendWebVitals({
    name: metric.name,
    value: metric.value,
    id: metric.id,
    navigationType: metric.startMark ?? "navigate",
  });
}
