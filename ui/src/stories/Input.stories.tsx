import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "../components/Input";
import { IconSearch, IconDollarSign } from "../components/Icons";

/**
 * `Input` is an accessible text field with label, validation, hints, and addons.
 *
 * ## Accessibility
 * - Label is always associated via `htmlFor`/`id`
 * - Errors use `role="alert"` and `aria-describedby` so screen readers announce them
 * - `aria-invalid` is set when an error is present
 * - Focus ring visible on keyboard navigation
 */
const meta = {
  title: "Primitives/Input",
  component: Input,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [(Story) => <div style={{ width: "320px" }}><Story /></div>],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Amount", placeholder: "0.00" },
};

export const WithHint: Story = {
  args: { label: "Wallet address", placeholder: "G...", hint: "Enter your Stellar public key" },
};

export const WithError: Story = {
  args: { label: "Amount", placeholder: "0.00", value: "-5", error: "Amount must be greater than 0", readOnly: true },
};

export const WithLeftAddon: Story = {
  args: { label: "Search", placeholder: "Search vaults…", leftAddon: <IconSearch size="sm" /> },
};

export const WithRightAddon: Story = {
  args: { label: "Amount (USD)", placeholder: "0.00", rightAddon: <IconDollarSign size="sm" /> },
};

export const Disabled: Story = {
  args: { label: "Vault address", value: "GABC…XYZ", disabled: true, readOnly: true },
};

export const NumberInput: Story = {
  args: { label: "Shares to withdraw", type: "number", min: "0", step: "any", placeholder: "0" },
};
