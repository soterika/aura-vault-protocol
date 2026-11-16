import type { Meta, StoryObj } from "@storybook/react-vite";
import { PerformanceCharts } from "../components/PerformanceCharts";

/**
 * `PerformanceCharts` renders the APY over time and TVL history charts for the
 * Aura Vault dashboard using Recharts.
 *
 * ## States
 * - **Default** — charts populated with seeded mock data
 * - **Empty** — no data points; charts render empty axes
 * - **Loading** — shown while data is being fetched (skeleton placeholder)
 *
 * ## Accessibility
 * - Chart containers have `aria-label` describing the visualisation
 * - Legends are rendered as readable text, not icon-only
 */
const meta = {
  title: "Charts/PerformanceCharts",
  component: PerformanceCharts,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof PerformanceCharts>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default view — charts populated with seeded mock data. */
export const Default: Story = {};

/** Wide viewport — simulates desktop dashboard layout. */
export const WideLayout: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  decorators: [
    (Story) => (
      <div style={{ width: "900px" }}>
        <Story />
      </div>
    ),
  ],
};

/** Narrow viewport — simulates mobile layout. */
export const NarrowLayout: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  decorators: [
    (Story) => (
      <div style={{ width: "375px" }}>
        <Story />
      </div>
    ),
  ],
};
