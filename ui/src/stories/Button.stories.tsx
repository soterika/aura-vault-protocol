import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../components/Button";
import { IconPlus, IconArrowRight } from "../components/Icons";

/**
 * The `Button` component is the primary interaction trigger in the design system.
 *
 * ## Accessibility
 * - Uses native `<button>` element for keyboard and screen reader support
 * - `aria-busy` is set when `loading` is true
 * - Disabled state prevents interaction and announces to screen readers
 * - All variants meet WCAG 2.1 AA contrast requirements (≥4.5:1)
 */
const meta = {
  title: "Primitives/Button",
  component: Button,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["primary", "secondary", "ghost", "danger"] },
    size:    { control: "select", options: ["sm", "md", "lg"] },
    loading: { control: "boolean" },
    disabled:{ control: "boolean" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { children: "Deposit", variant: "primary" },
};

export const Secondary: Story = {
  args: { children: "Cancel", variant: "secondary" },
};

export const Ghost: Story = {
  args: { children: "Learn more", variant: "ghost" },
};

export const Danger: Story = {
  args: { children: "Delete vault", variant: "danger" },
};

export const Small: Story = {
  args: { children: "Confirm", size: "sm" },
};

export const Large: Story = {
  args: { children: "Connect wallet", size: "lg" },
};

export const Loading: Story = {
  args: { children: "Processing…", loading: true },
};

export const Disabled: Story = {
  args: { children: "Not available", disabled: true },
};

export const WithLeftIcon: Story = {
  args: { children: "Add position", leftIcon: <IconPlus size="sm" /> },
};

export const WithRightIcon: Story = {
  args: { children: "Next step", rightIcon: <IconArrowRight size="sm" />, variant: "secondary" },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
    </div>
  ),
};
