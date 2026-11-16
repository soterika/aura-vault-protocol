import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "../components/Composites";

/**
 * `Select` is a native dropdown with label and validation support.
 *
 * ## Accessibility
 * - Native `<select>` has built-in keyboard support
 * - Label associated via `htmlFor`/`id`
 * - Errors announced via `role="alert"` and `aria-describedby`
 */
const meta = {
  title: "Composites/Select",
  component: Select,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [(Story) => <div style={{ width: "280px" }}><Story /></div>],
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

const networkOptions = [
  { value: "mainnet",   label: "Mainnet" },
  { value: "testnet",   label: "Testnet" },
  { value: "futurenet", label: "Futurenet", disabled: true },
];

export const Default:   Story = { args: { label: "Network", options: networkOptions, placeholder: "Select network…" } };
export const WithError: Story = { args: { label: "Network", options: networkOptions, error: "Please select a network" } };
export const WithHint:  Story = { args: { label: "Network", options: networkOptions, hint: "Select the target Stellar network" } };
