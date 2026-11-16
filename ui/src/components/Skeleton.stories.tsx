import type { Meta, StoryObj } from "@storybook/react";
import {
  Skeleton,
  CardSkeleton,
  TableSkeleton,
  GraphSkeleton,
  FormSkeleton,
  LoadingIndicator,
} from "./Skeleton";
import "../styles/global.css";

/**
 * Skeleton Loading System — Aura Vault Design System
 *
 * Consistent skeleton screens that match the shape of real content,
 * eliminating layout shift and providing meaningful loading feedback.
 *
 * All components:
 * - Use `--color-skeleton-base` and `--color-skeleton-shimmer` CSS tokens
 * - Animated shimmer (CSS @keyframes, 1.4s cycle)
 * - Respect `prefers-reduced-motion: reduce`
 * - ARIA: role="status", aria-busy="true", sr-only text
 * - Dark-mode ready (colours controlled by CSS custom properties)
 */

const darkBg = { default: "dark", values: [{ name: "dark", value: "#0f1117" }] };

/* ── Skeleton (rows) ─────────────────────────────────────────────────── */
const rowsMeta: Meta<typeof Skeleton> = {
  title: "Components/Skeleton/Rows",
  component: Skeleton,
  parameters: { layout: "centered", backgrounds: darkBg },
  argTypes: { rows: { control: { type: "number", min: 1, max: 10 } } },
};
export default rowsMeta;
type RowsStory = StoryObj<typeof Skeleton>;

export const TwoRows: RowsStory = { args: { rows: 2 } };
export const FourRows: RowsStory = { args: { rows: 4 } };

/* ── CardSkeleton ────────────────────────────────────────────────────── */
export const Cards: StoryObj<typeof CardSkeleton> = {
  render: (args) => <CardSkeleton {...args} />,
  args: { cards: 3 },
  parameters: {
    backgrounds: darkBg,
    docs: {
      description: { story: "Dashboard stat cards, portfolio cards." },
    },
  },
};

/* ── TableSkeleton ───────────────────────────────────────────────────── */
export const Table: StoryObj<typeof TableSkeleton> = {
  render: (args) => <TableSkeleton {...args} />,
  args: { rows: 5, columns: 4 },
  parameters: {
    backgrounds: darkBg,
    docs: {
      description: { story: "Transaction history table, leaderboard rows." },
    },
  },
};

/* ── GraphSkeleton ───────────────────────────────────────────────────── */
export const Graph: StoryObj<typeof GraphSkeleton> = {
  render: (args) => <GraphSkeleton {...args} />,
  args: { bars: 7 },
  parameters: {
    backgrounds: darkBg,
    docs: {
      description: { story: "APY chart / yield graph placeholder." },
    },
  },
};

/* ── FormSkeleton ────────────────────────────────────────────────────── */
export const Form: StoryObj<typeof FormSkeleton> = {
  render: (args) => <FormSkeleton {...args} />,
  args: { fields: 2 },
  parameters: {
    backgrounds: darkBg,
    docs: {
      description: {
        story: "Deposit / withdraw / harvest form while data loads.",
      },
    },
  },
};

/* ── LoadingIndicator ────────────────────────────────────────────────── */
export const LoadingIndeterminate: StoryObj<typeof LoadingIndicator> = {
  render: (args) => <LoadingIndicator {...args} />,
  args: { label: "Processing transaction…" },
  parameters: {
    backgrounds: darkBg,
    docs: {
      description: {
        story: "Indeterminate progress bar — progress prop omitted.",
      },
    },
  },
};

export const LoadingDeterminate: StoryObj<typeof LoadingIndicator> = {
  render: (args) => <LoadingIndicator {...args} />,
  args: { label: "Uploading…", progress: 65 },
  parameters: {
    backgrounds: darkBg,
    docs: {
      description: { story: "Determinate progress bar at 65%." },
    },
  },
};

/* ── All variants side by side ──────────────────────────────────────── */
export const AllVariants: StoryObj = {
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 32,
        padding: 24,
        background: "#0f1117",
        minHeight: "100vh",
      }}
    >
      <section>
        <h3
          style={{
            color: "#9fa8c7",
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 12,
          }}
        >
          Row skeleton (3 rows)
        </h3>
        <Skeleton rows={3} />
      </section>

      <section>
        <h3
          style={{
            color: "#9fa8c7",
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 12,
          }}
        >
          Card skeleton (2 cards)
        </h3>
        <CardSkeleton cards={2} />
      </section>

      <section>
        <h3
          style={{
            color: "#9fa8c7",
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 12,
          }}
        >
          Table skeleton (4 rows × 3 cols)
        </h3>
        <TableSkeleton rows={4} columns={3} />
      </section>

      <section>
        <h3
          style={{
            color: "#9fa8c7",
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 12,
          }}
        >
          Graph skeleton (7 bars)
        </h3>
        <GraphSkeleton bars={7} />
      </section>

      <section>
        <h3
          style={{
            color: "#9fa8c7",
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 12,
          }}
        >
          Form skeleton (2 fields)
        </h3>
        <FormSkeleton fields={2} />
      </section>

      <section>
        <h3
          style={{
            color: "#9fa8c7",
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 12,
          }}
        >
          Loading indicator (indeterminate)
        </h3>
        <LoadingIndicator label="Processing transaction…" />
      </section>
    </div>
  ),
  parameters: { layout: "fullscreen", backgrounds: darkBg },
};
