import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { HarvestPanel } from "../components/HarvestPanel";
import type { ToastMessage } from "../components/Toast";
import { Toast } from "../components/Toast";

/**
 * `HarvestPanel` allows a keeper to inject yield tokens into the vault
 * without minting new shares, increasing the exchange rate for all depositors.
 *
 * ## States
 * - **Default** — ready to accept a yield amount
 * - **Loading** — skeleton shown while transaction is in-flight
 * - **Field error** — validation message for missing/invalid amount
 * - **Transaction error** — retryable error banner
 *
 * ## Accessibility
 * - `role="alert"` on error messages
 * - `aria-invalid` on invalid inputs
 * - `aria-busy` toggled on submit button
 */
const meta = {
  title: "Vault/HarvestPanel",
  component: HarvestPanel,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: "400px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HarvestPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default ready state — enter yield amount and click Harvest. */
export const Default: Story = {
  render: () => {
    const [toast, setToast] = useState<ToastMessage | null>(null);
    return (
      <>
        <HarvestPanel onToast={setToast} />
        {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
      </>
    );
  },
};

/** Click Harvest with no value to trigger field validation. */
export const FieldValidationError: Story = {
  render: () => {
    const [toast, setToast] = useState<ToastMessage | null>(null);
    return (
      <>
        <div>
          <HarvestPanel onToast={setToast} />
          <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            ↑ Click "Harvest" with an empty field to trigger validation.
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
