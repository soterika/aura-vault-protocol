import type { Meta, StoryObj } from "@storybook/react";

/**
 * Spacing Scale — Aura Vault Design System
 *
 * Visual reference for the 4px base-grid spacing tokens defined in
 * ui/src/styles/tokens.css.
 *
 * Each swatch shows the token name, pixel value, and a proportionally-sized
 * coloured bar so you can see the scale at a glance.
 */

const SPACING_SCALE = [
  { token: "--spacing-xs",  label: "xs",  px: 4,  rem: "0.25rem" },
  { token: "--spacing-sm",  label: "sm",  px: 8,  rem: "0.5rem"  },
  { token: "--spacing-md",  label: "md",  px: 16, rem: "1rem"    },
  { token: "--spacing-lg",  label: "lg",  px: 24, rem: "1.5rem"  },
  { token: "--spacing-xl",  label: "xl",  px: 32, rem: "2rem"    },
  { token: "--spacing-2xl", label: "2xl", px: 48, rem: "3rem"    },
  { token: "--spacing-3xl", label: "3xl", px: 64, rem: "4rem"    },
] as const;

function SpacingRow({
  token,
  label,
  px,
  rem,
}: (typeof SPACING_SCALE)[number]) {
  return (
    <tr style={{ borderBottom: "1px solid #22263a" }}>
      <td
        style={{
          padding: "12px 16px",
          fontFamily: "monospace",
          color: "#7c83fd",
          whiteSpace: "nowrap",
        }}
      >
        {token}
      </td>
      <td
        style={{
          padding: "12px 16px",
          fontWeight: 600,
          color: "#e8eaf6",
        }}
      >
        {label}
      </td>
      <td style={{ padding: "12px 16px", color: "#9fa8c7" }}>{px}px</td>
      <td style={{ padding: "12px 16px", color: "#9fa8c7" }}>{rem}</td>
      <td style={{ padding: "12px 16px", width: "40%" }}>
        <div
          style={{
            height: 24,
            width: px * 2,
            maxWidth: "100%",
            borderRadius: 4,
            background:
              "linear-gradient(90deg, #7c83fd, #9da3fe)",
          }}
          aria-label={`Spacing swatch — ${px}px`}
        />
      </td>
    </tr>
  );
}

function SpacingPage() {
  return (
    <div
      style={{
        background: "#0f1117",
        minHeight: "100vh",
        padding: 32,
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#e8eaf6",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: 8 }}>
        Spacing Scale
      </h1>
      <p style={{ color: "#9fa8c7", marginBottom: 32, maxWidth: 560 }}>
        4px base grid. All values are multiples of 4px. Use{" "}
        <code
          style={{
            background: "#1a1d27",
            padding: "2px 6px",
            borderRadius: 4,
            fontFamily: "monospace",
          }}
        >
          var(--spacing-*)
        </code>{" "}
        CSS custom properties in components.
      </p>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          background: "#1a1d27",
          borderRadius: 8,
          overflow: "hidden",
        }}
        aria-label="Spacing scale tokens"
      >
        <thead>
          <tr style={{ background: "#22263a" }}>
            {["Token", "Name", "px", "rem", "Visual"].map((h) => (
              <th
                key={h}
                style={{
                  padding: "10px 16px",
                  textAlign: "left",
                  fontSize: "0.8rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#9fa8c7",
                  fontWeight: 600,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SPACING_SCALE.map((s) => (
            <SpacingRow key={s.token} {...s} />
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 48 }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: 16 }}>
          Usage Examples
        </h2>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            maxWidth: 560,
          }}
        >
          {SPACING_SCALE.map(({ token, label, px }) => (
            <div
              key={token}
              style={{ display: "flex", alignItems: "center", gap: 16 }}
            >
              <code
                style={{
                  width: 160,
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  color: "#7c83fd",
                  flexShrink: 0,
                }}
              >
                var({token})
              </code>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: px,
                  background: "#1a1d27",
                  padding: 8,
                  borderRadius: 4,
                  flex: 1,
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    background: "#7c83fd",
                    borderRadius: 4,
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    width: 24,
                    height: 24,
                    background: "#4caf84",
                    borderRadius: 4,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "#9fa8c7",
                    marginLeft: 4,
                  }}
                >
                  {label} gap ({px}px)
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const meta: Meta = {
  title: "Design System/Spacing",
  component: SpacingPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Visual reference for the Aura Vault spacing scale. All tokens are defined in `ui/src/styles/tokens.css`.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

/** Full spacing scale with visual swatches and usage examples */
export const SpacingScale: Story = {};
