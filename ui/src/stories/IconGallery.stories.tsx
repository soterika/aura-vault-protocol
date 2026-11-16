/**
 * Icons Gallery — Issue #1003
 *
 * Storybook story for the unified icon library.
 * Shows all available icons at 24px (standard) and 16px (inline) variants.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { Icon } from "../components/Icon";
import type { IconName } from "../components/Icon";
import { Icons } from "../components/Icons";

const meta: Meta<typeof Icon> = {
  title: "Design System/Icon Library",
  component: Icon,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
Unified icon library for the Aura Vault Protocol UI.

All icons:
- Sourced from a **single import** (\`ui/src/components/Icons.tsx\`)
- **24×24 px** standard size, **16px** inline/compact variant
- **1.5px stroke weight** — consistent across every glyph
- **aria-hidden by default** — pass \`aria-label\` for meaningful icons
- Coloured via CSS \`currentColor\` — control with Tailwind text utilities

\`\`\`tsx
import { Icon } from "@/components/Icon";

// Decorative
<Icon name="Home" />

// Inline 16px
<Icon name="ChevronRight" size={16} />

// Meaningful — provide label
<Icon name="AlertCircle" aria-label="Warning" />
\`\`\`
        `.trim(),
      },
    },
  },
  argTypes: {
    name: {
      control: "select",
      options: Object.keys(Icons) as IconName[],
    },
    size: {
      control: { type: "number", min: 12, max: 64, step: 4 },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Icon>;

// ─── Single icon playground ───────────────────────────────────────────────────

export const Playground: Story = {
  args: {
    name: "Home",
    size: 24,
  },
};

// ─── Gallery: all icons at 24px ───────────────────────────────────────────────

const allNames = Object.keys(Icons) as IconName[];

export const Gallery: Story = {
  name: "Gallery (24px — standard)",
  render: () => (
    <div className="p-4">
      <p className="mb-4 text-sm text-zinc-500">
        All {allNames.length} icons · 24×24px · 1.5px stroke
      </p>
      <div className="grid grid-cols-6 gap-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12">
        {allNames.map((name) => (
          <div
            key={name}
            className="flex flex-col items-center gap-2 p-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <Icon name={name} size={24} className="text-zinc-700 dark:text-zinc-300" />
            <span className="text-[10px] text-zinc-400 text-center leading-tight break-all">
              {name}
            </span>
          </div>
        ))}
      </div>
    </div>
  ),
};

// ─── Gallery: all icons at 16px ───────────────────────────────────────────────

export const GallerySmall: Story = {
  name: "Gallery (16px — inline)",
  render: () => (
    <div className="p-4">
      <p className="mb-4 text-sm text-zinc-500">
        All {allNames.length} icons · 16×16px · 1.5px stroke (inline variant)
      </p>
      <div className="grid grid-cols-6 gap-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12">
        {allNames.map((name) => (
          <div
            key={name}
            className="flex flex-col items-center gap-2 p-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <Icon name={name} size={16} className="text-zinc-700 dark:text-zinc-300" />
            <span className="text-[9px] text-zinc-400 text-center leading-tight break-all">
              {name}
            </span>
          </div>
        ))}
      </div>
    </div>
  ),
};

// ─── Accessible usage demo ────────────────────────────────────────────────────

export const AccessibilityDemo: Story = {
  name: "Accessibility — aria-label usage",
  render: () => (
    <div className="p-4 space-y-6">
      <div>
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Decorative icons (aria-hidden, no label needed)
        </h3>
        <div className="flex items-center gap-3">
          <Icon name="Home" />
          <span>Dashboard</span>
        </div>
        <pre className="mt-2 text-xs text-zinc-500 bg-zinc-50 dark:bg-zinc-800 p-2 rounded">
          {`<Icon name="Home" />\n<span>Dashboard</span>`}
        </pre>
      </div>

      <div>
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Meaningful icon — provide aria-label
        </h3>
        <button
          type="button"
          className="rounded-full p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Close dialog"
        >
          <Icon name="X" aria-label="Close dialog" />
        </button>
        <pre className="mt-2 text-xs text-zinc-500 bg-zinc-50 dark:bg-zinc-800 p-2 rounded">
          {`<button aria-label="Close dialog">\n  <Icon name="X" aria-label="Close dialog" />\n</button>`}
        </pre>
      </div>

      <div>
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Inline 16px icons in text
        </h3>
        <p className="flex items-center gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          <Icon name="AlertCircle" size={16} aria-label="Warning" className="text-amber-500" />
          Your vault is approaching the TVL cap.
        </p>
        <pre className="mt-2 text-xs text-zinc-500 bg-zinc-50 dark:bg-zinc-800 p-2 rounded">
          {`<Icon name="AlertCircle" size={16} aria-label="Warning" />`}
        </pre>
      </div>
    </div>
  ),
};
