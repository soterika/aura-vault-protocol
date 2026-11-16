import type { Meta, StoryObj } from "@storybook/react-vite";
import { Divider } from "../components/Primitives";

/**
 * `Divider` separates content sections.
 *
 * ## Accessibility
 * - Uses `role="separator"` for unlabelled dividers
 * - Labelled variant omits separator role (becomes a visual label)
 */
const meta = {
  title: "Primitives/Divider",
  component: Divider,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [(Story: React.FC) => <div style={{ width: "320px" }}><Story /></div>],
} satisfies Meta<typeof Divider>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = { args: {} };
export const WithLabel:  Story = { args: { label: "or" } };
