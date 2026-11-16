import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "../components/Primitives";

/**
 * `Card` is a surface container for grouping related content.
 *
 * ## Accessibility
 * - Purely visual — no ARIA role added by default
 * - Add `role="region"` and `aria-label` if the card acts as a landmark
 */
const meta = {
  title: "Primitives/Card",
  component: Card,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    padding:  { control: "select", options: ["sm","md","lg"] },
    elevated: { control: "boolean" },
  },
  decorators: [(Story: React.FC) => <div style={{ width: "320px" }}><Story /></div>],
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default:      Story = { args: { children: "Card content goes here.", padding: "md" } };
export const Elevated:     Story = { args: { children: "Elevated card with shadow.", elevated: true } };
export const SmallPadding: Story = { args: { children: "Compact card.", padding: "sm" } };
export const LargePadding: Story = { args: { children: "Spacious card.", padding: "lg" } };
