import type { Meta, StoryObj } from '@storybook/react-vite';
import HelpTooltip from '../components/HelpTooltip';
import { helpContent } from '../lib/helpContent';

/**
 * `HelpTooltip` renders a "?" icon next to a complex financial term.
 *
 * ## Keyboard navigation
 * - Tab to focus the "?" button
 * - Enter or Space to open the tooltip
 * - Escape to close (focus returns to trigger)
 * - Click outside to close
 *
 * ## Accessibility
 * - `aria-describedby` links the trigger to tooltip content
 * - `role="tooltip"` + `aria-live="polite"` for screen reader announcements
 * - Minimum 44×44 px touch target
 * - `@storybook/addon-a11y` runs axe-core on every story variant
 */
const meta: Meta<typeof HelpTooltip> = {
  title: 'Components/HelpTooltip',
  component: HelpTooltip,
  parameters: {
    layout: 'centered',
    a11y: {
      config: {
        rules: [
          { id: 'color-contrast',   enabled: true },
          { id: 'button-name',      enabled: true },
        ],
      },
    },
  },
  argTypes: {
    helpKey: {
      control: 'select',
      options: Object.keys(helpContent) as Array<keyof typeof helpContent>,
      description: 'Which financial term to explain',
    },
    side: {
      control: 'radio',
      options: ['top', 'bottom', 'left', 'right'],
      description: 'Preferred tooltip opening direction',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof HelpTooltip>;

// ── Individual term stories ────────────────────────────────────────────────────

export const VaultShares: Story = {
  args: { helpKey: 'vaultShares', side: 'top' },
};

export const APY: Story = {
  args: { helpKey: 'apy', side: 'top' },
};

export const TotalAssets: Story = {
  args: { helpKey: 'totalAssets', side: 'bottom' },
};

export const ExchangeRate: Story = {
  args: { helpKey: 'exchangeRate', side: 'right' },
};

export const Harvest: Story = {
  args: { helpKey: 'harvest', side: 'left' },
};

// ── Composition story — term label + help icon ────────────────────────────────

export const InlineWithLabel: Story = {
  name: 'Inline with label',
  render: (args) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 500 }}>
      APY <HelpTooltip {...args} />
    </span>
  ),
  args: { helpKey: 'apy', side: 'top' },
};

// ── Bulk a11y audit — all terms at once ───────────────────────────────────────

export const AllTerms: Story = {
  name: 'All terms (a11y bulk check)',
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, padding: 16 }}>
      {(Object.keys(helpContent) as Array<keyof typeof helpContent>).map((key) => (
        <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{ fontWeight: 500 }}>{helpContent[key].title}</span>
          <HelpTooltip helpKey={key} />
        </span>
      ))}
    </div>
  ),
};
