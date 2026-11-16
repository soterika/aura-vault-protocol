/**
 * helpContent.ts
 *
 * Central registry of plain-language explanations for complex financial
 * terms used throughout the Aura Vault UI.
 *
 * Each entry maps a stable key to a short title and a tooltip description.
 * Import this in any component that renders a <HelpTooltip />.
 */

export interface HelpEntry {
  /** Short heading displayed at the top of the tooltip popover */
  title: string;
  /** One-to-two sentence plain-language explanation */
  description: string;
  href: string;
}

export type HelpKey =
  | 'vaultShares'
  | 'apy'
  | 'totalAssets'
  | 'exchangeRate'
  | 'harvest';

export const helpContent: Record<HelpKey, HelpEntry> = {
  vaultShares: {
    title: 'Vault Shares',
    description: 'A vault share is your proportional ownership of the tokens in the vault. As yield is added, each share can be redeemed for more tokens.',
    href: '/faq#vault-shares',
  },

  apy: {
    title: 'Annual Percentage Yield (APY)',
    description: 'APY estimates one year of growth, including compounding. At 10% APY, 100 USDC could become about 110 USDC in a year if the rate holds. Past rates do not guarantee future returns.',
    href: '/faq#apy',
  },

  totalAssets: {
    title: 'Total Assets',
    description: 'All underlying tokens held for depositors, including yield already added to the vault.',
    href: '/faq#vault-shares',
  },

  exchangeRate: {
    title: 'Exchange Rate',
    description: 'The amount of underlying tokens one share can redeem for. It is calculated as total vault assets divided by total shares.',
    href: '/faq#vault-shares',
  },

  harvest: {
    title: 'Harvest',
    description: 'A keeper submits earned yield to the vault. The added assets increase the redemption value of existing shares, so returns compound.',
    href: '/faq#yield',
  },
  autoCompounding: {
    title: 'Auto-compounding',
    description: 'Yield added to the vault earns future yield too. This can grow a balance faster than withdrawing and reinvesting rewards manually.',
    href: '/faq#yield',
  },
  withdrawalCooldown: {
    title: 'Withdrawal cooldown',
    description: 'A cooldown is a waiting period before a withdrawal can be completed. Check the withdrawal screen for the current vault rules.',
    href: '/faq#withdrawals',
  },
};
