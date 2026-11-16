import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icons, IconSun, type IconSize } from "../components/Icons";

/**
 * 55+ SVG icons organised into semantic groups.
 *
 * ## Accessibility
 * - Decorative icons are `aria-hidden="true"` by default
 * - Provide a `label` prop when the icon conveys meaning without surrounding text
 * - All icons inherit `currentColor` for automatic theme adaptation
 */
const meta = {
  title: "Icons/Library",
  component: IconSun,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    size:  { control: "select", options: ["xs","sm","md","lg","xl"] },
    label: { control: "text" },
  },
} satisfies Meta<typeof IconSun>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SingleIcon: Story = { args: { size: "lg", label: "Sun / Light mode" } };

export const AllIcons: Story = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px,1fr))", gap: "1rem" }}>
      {Object.entries(Icons).map(([name, Icon]) => (
        <div key={name} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"0.375rem" }}>
          <Icon size="md" />
          <span style={{ fontSize:"var(--text-xs)", color:"var(--color-text-muted)", textAlign:"center" }}>{name}</span>
        </div>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display:"flex", gap:"1.5rem", alignItems:"center" }}>
      {(["xs","sm","md","lg","xl"] as IconSize[]).map(s => (
        <div key={s} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"0.25rem" }}>
          <IconSun size={s} />
          <span style={{ fontSize:"var(--text-xs)", color:"var(--color-text-muted)" }}>{s}</span>
        </div>
      ))}
    </div>
  ),
};
