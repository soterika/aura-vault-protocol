import type { Preview, Decorator } from "@storybook/react-vite";
import { ThemeProvider } from "../src/components/ThemeProvider";
import "../src/styles/global.css";
import "../src/styles/components.css";

const withTheme: Decorator = (Story, context) => {
  const theme = context.globals["theme"] ?? "dark";
  return (
    <ThemeProvider defaultTheme={theme}>
      <div data-theme={theme} style={{ padding: "1.5rem", minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)" }}>
        <Story />
      </div>
    </ThemeProvider>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      name: "Theme",
      description: "Global theme",
      defaultValue: "dark",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "dark",  icon: "moon",    title: "Dark" },
          { value: "light", icon: "sun",     title: "Light" },
        ],
        showName: true,
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: "todo" },
    backgrounds: { disable: true },
    layout: "fullscreen",
    docs: {
      toc: true,
    },
  },
};

export default preview;
