/**
 * helpContent.ts
 *
 * Central registry of plain-language explanations for complex financial
 * terms used throughout the Aura Vault UI.
 */

export interface HelpEntry {
  title: string;
  description: string;
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
    description:
      'When you deposit tokens into the vault, you receive shares that represent your proportional ownership. ' +
      'As the vault earns yield, each share becomes redeemable for more tokens — you don\'t need to do anything to benefit.',
  },
  apy: {
    title: 'Annual Percentage Yield (APY)',
    description:
      'APY shows how much your deposit could grow over one year if the current rate continues, ' +
      'including the effect of compounding. A higher APY means faster growth, but past rates don\'t guarantee future returns.',
  },
  totalAssets: {
    title: 'Total Assets',
    description:
      'The total number of underlying tokens currently held by the vault across all depositors. ' +
      'This number grows whenever yield is harvested into the vault.',
  },
  exchangeRate: {
    title: 'Exchange Rate',
    description:
      'The current redemption value of one vault share expressed in the underlying token. ' +
      'For example, "1 share = 1.05 USDC" means each share has grown 5% since initial deposit.',
  },
  harvest: {
    title: 'Harvest',
    description:
      'Anyone can trigger a harvest to inject freshly-earned yield into the vault without minting new shares. ' +
      'This raises the exchange rate for every existing shareholder — auto-compounding your returns.',
  },
};
