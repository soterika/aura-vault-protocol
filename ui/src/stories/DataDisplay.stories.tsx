import type { Meta, StoryObj } from "@storybook/react";
import { Alert, Progress, Skeleton, Badge, Spinner, StatCard, EmptyState } from "../components/DataDisplay";

const alertMeta = {
  title: "Feedback/Alert",
  component: Alert,
  tags: ["autodocs"],
} satisfies Meta<typeof Alert>;

export default alertMeta;
type AlertStory = StoryObj<typeof alertMeta>;

export const InfoAlert: AlertStory = {
  args: {
    variant: "info",
    title: "Information",
    children: "This is an informational message.",
  },
};

export const SuccessAlert: AlertStory = {
  args: {
    variant: "success",
    title: "Success",
    children: "Operation completed successfully!",
  },
};

export const WarningAlert: AlertStory = {
  args: {
    variant: "warning",
    title: "Warning",
    children: "Please review this carefully.",
  },
};

export const ErrorAlert: AlertStory = {
  args: {
    variant: "error",
    title: "Error",
    children: "Something went wrong. Please try again.",
    dismissible: true,
  },
};

export const ProgressExamples: StoryObj<typeof Progress> = {
  render: () => (
    <>
      <div>
        <label>Incomplete (25%)</label>
        <Progress value={25} max={100} />
      </div>
      <div style={{ marginTop: "16px" }}>
        <label>Half Complete (50%) with Label</label>
        <Progress value={50} max={100} showLabel />
      </div>
      <div style={{ marginTop: "16px" }}>
        <label>Almost Done (75%)</label>
        <Progress value={75} max={100} />
      </div>
      <div style={{ marginTop: "16px" }}>
        <label>Complete (100%)</label>
        <Progress value={100} max={100} showLabel />
      </div>
    </>
  ),
};

export const SkeletonExamples: StoryObj<typeof Skeleton> = {
  render: () => (
    <>
      <div style={{ marginBottom: "24px" }}>
        <label>Single Line</label>
        <Skeleton width="100%" height="16px" />
      </div>
      <div style={{ marginBottom: "24px" }}>
        <label>Multiple Lines</label>
        <Skeleton width="100%" height="16px" count={3} />
      </div>
      <div style={{ marginBottom: "24px" }}>
        <label>Circle Skeleton</label>
        <Skeleton width="64px" height="64px" circle />
      </div>
    </>
  ),
};

export const BadgeExamples: StoryObj<typeof Badge> = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
      <Badge variant="default">Default</Badge>
      <Badge variant="primary">Primary</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="error">Error</Badge>
      <Badge variant="info">Info</Badge>
    </div>
  ),
};

export const SpinnerExamples: StoryObj<typeof Spinner> = {
  render: () => (
    <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
      <Spinner size="sm" label="Small spinner" />
      <Spinner size="md" label="Medium spinner" />
      <Spinner size="lg" label="Large spinner" />
    </div>
  ),
};

export const StatCardExamples: StoryObj<typeof StatCard> = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
      <StatCard label="Total Deposits" value="1,250,000" unit="XLM" />
      <StatCard
        label="Weekly Yield"
        value="12.5"
        unit="%"
        trend="up"
        trendValue="+2.1%"
      />
      <StatCard
        label="Participants"
        value="342"
        trend="up"
        trendValue="+15"
      />
    </div>
  ),
};

export const EmptyStateExample: StoryObj<typeof EmptyState> = {
  render: () => (
    <EmptyState
      title="No transactions yet"
      description="Your transaction history will appear here."
      action={<button style={{ padding: "8px 16px", background: "#007AFF", color: "white", border: "none", borderRadius: "4px" }}>Start Depositing</button>}
    />
  ),
};
