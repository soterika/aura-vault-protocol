import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeProvider, useTheme } from "../components/ThemeProvider";
import { Button } from "../components/Button";
import { IconSun, IconMoon } from "../components/Icons";
import { Badge } from "../components/Primitives";

/**
 * `ThemeProvider` manages the dark/light theme via a `data-theme` attribute on
 * `<html>`. It persists the choice in `localStorage` and respects
 * `prefers-color-scheme` on first load.
 *
 * Use the **Theme** toolbar switcher (top of Storybook) to toggle between themes
 * across all stories at once.
 */
const meta = {
  title: "Theme/ThemeProvider",
  component: ThemeProvider,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof ThemeProvider>;
export default meta;
type Story = StoryObj<typeof meta>;

function Demo() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"1rem", padding:"2rem" }}>
      <Badge variant={theme === "dark" ? "info" : "warning"}>Current theme: {theme}</Badge>
      <Button onClick={toggleTheme} leftIcon={theme === "dark" ? <IconSun size="sm"/> : <IconMoon size="sm"/>}>
        Switch to {theme === "dark" ? "light" : "dark"}
      </Button>
    </div>
  );
}

export const Toggle: Story = {
  render: () => (
    <ThemeProvider>
      <Demo />
    </ThemeProvider>
  ),
};
