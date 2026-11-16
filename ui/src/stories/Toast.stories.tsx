import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Toast, type ToastMessage } from "../components/Toast";
import { Button } from "../components/Button";

/**
 * `Toast` is the non-blocking notification component for transient feedback
 * (success, error, info) after user actions like deposit, withdraw, and harvest.
 *
 * ## States
 * - **Success** — green, confirms a completed action
 * - **Error** — red, signals a failed action
 * - **Info** — neutral, provides informational context
 *
 * ## Behaviour
 * - Auto-dismisses after `duration` ms (default 4 000 ms)
 * - Dismiss button available immediately for keyboard/screen-reader users
 *
 * ## Accessibility
 * - `role="status"` + `aria-live="polite"` + `aria-atomic="true"`
 * - Dismiss button has a descriptive `aria-label`
 */
const meta = {
  title: "Feedback/Toast",
  component: Toast,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    message: {
      control: "object",
      description: "Toast message object `{ type, text }`",
    },
    duration: {
      control: { type: "number", min: 500, step: 500 },
      description: "Auto-dismiss delay in ms",
    },
  },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Deposit success toast. */
export const Success: Story = {
  args: {
    message: { type: "success", text: "Deposited 500 USDC successfully." },
    onDismiss: () => undefined,
    duration: 999999,
  },
};

/** Transaction failure toast. */
export const Error: Story = {
  args: {
    message: { type: "error", text: "Transaction failed: insufficient balance." },
    onDismiss: () => undefined,
    duration: 999999,
  },
};

/** Informational notification. */
export const Info: Story = {
  args: {
    message: { type: "info", text: "Network fees are currently elevated." },
    onDismiss: () => undefined,
    duration: 999999,
  },
};

/** All three types rendered side-by-side. */
export const AllTypes: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: "360px" }}>
      <Toast message={{ type: "success", text: "Deposited 500 USDC successfully." }} onDismiss={() => undefined} duration={999999} />
      <Toast message={{ type: "error",   text: "Transaction failed: insufficient balance." }} onDismiss={() => undefined} duration={999999} />
      <Toast message={{ type: "info",    text: "Network fees are currently elevated." }} onDismiss={() => undefined} duration={999999} />
    </div>
  ),
};

/** Interactive — click a button to trigger and auto-dismiss a toast. */
export const Interactive: Story = {
  render: () => {
    const [toast, setToast] = useState<ToastMessage | null>(null);
    const messages: ToastMessage[] = [
      { type: "success", text: "Harvest complete — yield injected." },
      { type: "error",   text: "Harvest failed: vault paused." },
      { type: "info",    text: "Harvest queued, waiting for confirmation." },
    ];
    let idx = 0;
    const show = () => {
      setToast(messages[idx % messages.length]);
      idx++;
    };
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
        <Button variant="primary" onClick={show}>Show next toast</Button>
        {toast && <Toast message={toast} onDismiss={() => setToast(null)} duration={3000} />}
      </div>
    );
  },
};
