import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs } from "../components/Composites";

/**
 * `Tabs` organises content into labelled panels.
 *
 * ## Accessibility
 * - Full ARIA tab pattern: `role="tablist"`, `role="tab"`, `role="tabpanel"`
 * - `aria-selected` reflects active tab
 * - Arrow keys navigate between tabs (roving tabIndex)
 * - `aria-controls` links tabs to panels
 */
const meta = {
  title: "Composites/Tabs",
  component: Tabs,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj<typeof meta>;

const items = [
  { id: "deposit",  label: "Deposit",  content: <p>Deposit tokens into the vault to earn yield.</p> },
  { id: "withdraw", label: "Withdraw", content: <p>Burn shares to redeem your underlying tokens.</p> },
  { id: "harvest",  label: "Harvest",  content: <p>Inject yield to increase the share price for all depositors.</p> },
];

export const Default:    Story = { args: { items } };
export const WithDisabled: Story = {
  args: {
    items: [
      ...items,
      { id: "admin", label: "Admin", content: <p>Admin panel.</p>, disabled: true },
    ],
  },
};
