import type { Meta, StoryObj } from "@storybook/react-vite";
import { Spinner } from "../components/Primitives";

/**
 * `Spinner` indicates a loading state.
 *
 * ## Accessibility
 * - Uses `role="status"` with `aria-label` (defaults to "Loading…")
 * - Visual ring is `aria-hidden`; screen readers only hear the label
 */
const meta = {
  title: "Primitives/Spinner",
  component: Spinner,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: { size: { control: "select", options: ["sm", "md", "lg"] } },
} satisfies Meta<typeof Spinner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Small:  Story = { args: { size: "sm" } };
export const Medium: Story = { args: { size: "md" } };
export const Large:  Story = { args: { size: "lg" } };
export const CustomLabel: Story = { args: { size: "md", label: "Fetching vault data…" } };
