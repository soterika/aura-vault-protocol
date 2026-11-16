import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Modal } from "../components/Modal";
import { Button } from "../components/Button";

/**
 * `Modal` is a portal-rendered dialog for confirmations, transaction details,
 * and multi-step flows throughout the Aura Vault UI.
 *
 * ## States
 * - **Open** — dialog visible, backdrop blocking background interaction
 * - **Closed** — nothing rendered (returns null)
 *
 * ## Accessibility
 * - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` pointing to the title
 * - Focus is moved to the dialog on open
 * - Escape key closes the dialog
 * - Click on backdrop closes the dialog
 * - Focus trap keeps keyboard navigation inside the modal while open
 */
const meta = {
  title: "Overlay/Modal",
  component: Modal,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    isOpen:  { control: "boolean" },
    title:   { control: "text" },
    onClose: { action: "closed" },
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Modal in its open state with placeholder content. */
export const Open: Story = {
  args: {
    isOpen: true,
    title: "Confirm Deposit",
    onClose: () => undefined,
    children: (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <p>You are about to deposit <strong>500 USDC</strong> into the Aura Vault.</p>
        <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          Estimated shares minted: <strong>498.2</strong>
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={() => undefined}>Cancel</Button>
          <Button variant="primary"   onClick={() => undefined}>Confirm</Button>
        </div>
      </div>
    ),
  },
};

/** Interactive — toggle open/close via button. */
export const Interactive: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <Button variant="primary" onClick={() => setOpen(true)}>Open modal</Button>
        <Modal isOpen={open} title="Transaction Details" onClose={() => setOpen(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <p>Confirm the withdrawal of <strong>250 shares</strong>.</p>
            <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
              You will receive approximately <strong>252.8 USDC</strong>.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary"   onClick={() => setOpen(false)}>Confirm</Button>
            </div>
          </div>
        </Modal>
      </div>
    );
  },
};

/** Modal in closed state — nothing is rendered. */
export const Closed: Story = {
  args: {
    isOpen: false,
    title: "This modal is closed",
    onClose: () => undefined,
    children: <p>You should not see this.</p>,
  },
};
