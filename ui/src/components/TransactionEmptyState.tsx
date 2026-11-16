/**
 * TransactionEmptyState
 *
 * Displayed when a successful fetch returns zero items.
 * Differentiates between "no transactions at all" and "no results
 * matching the active filter" so the message stays actionable.
 */
import type { TypeFilter } from "../lib/transactions";

interface Props {
  typeFilter: TypeFilter;
  onClearFilter: () => void;
}

export function TransactionEmptyState({ typeFilter, onClearFilter }: Props) {
  const isFiltered = typeFilter !== "all";

  return (
    <div className="tx-empty" role="status" aria-live="polite">
      {/* SVG illustration — vault icon with a question mark overlay */}
      <svg
        className="tx-empty__illustration"
        viewBox="0 0 120 120"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        {/* Outer vault circle */}
        <circle cx="60" cy="60" r="52" fill="var(--color-surface-raised)" />
        {/* Vault door ring */}
        <circle
          cx="60"
          cy="60"
          r="36"
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="3"
          strokeDasharray="6 4"
          opacity="0.5"
        />
        {/* Lock body */}
        <rect
          x="44"
          y="54"
          width="32"
          height="22"
          rx="4"
          fill="var(--color-surface)"
          stroke="var(--color-primary)"
          strokeWidth="2"
          opacity="0.7"
        />
        {/* Lock shackle */}
        <path
          d="M50 54 V48 a10 10 0 0 1 20 0 V54"
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.7"
        />
        {/* Keyhole */}
        <circle cx="60" cy="63" r="3.5" fill="var(--color-text-muted)" />
        <rect x="58.5" y="64.5" width="3" height="6" rx="1.5" fill="var(--color-text-muted)" />

        {/* Floating document with lines — "no records" metaphor */}
        <rect x="75" y="28" width="22" height="28" rx="3" fill="var(--color-surface)" stroke="var(--color-surface-raised)" strokeWidth="1.5" />
        <line x1="79" y1="35" x2="93" y2="35" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
        <line x1="79" y1="40" x2="90" y2="40" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
        <line x1="79" y1="45" x2="93" y2="45" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
        {/* X mark over document */}
        <line x1="79" y1="49" x2="93" y2="49" stroke="var(--color-error)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      </svg>

      <p className="tx-empty__headline">
        {isFiltered ? "No matching transactions" : "No transactions yet"}
      </p>

      <p className="tx-empty__body">
        {isFiltered
          ? `There are no ${typeFilter.toLowerCase()} transactions in your history.`
          : "Once you deposit, withdraw, or a harvest occurs, your activity will appear here."}
      </p>

      {isFiltered && (
        <button
          type="button"
          className="btn--ghost tx-empty__action"
          onClick={onClearFilter}
        >
          Clear filter
        </button>
      )}
    </div>
  );
}
