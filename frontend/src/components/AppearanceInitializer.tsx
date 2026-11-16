"use client";

import { useEffect } from "react";
import { applyAppearance, DEFAULT_APPEARANCE, type Appearance } from "@/lib/appearance";

export function AppearanceInitializer() {
  useEffect(() => {
    let active = true;
    try {
      const stored = JSON.parse(localStorage.getItem("aura-appearance") ?? "null") as Appearance | null;
      if (stored?.accentColor && ["small", "medium", "large"].includes(stored.fontSize)) applyAppearance({ ...DEFAULT_APPEARANCE, ...stored });
    } catch { /* Ignore malformed local preferences and retain defaults. */ }
    const token = localStorage.getItem("aura_access_token");
    if (token) {
      void fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/users/preferences`, { headers: { Authorization: `Bearer ${token}` } })
        .then((response) => response.ok ? response.json() : null)
        .then((payload) => {
          const stored = payload?.preferences?.appearance ?? payload?.data?.preferences?.appearance;
          if (active && stored?.accentColor && ["small", "medium", "large"].includes(stored.fontSize)) applyAppearance({ ...DEFAULT_APPEARANCE, ...stored }, true);
        }).catch(() => undefined);
    }
    return () => { active = false; };
  }, []);
  return null;
}
