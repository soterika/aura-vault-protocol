import type { HTMLAttributes, ReactNode } from "react";

/* ── Card ────────────────────────────────────────────────────────── */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: "sm" | "md" | "lg";
  elevated?: boolean;
}

/** Surface container with optional elevation and padding sizes. */
export function Card({ padding = "md", elevated = false, className = "", children, ...props }: CardProps) {
  return (
    <div
      className={`ds-card ds-card--pad-${padding}${elevated ? " ds-card--elevated" : ""} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── Badge ───────────────────────────────────────────────────────── */
export type BadgeVariant = "default" | "primary" | "success" | "warning" | "error" | "info";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

/** Inline status label. Uses role="status" for screen readers. */
export function Badge({ variant = "default", children }: BadgeProps) {
  return (
    <span className={`ds-badge ds-badge--${variant}`} role="status">
      {children}
    </span>
  );
}

/* ── Spinner ─────────────────────────────────────────────────────── */
export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps {
  size?: SpinnerSize;
  label?: string;
}

/** Accessible loading spinner with configurable size. */
export function Spinner({ size = "md", label = "Loading…" }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className={`ds-spinner ds-spinner--${size}`}>
      <span className="ds-spinner__ring" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/* ── Divider ─────────────────────────────────────────────────────── */
export interface DividerProps {
  label?: string;
  orientation?: "horizontal" | "vertical";
}

/** Semantic separator, optionally labelled. */
export function Divider({ label, orientation = "horizontal" }: DividerProps) {
  if (orientation === "vertical") {
    return <div className="ds-divider ds-divider--vertical" role="separator" aria-orientation="vertical" />;
  }
  return (
    <div className="ds-divider ds-divider--horizontal" role={label ? undefined : "separator"} aria-label={label}>
      {label && (
        <>
          <span className="ds-divider__line" aria-hidden="true" />
          <span className="ds-divider__label">{label}</span>
          <span className="ds-divider__line" aria-hidden="true" />
        </>
      )}
      {!label && <span className="ds-divider__line" aria-hidden="true" />}
    </div>
  );
}

/* ── Avatar ──────────────────────────────────────────────────────── */
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface AvatarProps {
  src?: string;
  alt?: string;
  name?: string;  // used to generate initials when no src
  size?: AvatarSize;
}

function initials(name: string) {
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

const avatarSizePx: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
};

/** User avatar: shows image when available, falls back to initials. */
export function Avatar({ src, alt, name, size = "md" }: AvatarProps) {
  const px = avatarSizePx[size];
  return (
    <div className={`ds-avatar ds-avatar--${size}`} aria-label={alt ?? name ?? "Avatar"}>
      {src
        ? <img src={src} alt={alt ?? name ?? ""} width={px} height={px} loading="lazy" className="ds-avatar__img" />
        : <span className="ds-avatar__initials" aria-hidden="true">{name ? initials(name) : "?"}</span>
      }
    </div>
  );
}
