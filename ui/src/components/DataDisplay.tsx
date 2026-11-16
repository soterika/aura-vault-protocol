import type { HTMLAttributes, ReactNode } from "react";

/* ── Alert ────────────────────────────────────────────────────────── */
export type AlertVariant = "info" | "success" | "warning" | "error";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
}

/** Alert/notification box with semantic HTML. */
export function Alert({
  variant = "info",
  title,
  dismissible = false,
  onDismiss,
  className = "",
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role="alert"
      className={`ds-alert ds-alert--${variant} ${className}`}
      {...props}
    >
      <div className="ds-alert__content">
        {title && <h3 className="ds-alert__title">{title}</h3>}
        <div className="ds-alert__message">{children}</div>
      </div>
      {dismissible && (
        <button
          className="ds-alert__close"
          aria-label="Dismiss alert"
          onClick={onDismiss}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/* ── Progress ─────────────────────────────────────────────────────── */
export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  showLabel?: boolean;
  animated?: boolean;
}

/** Progress bar for indicating completion. */
export function Progress({
  value,
  max = 100,
  showLabel = false,
  animated = true,
  className = "",
  ...props
}: ProgressProps) {
  const percentage = Math.min((value / max) * 100, 100);

  return (
    <div className={`ds-progress ${className}`} {...props}>
      <div
        className={`ds-progress__bar ${animated ? "ds-progress--animated" : ""}`}
        style={{ width: `${percentage}%` }}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      />
      {showLabel && (
        <span className="ds-progress__label">{Math.round(percentage)}%</span>
      )}
    </div>
  );
}

/* ── Skeleton ──────────────────────────────────────────────────────── */
export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string;
  height?: string;
  circle?: boolean;
  count?: number;
}

/** Loading placeholder skeleton. */
export function Skeleton({
  width = "100%",
  height = "20px",
  circle = false,
  count = 1,
  className = "",
  style,
  ...props
}: SkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`ds-skeleton ${circle ? "ds-skeleton--circle" : ""} ${className}`}
          style={{
            width,
            height,
            borderRadius: circle ? "50%" : "4px",
            marginBottom: i < count - 1 ? "8px" : 0,
            ...style,
          }}
          aria-busy="true"
          {...props}
        />
      ))}
    </>
  );
}

/* ── Badge ────────────────────────────────────────────────────────── */
export type BadgeVariant = "default" | "primary" | "success" | "warning" | "error" | "info";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

/** Inline status label. Uses role="status" for screen readers. */
export function Badge({
  variant = "default",
  className = "",
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={`ds-badge ds-badge--${variant} ${className}`}
      role="status"
      {...props}
    >
      {children}
    </span>
  );
}

/* ── Spinner ──────────────────────────────────────────────────────── */
export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  label?: string;
}

/** Accessible loading spinner with configurable size. */
export function Spinner({
  size = "md",
  label = "Loading…",
  className = "",
  ...props
}: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`ds-spinner ds-spinner--${size} ${className}`}
      {...props}
    >
      <span className="ds-spinner__ring" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/* ── Badge Count ──────────────────────────────────────────────────── */
export interface BadgeCountProps {
  count: number;
  max?: number;
}

/** Badge showing count with max overflow. */
export function BadgeCount({ count, max = 99 }: BadgeCountProps) {
  const display = count > max ? `${max}+` : count.toString();
  return (
    <Badge variant="error">
      {display}
    </Badge>
  );
}

/* ── Tag List ──────────────────────────────────────────────────────── */
export interface TagListProps {
  tags: string[];
  onRemove?: (tag: string) => void;
  readonly?: boolean;
}

/** List of removable tags. */
export function TagList({ tags, onRemove, readonly = false }: TagListProps) {
  return (
    <div className="ds-tag-list" role="list">
      {tags.map((tag) => (
        <div key={tag} className="ds-tag" role="listitem">
          <span>{tag}</span>
          {!readonly && onRemove && (
            <button
              className="ds-tag__remove"
              aria-label={`Remove ${tag}`}
              onClick={() => onRemove(tag)}
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Stat Card ────────────────────────────────────────────────────── */
export interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
}

/** Display a statistic with optional trend. */
export function StatCard({
  label,
  value,
  unit,
  trend,
  trendValue,
}: StatCardProps) {
  return (
    <div className="ds-stat-card">
      <div className="ds-stat-card__label">{label}</div>
      <div className="ds-stat-card__value">
        {value}
        {unit && <span className="ds-stat-card__unit">{unit}</span>}
      </div>
      {trend && (
        <div className={`ds-stat-card__trend ds-stat-card__trend--${trend}`}>
          {trend === "up" && "↑"}
          {trend === "down" && "↓"}
          {trendValue && <span>{trendValue}</span>}
        </div>
      )}
    </div>
  );
}

/* ── Empty State ──────────────────────────────────────────────────── */
export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

/** Display when no data is available. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="ds-empty-state" role="status">
      {icon && <div className="ds-empty-state__icon">{icon}</div>}
      <h3 className="ds-empty-state__title">{title}</h3>
      {description && (
        <p className="ds-empty-state__description">{description}</p>
      )}
      {action && <div className="ds-empty-state__action">{action}</div>}
    </div>
  );
}
