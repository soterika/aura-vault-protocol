import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "../components/Primitives";

/**
 * `Avatar` represents a user. Shows an image or falls back to initials.
 *
 * ## Accessibility
 * - Wrapper has `aria-label` set to `alt` or `name`
 * - Image uses `alt` attribute
 * - Initials are `aria-hidden` (announced via wrapper label)
 */
const meta = {
  title: "Primitives/Avatar",
  component: Avatar,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: { size: { control: "select", options: ["xs","sm","md","lg","xl"] } },
} satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithInitials: Story = { args: { name: "Alice Nguyen", size: "md" } };
export const WithImage:    Story = { args: { src: "https://i.pravatar.cc/80", alt: "User avatar", size: "md" } };
export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
      {(["xs","sm","md","lg","xl"] as const).map(s => (
        <Avatar key={s} name="Bob Smith" size={s} />
      ))}
    </div>
  ),
};
