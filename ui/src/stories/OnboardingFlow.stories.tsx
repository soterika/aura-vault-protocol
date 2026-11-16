import type { Meta, StoryObj } from "@storybook/react-vite";
import { OnboardingFlow } from "../components/OnboardingFlow";

/**
 * `OnboardingFlow` is a multi-step modal shown to first-time users, walking them
 * through Aura Vault's core concepts: deposit, withdraw, harvest, and security.
 *
 * ## States
 * - **Step 1–5** — navigable sequence of educational screens
 * - **Complete / Skip** — dismisses the overlay and marks onboarding as done
 *
 * ## Accessibility
 * - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` on the overlay
 * - Progress bar uses `role="progressbar"` with `aria-valuenow/min/max`
 * - Keyboard: Tab / Shift+Tab navigate controls; Enter / Space activates buttons
 */
const meta = {
  title: "Onboarding/OnboardingFlow",
  component: OnboardingFlow,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  argTypes: {
    onComplete: { action: "completed" },
  },
} satisfies Meta<typeof OnboardingFlow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Full onboarding flow — navigate through all 5 steps. */
export const Default: Story = {
  args: {
    onComplete: () => undefined,
  },
};

/** Onboarding with a no-op completion handler for isolated testing. */
export const StaticPreview: Story = {
  render: () => (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <OnboardingFlow onComplete={() => undefined} />
    </div>
  ),
};
