export type Appearance = { accentColor: string; fontSize: "small" | "medium" | "large"; compactMode: boolean };
export const DEFAULT_APPEARANCE: Appearance = { accentColor: "#4338ca", fontSize: "medium", compactMode: false };

function luminance(hex: string): number {
  const values = hex.slice(1).match(/.{2}/g)!.map((part) => parseInt(part, 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
}

export function applyAppearance(value: Appearance, persist = false): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const lightContrast = 1.05 / (luminance(value.accentColor) + .05);
  const darkContrast = (luminance(value.accentColor) + .05) / .05;
  root.style.setProperty("--user-accent", value.accentColor);
  root.style.setProperty("--user-accent-foreground", lightContrast >= darkContrast ? "#ffffff" : "#000000");
  root.style.setProperty("--user-font-scale", value.fontSize === "small" ? ".9375" : value.fontSize === "large" ? "1.125" : "1");
  root.dataset.compact = String(value.compactMode);
  if (persist) localStorage.setItem("aura-appearance", JSON.stringify(value));
}
