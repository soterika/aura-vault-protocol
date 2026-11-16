import type { HTMLAttributes, ReactNode } from "react";

/* ── Stack ────────────────────────────────────────────────────────── */
export type StackDirection = "horizontal" | "vertical";
export type StackGap = "xs" | "sm" | "md" | "lg" | "xl";

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  direction?: StackDirection;
  gap?: StackGap;
  alignItems?: string;
  justifyContent?: string;
  wrap?: boolean;
}

/** Flexbox container for stacking items with consistent spacing. */
export function Stack({
  direction = "vertical",
  gap = "md",
  alignItems,
  justifyContent,
  wrap = false,
  className = "",
  style,
  ...props
}: StackProps) {
  const isHorizontal = direction === "horizontal";
  const gapValue = `var(--space-${gap === "xs" ? 1 : gap === "sm" ? 2 : gap === "md" ? 4 : gap === "lg" ? 6 : 8})`;

  return (
    <div
      className={`ds-stack ${className}`}
      style={{
        display: "flex",
        flexDirection: isHorizontal ? "row" : "column",
        gap: gapValue,
        alignItems,
        justifyContent,
        flexWrap: wrap ? "wrap" : "nowrap",
        ...style,
      }}
      {...props}
    />
  );
}

/* ── Grid ─────────────────────────────────────────────────────────── */
export type GridGap = "sm" | "md" | "lg" | "xl";

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  columns?: number | number[];
  gap?: GridGap;
  autoRows?: string;
}

/** CSS Grid container with responsive column support. */
export function Grid({
  columns = 1,
  gap = "md",
  autoRows,
  className = "",
  style,
  ...props
}: GridProps) {
  const gapValue = `var(--space-${gap === "sm" ? 2 : gap === "md" ? 4 : gap === "lg" ? 6 : 8})`;
  const columnsValue = Array.isArray(columns)
    ? `repeat(auto-fit, minmax(${100 / Math.max(...columns)}%, 1fr))`
    : `repeat(${columns}, 1fr)`;

  return (
    <div
      className={`ds-grid ${className}`}
      style={{
        display: "grid",
        gridTemplateColumns: columnsValue,
        gap: gapValue,
        gridAutoRows: autoRows,
        ...style,
      }}
      {...props}
    />
  );
}

/* ── Flex ─────────────────────────────────────────────────────────── */
export interface FlexProps extends HTMLAttributes<HTMLDivElement> {
  direction?: "row" | "column";
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
  wrap?: boolean;
}

/** Flex container for layout control. */
export function Flex({
  direction = "row",
  justifyContent,
  alignItems,
  gap,
  wrap,
  className = "",
  style,
  ...props
}: FlexProps) {
  return (
    <div
      className={`ds-flex ${className}`}
      style={{
        display: "flex",
        flexDirection: direction,
        justifyContent,
        alignItems,
        gap,
        flexWrap: wrap ? "wrap" : "nowrap",
        ...style,
      }}
      {...props}
    />
  );
}

/* ── Container ────────────────────────────────────────────────────── */
export type ContainerSize = "sm" | "md" | "lg" | "xl";

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  size?: ContainerSize;
  padding?: boolean;
  centered?: boolean;
}

/** Constrained width container for responsive layouts. */
export function Container({
  size = "lg",
  padding = false,
  centered = true,
  className = "",
  style,
  ...props
}: ContainerProps) {
  const maxWidths: Record<ContainerSize, string> = {
    sm: "640px",
    md: "768px",
    lg: "1024px",
    xl: "1280px",
  };

  return (
    <div
      className={`ds-container ${className}`}
      style={{
        maxWidth: maxWidths[size],
        margin: centered ? "0 auto" : "0",
        padding: padding ? "var(--space-4)" : "0",
        width: "100%",
        ...style,
      }}
      {...props}
    />
  );
}

/* ── Spacer ───────────────────────────────────────────────────────── */
export type SpacerSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface SpacerProps {
  size?: SpacerSize;
  horizontal?: boolean;
}

/** Invisible spacing element. */
export function Spacer({ size = "md", horizontal = false }: SpacerProps) {
  const sizes: Record<SpacerSize, string> = {
    xs: "var(--space-1)",
    sm: "var(--space-2)",
    md: "var(--space-4)",
    lg: "var(--space-6)",
    xl: "var(--space-8)",
  };

  return (
    <div
      className="ds-spacer"
      style={
        horizontal
          ? { width: sizes[size], height: 0 }
          : { height: sizes[size], width: 0 }
      }
    />
  );
}
