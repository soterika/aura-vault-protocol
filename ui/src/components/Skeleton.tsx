import { useId } from "react";

interface Props {
  rows?: number;
}

interface CardSkeletonProps {
  cards?: number;
}

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

interface GraphSkeletonProps {
  bars?: number;
}

interface FormSkeletonProps {
  fields?: number;
}

/** Basic row-based skeleton */
export function Skeleton({ rows = 2 }: Props) {
  return (
    <div role="status" aria-label="Loading" aria-busy="true" className="skeleton-wrapper">
      <span className="sr-only">Loading content…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

/** Card grid skeleton — vault position cards, portfolio cards */
export function CardSkeleton({ cards = 3 }: CardSkeletonProps) {
  const id = useId();
  return (
    <div
      role="status"
      aria-label="Loading cards"
      aria-busy="true"
      className="skeleton-card-grid"
    >
      <span className="sr-only">Loading cards…</span>
      {Array.from({ length: cards }).map((_, i) => (
        <div key={`${id}-${i}`} className="skeleton-card">
          <div className="skeleton-card__header">
            <div className="skeleton-circle" />
            <div className="skeleton-row" style={{ width: "60%" }} />
          </div>
          <div className="skeleton-row skeleton-row--lg" />
          <div className="skeleton-row" style={{ width: "45%" }} />
          <div className="skeleton-card__footer">
            <div className="skeleton-row" style={{ width: "30%" }} />
            <div className="skeleton-row" style={{ width: "30%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Table skeleton — leaderboard, transaction history */
export function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  const id = useId();
  return (
    <div
      role="status"
      aria-label="Loading table"
      aria-busy="true"
      className="skeleton-table"
    >
      <span className="sr-only">Loading table data…</span>
      <div className="skeleton-table__head">
        {Array.from({ length: columns }).map((_, c) => (
          <div key={`${id}-h-${c}`} className="skeleton-row skeleton-row--sm" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={`${id}-r-${r}`} className="skeleton-table__row">
          {Array.from({ length: columns }).map((_, c) => (
            <div key={`${id}-r-${r}-c-${c}`} className="skeleton-row" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Chart / graph skeleton — yield charts, APY graphs */
export function GraphSkeleton({ bars = 7 }: GraphSkeletonProps) {
  const id = useId();
  const heights = [40, 65, 50, 80, 60, 90, 45];
  return (
    <div
      role="status"
      aria-label="Loading chart"
      aria-busy="true"
      className="skeleton-graph"
    >
      <span className="sr-only">Loading chart…</span>
      <div className="skeleton-graph__bars">
        {Array.from({ length: bars }).map((_, i) => (
          <div
            key={`${id}-bar-${i}`}
            className="skeleton-graph__bar"
            style={{ height: `${heights[i % heights.length]}%` }}
          />
        ))}
      </div>
      <div className="skeleton-graph__axis" />
    </div>
  );
}

/** Form skeleton — deposit/withdraw forms during load */
export function FormSkeleton({ fields = 2 }: FormSkeletonProps) {
  const id = useId();
  return (
    <div
      role="status"
      aria-label="Loading form"
      aria-busy="true"
      className="skeleton-form"
    >
      <span className="sr-only">Loading form…</span>
      <div className="skeleton-row skeleton-row--lg" style={{ width: "40%" }} />
      {Array.from({ length: fields }).map((_, i) => (
        <div key={`${id}-field-${i}`} className="skeleton-form__field">
          <div className="skeleton-row skeleton-row--sm" style={{ width: "25%" }} />
          <div className="skeleton-row skeleton-row--input" />
        </div>
      ))}
      <div className="skeleton-row skeleton-row--btn" />
    </div>
  );
}

/** Inline loading indicator with optional progress */
interface LoadingIndicatorProps {
  label?: string;
  progress?: number; // 0-100, undefined = indeterminate
}

export function LoadingIndicator({ label = "Processing", progress }: LoadingIndicatorProps) {
  const isIndeterminate = progress === undefined;
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className="loading-indicator"
    >
      <div
        className={`loading-indicator__bar${isIndeterminate ? " loading-indicator__bar--indeterminate" : ""}`}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        {!isIndeterminate && (
          <div
            className="loading-indicator__fill"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        )}
      </div>
      <span className="loading-indicator__label">{label}</span>
    </div>
  );
}
