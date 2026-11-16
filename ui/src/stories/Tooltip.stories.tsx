import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tooltip } from "../components/Composites";
import { Button } from "../components/Button";

/**
 * `Tooltip` shows a short hint on hover or focus.
 *
 * ## Accessibility
 * - Uses `role="tooltip"` and `aria-describedby` for screen reader support
 * - Keyboard-accessible: appears on focus as well as hover
 * - Not used for essential information — always provide text alternatives
 */
const meta = {
  title: "Composites/Tooltip",
  component: Tooltip,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: { placement: { control: "select", options: ["top","bottom","left","right"] } },
} satisfies Meta<typeof Tooltip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Top:    Story = { args: { content: "Hover to learn more", placement: "top",    children: <Button>Hover me</Button> } };
export const Bottom: Story = { args: { content: "Opens a dialog",       placement: "bottom", children: <Button>Focus me</Button> } };
export const Right:  Story = { args: { content: "APY calculated daily", placement: "right",  children: <span tabIndex={0} style={{ cursor: "default" }}>APY ℹ</span> } };
