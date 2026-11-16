import type { Meta, StoryObj } from "@storybook/react";
import { EmptyState } from "./EmptyState";
import "../styles/global.css";

/**
 * EmptyState — shown on the dashboard when share_balance = 0.
 *
 * Guides new users toward their first deposit with an accessible illustration,
 * headline, subheading, primary CTA, and a secondary docs link.
 */
const meta: Meta<typeof EmptyState> = {
  title: "Components/EmptyState",
  component: EmptyState,
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#0f1117" }],
    },
    docs: {
      description: {
        component:
          "Rendered when the connected wallet has `share_balance = 0`. The primary CTA opens the deposit modal directly.",
      },
    },
  },
  argTypes: {
    onDeposit: { action: "deposit clicked" },
    docsUrl: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

/** Default empty state — share_balance is 0, user has never deposited */
export const Default: Story = {
  args: {
    docsUrl: "https://github.com/soterika/aura-vault-protocol#how-it-works",
  },
};

/** With a custom docs URL */
export const CustomDocsUrl: Story = {
  args: {
    docsUrl: "https://docs.auravault.xyz/getting-started",
  },
};
