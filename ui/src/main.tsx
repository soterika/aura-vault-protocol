import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import "./styles/components.css";
import { ThemeProvider } from "./components/ThemeProvider";
import App from "./App";

if (import.meta.env.DEV) {
  const { default: axe } = await import("@axe-core/react");
  const React = await import("react");
  const ReactDOM = await import("react-dom");
  axe(React.default, ReactDOM.default, 1000);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
);
