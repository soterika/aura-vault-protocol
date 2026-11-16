import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Skeleton,
  CardSkeleton,
  TableSkeleton,
  GraphSkeleton,
  FormSkeleton,
  LoadingIndicator,
} from "../components/Skeleton";

/**
 * Loading skeleton components used throughout the Aura Vault UI while
 * async data is being fetched.
 *
 * ## Accessibility
 * - All skeletons carry `role="status"`, `aria-busy="true"`, and an `aria-label`
 * - An `.sr-only` text node provides an audible loading message for screen readers
 * - The `LoadingIndicator` uses `role="progressbar"` with proper ARIA value attributes
 */
const meta = {
  title: "Feedback/Skeleton",
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Basic row skeleton — used inside forms while data loads. */
export const BasicRows: Story = {
  render: () => <Skeleton rows={3} />,
};

/** Card grid skeleton — vault position / portfolio cards. */
export const Cards: Story = {
  render: () => <CardSkeleton cards={3} />,
};

/** Table skeleton — transaction history, leaderboard. */
export const Table: Story = {
  render: () => <TableSkeleton rows={5} columns={4} />,
};

/** Chart skeleton — yield performance graphs. */
export const Graph: Story = {
  render: () => <div style={{ height: "160px" }}><GraphSkeleton bars={7} /></div>,
};

/** Form skeleton — deposit/withdraw forms during initial load. */
export const Form: Story = {
  render: () => <FormSkeleton fields={2} />,
};

/** Indeterminate progress indicator. */
export const LoadingIndeterminate: Story = {
  render: () => <LoadingIndicator label="Processing transaction…" />,
};

/** Determinate progress indicator at 60 %. */
export const LoadingDeterminate: Story = {
  render: () => <LoadingIndicator label="Uploading…" progress={60} />,
};

/** All skeleton variants stacked for overview comparison. */
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <div>
        <p style={{ marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Basic</p>
        <Skeleton rows={2} />
      </div>
      <div>
        <p style={{ marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Cards</p>
        <CardSkeleton cards={2} />
      </div>
      <div>
        <p style={{ marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Table</p>
        <TableSkeleton rows={3} columns={3} />
      </div>
      <div style={{ height: "120px" }}>
        <p style={{ marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Graph</p>
        <GraphSkeleton bars={5} />
      </div>
      <div>
        <p style={{ marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Form</p>
        <FormSkeleton fields={2} />
      </div>
      <div>
        <p style={{ marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Loading Indicator</p>
        <LoadingIndicator label="Processing…" progress={45} />
      </div>
    </div>
  ),
};
