import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "../components/Composites";

/**
 * `Switch` is a toggle control using `role="switch"`.
 *
 * ## Accessibility
 * - Uses `role="switch"` on a native checkbox for correct semantic meaning
 * - `aria-checked` reflects the current state
 * - Label associated via `htmlFor`/`id`
 */
const meta = {
  title: "Composites/Switch",
  component: Switch,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default:  Story = { args: { label: "Enable auto-harvest" } };
export const On:       Story = { args: { label: "Dark mode", defaultChecked: true } };
export const Disabled: Story = { args: { label: "Advanced mode (Pro only)", disabled: true } };
