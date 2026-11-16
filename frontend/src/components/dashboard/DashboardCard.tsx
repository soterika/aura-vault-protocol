"use client";

import React from "react";
import { clsx } from "clsx";

export type CardVariant = "default" | "hero" | "accent";

export interface DashboardCardProps {
  /** Optional heading rendered inside the card header area */
  title?: string;
  /** Optional sub-label rendered beneath the title */
  subtitle?: React.ReactNode;
  /** Visual hierarchy variant */
  variant?: CardVariant;
  /** Additional className forwarded to the root element */
  className?: string;
  /** data-testid for automated tests */
  "data-testid"?: string;
  /** Card body content */
  children: React.ReactNode;
}

/**
 * DashboardCard — base card primitive for the redesigned vault dashboard.
 *
 * Design tokens used:
 *   --shadow-sm / --shadow-md / --shadow-lg  (elevation)
 *   --radius-lg / --radius-xl               (border-radius)
 *   --color-surface / --color-surface-raised (backgrounds)
 *   --color-border                           (borders)
 *
 * The component is intentionally presentational; data fetching lives in
 * the specialised card wrappers (HeroCard, MetricCard, UserPositionCard).
 */
export function DashboardCard({
  title,
  subtitle,
  variant = "default",
  className,
  "data-testid": testId,
  children,
}: DashboardCardProps) {
  return (
    <article
      data-testid={testId}
      style={
        {
          // Use design-token CSS custom properties so the card honours both
          // light and dark themes without Tailwind overrides.
          "--card-shadow":
            variant === "hero"
              ? "var(--shadow-lg)"
              : variant === "accent"
              ? "var(--shadow-md)"
              : "var(--shadow-sm)",
          "--card-radius":
            variant === "hero" ? "var(--radius-xl)" : "var(--radius-lg)",
        } as React.CSSProperties
      }
      className={clsx(
        // Base structure
        "flex flex-col gap-3 p-6",
        // Design tokens via inline CSS vars (see style prop above)
        "[box-shadow:var(--card-shadow)] [border-radius:var(--card-radius)]",
        // Background + border mapped to tokens
        "bg-[var(--color-surface)] border border-[var(--color-border)]",
        // Hero gets a subtle top-border accent using primary colour
        variant === "hero" &&
          "border-t-2 border-t-[var(--color-primary)] bg-[var(--color-surface-raised)]",
        // Accent cards get a slightly elevated background
        variant === "accent" && "bg-[var(--color-surface-raised)]",
        // Transition for theme changes
        "transition-shadow duration-[var(--transition-base,250ms)]",
        className
      )}
    >
      {(title || subtitle) && (
        <header className="flex flex-col gap-0.5">
          {title && (
            <h2 className="text-[length:var(--text-xs)] font-[var(--font-semibold)] uppercase tracking-widest text-[var(--color-text-muted)]">
              {title}
            </h2>
          )}
          {subtitle && (
            <p className="text-[length:var(--text-xs)] text-[var(--color-text-disabled)]">
              {subtitle}
            </p>
          )}
        </header>
      )}
      <div className="flex flex-col gap-1">{children}</div>
    </article>
  );
}
