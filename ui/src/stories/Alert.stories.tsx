import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Alert } from "../components/Composites";

/**
 * `Alert` communicates important status messages.
 *
 * ## Accessibility
 * - Error and warning variants use `role="alert"` (assertive live region)
 * - Info and success use `role="status"` (polite live region)
 * - Dismiss button has descriptive `aria-label`
 */
const meta = {
  title: "Composites/Alert",
  component: Alert,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: { variant: { control: "select", options: ["info","success","warning","error"] } },
} satisfies Meta<typeof Alert>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Info:    Story = { args: { variant: "info",    title: "Note",    children: "Harvest is open to anyone. Gas fees apply." } };
export const Success: Story = { args: { variant: "success", title: "Success", children: "Your deposit of 100 USDC was successful." } };
export const Warning: Story = { args: { variant: "warning", title: "Warning", children: "Vault utilisation is above 90%. Withdrawals may be delayed." } };
export const Error:   Story = { args: { variant: "error",   title: "Error",   children: "Transaction failed. Insufficient balance." } };
export const Dismissible: Story = {
  render: () => {
    const [show, setShow] = useState(true);
    return show
      ? <Alert variant="info" title="Tip" onDismiss={() => setShow(false)}>Click × to dismiss this alert.</Alert>
      : <p style={{ color: "var(--color-text-muted)" }}>Alert dismissed.</p>;
  },
};
