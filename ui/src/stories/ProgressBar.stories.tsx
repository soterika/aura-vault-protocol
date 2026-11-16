import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProgressBar } from "../components/Composites";

/**
 * `ProgressBar` visualises a value within a range.
 *
 * ## Accessibility
 * - Uses `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
 * - `aria-label` provided via `label` prop (required for screen readers)
 */
const meta = {
  title: "Composites/ProgressBar",
  component: ProgressBar,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    value:   { control: { type: "range", min: 0, max: 100 } },
    variant: { control: "select", options: ["default","success","warning","error"] },
  },
  decorators: [(Story) => <div style={{ width: "400px" }}><Story /></div>],
} satisfies Meta<typeof ProgressBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { value: 65, label: "Vault utilisation", showValue: true } };
export const Success: Story = { args: { value: 100, variant: "success", label: "Deposit confirmed",  showValue: true } };
export const Warning: Story = { args: { value: 88,  variant: "warning",  label: "Approaching limit", showValue: true } };
export const Error:   Story = { args: { value: 100, variant: "error",    label: "Limit reached",      showValue: true } };
export const NoLabel: Story = { args: { value: 42 } };
