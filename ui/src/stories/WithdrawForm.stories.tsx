import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { WithdrawForm } from "../components/WithdrawForm";
import type { ToastMessage } from "../components/Toast";
import { Toast } from "../components/Toast";

/**
 * `WithdrawForm` lets a user burn vault shares to redeem underlying tokens.
 *
 * ## States
 * - **Default** — ready to accept a share count
 * - **Loading** — shows skeleton while the transaction is in-flight
 * - **Field error** — inline validation when share amount is invalid
 * - **Transaction error** — retryable error banner after a failed contract call
 *
 * ## Accessibility
 * - Same accessible patterns as `DepositForm`: `role="alert"`, `aria-invalid`, `aria-busy`
 * - Live region announces success / failure to screen readers
 */
const meta = {
  title: "Vault/WithdrawForm",
  component: WithdrawForm,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: "400px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WithdrawForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default ready state — enter shares and click Withdraw. */
export const Default: Story = {
  render: () => {
    const [toast, setToast] = useState<ToastMessage | null>(null);
    return (
      <>
        <WithdrawForm onToast={setToast} />
        {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
      </>
    );
  },
};

/** Submit without a value to trigger the field validation error. */
export const FieldValidationError: Story = {
  render: () => {
    const [toast, setToast] = useState<ToastMessage | null>(null);
    return (
      <>
        <div>
          <WithdrawForm onToast={setToast} />
          <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            ↑ Click "Withdraw" without entering a value to trigger the field error.
          </p>
        </div>
        {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
      </>
    );
  },
};

/** Isolated — no toast side-effects. */
export const NoToastHandler: Story = {
  args: { onToast: () => undefined },
};
