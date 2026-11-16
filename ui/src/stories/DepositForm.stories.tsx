import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DepositForm } from "../components/DepositForm";
import type { ToastMessage } from "../components/Toast";
import { Toast } from "../components/Toast";

/**
 * `DepositForm` lets a user deposit underlying tokens into the Aura vault.
 *
 * ## States
 * - **Default** — ready to accept an amount
 * - **Loading** — shows skeleton while the transaction is in-flight
 * - **Field error** — inline validation message when amount is invalid
 * - **Transaction error** — retryable error banner after a failed contract call
 *
 * ## Accessibility
 * - Field label is always associated via `htmlFor`/`id`
 * - Validation errors use `role="alert"` so screen readers announce them immediately
 * - `aria-invalid` is set on the input when an error exists
 * - `aria-busy` is toggled on the submit button during processing
 * - A polite live-region announces success/failure to screen readers without interrupting
 */
const meta = {
  title: "Vault/DepositForm",
  component: DepositForm,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: "400px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DepositForm>;

export default meta;
type Story = StoryObj<typeof meta>;

function WithToast(props: { onToast: (msg: ToastMessage) => void }) {
  return <DepositForm onToast={props.onToast} />;
}

/** Default ready state — enter an amount and click Deposit. */
export const Default: Story = {
  render: () => {
    const [toast, setToast] = useState<ToastMessage | null>(null);
    return (
      <>
        <DepositForm onToast={setToast} />
        {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
      </>
    );
  },
};

/** Empty amount — submitting triggers inline field validation. */
export const FieldValidationError: Story = {
  render: () => {
    const [toast, setToast] = useState<ToastMessage | null>(null);
    return (
      <>
        <div>
          <DepositForm onToast={setToast} />
          <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            ↑ Click "Deposit" without entering a value to trigger the field error.
          </p>
        </div>
        {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
      </>
    );
  },
};

/** No-op toast handler — useful for isolated snapshot testing. */
export const NoToastHandler: Story = {
  args: {
    onToast: () => undefined,
  },
};
