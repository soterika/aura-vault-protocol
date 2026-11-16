import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox, Switch } from "../components/Composites";

/* ── Checkbox ─────────────────────────────────────────────────── */
/**
 * `Checkbox` is an accessible boolean input.
 *
 * ## Accessibility
 * - Label associated via `htmlFor`/`id`
 * - Uses native `<input type="checkbox">` for full keyboard/screen reader support
 */
const checkboxMeta = {
  title: "Composites/Checkbox",
  component: Checkbox,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof Checkbox>;
export default checkboxMeta;
type CheckboxStory = StoryObj<typeof checkboxMeta>;

export const Default:     CheckboxStory = { args: { label: "I agree to the terms" } };
export const Checked:     CheckboxStory = { args: { label: "Notifications enabled", defaultChecked: true } };
export const WithError:   CheckboxStory = { args: { label: "Accept terms", error: "You must accept the terms" } };
export const Disabled:    CheckboxStory = { args: { label: "Premium feature", disabled: true } };
