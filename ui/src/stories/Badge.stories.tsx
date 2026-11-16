import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "../components/Primitives";

/**
 * `Badge` is a small inline status label.
 *
 * ## Accessibility
 * - Uses `role="status"` so screen readers announce badge content
 * - All color variants meet WCAG AA contrast on their background
 */
const meta = {
  title: "Primitives/Badge",
  component: Badge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: { variant: { control: "select", options: ["default","primary","success","warning","error","info"] } },
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default:  Story = { args: { children: "Default",  variant: "default"  } };
export const Primary:  Story = { args: { children: "Active",   variant: "primary"  } };
export const Success:  Story = { args: { children: "Harvested",variant: "success"  } };
export const Warning:  Story = { args: { children: "Pending",  variant: "warning"  } };
export const Error:    Story = { args: { children: "Failed",   variant: "error"    } };
export const Info:     Story = { args: { children: "Info",     variant: "info"     } };

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      {(["default","primary","success","warning","error","info"] as const).map(v => (
        <Badge key={v} variant={v}>{v}</Badge>
      ))}
    </div>
  ),
};
