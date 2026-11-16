"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme, type Theme } from "./ThemeProvider";

const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "light",
};

export function ThemeToggle() {
  const t = useTranslations("theme");
  const { theme, resolvedTheme, setTheme, mounted } = useTheme();
  const label = t(theme);
  const Icon = !mounted || theme === "system"
    ? Monitor
    : resolvedTheme === "dark"
      ? Moon
      : Sun;

  return (
    <button
      data-cy="theme-toggle-btn"
      data-theme={theme}
      type="button"
      onClick={() => setTheme(NEXT_THEME[theme])}
      aria-label={t("switchTo", { theme: t(NEXT_THEME[theme]) })}
      title={label}
      className="flex items-center justify-center rounded-lg p-2 text-zinc-600 transition-colors duration-200 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-100"
    >
      <Icon aria-hidden="true" size={18} />
    </button>
  );
}
