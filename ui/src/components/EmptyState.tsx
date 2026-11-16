import { VaultIllustration } from "./VaultIllustration";

interface Props {
  /** Called when the primary "Make Your First Deposit" CTA is clicked */
  onDeposit: () => void;
  /** URL for the "Learn how it works" secondary link */
  docsUrl?: string;
}

/**
 * EmptyState — shown on the dashboard when a user's share_balance is 0.
 *
 * Guides new users toward their first deposit with:
 * - An accessible SVG vault/growth illustration
 * - A motivating headline and subheading
 * - Primary CTA that opens the deposit flow
 * - Secondary link to documentation
 */
export function EmptyState({
  onDeposit,
  docsUrl = "https://github.com/soterika/aura-vault-protocol#how-it-works",
}: Props) {
  return (
    <section
      className="empty-state"
      aria-labelledby="empty-state-heading"
      aria-describedby="empty-state-desc"
    >
      <div className="empty-state__illustration">
        <VaultIllustration width={200} height={180} />
      </div>

      <h2 id="empty-state-heading" className="empty-state__headline">
        Start earning yield on your tokens
      </h2>

      <p id="empty-state-desc" className="empty-state__subheading">
        Deposit any amount to receive vault shares and earn auto-compounded
        yield. No lock-up periods — withdraw whenever you like.
      </p>

      <div className="empty-state__actions">
        <button
          type="button"
          className="btn btn--primary empty-state__cta"
          onClick={onDeposit}
        >
          Make Your First Deposit
        </button>

        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="empty-state__learn-link"
        >
          Learn how it works
          {/* Screen-reader hint that link opens in new tab */}
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      </div>
    </section>
  );
}
