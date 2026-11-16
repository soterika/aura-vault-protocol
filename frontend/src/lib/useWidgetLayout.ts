"use client";

import { useCallback, useEffect, useState } from "react";

export type WidgetId = "hero" | "apy" | "depositors" | "last-harvest" | "user-position" | "referral";
export interface WidgetDescriptor { id: WidgetId; label: string; visible: boolean; }
export interface UseWidgetLayoutReturn {
  widgets: WidgetDescriptor[];
  setOrder: (next: WidgetDescriptor[]) => void;
  setVisible: (id: WidgetId, visible: boolean) => void;
}

export const DEFAULT_WIDGETS: WidgetDescriptor[] = [
  { id: "hero", label: "Vault Overview", visible: true },
  { id: "apy", label: "7-Day APY", visible: true },
  { id: "depositors", label: "Depositor Count", visible: true },
  { id: "last-harvest", label: "Last Harvest", visible: true },
  { id: "user-position", label: "My Position", visible: true },
  { id: "referral", label: "Referrals", visible: true },
];

const STORAGE_KEY = "aura_widget_layout";
const API_URL = "/api/users/preferences";

function authHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = window.localStorage.getItem("accessToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function mergeLayout(candidate: unknown): WidgetDescriptor[] {
  if (!Array.isArray(candidate)) return DEFAULT_WIDGETS;
  const values = candidate.filter((entry): entry is Partial<WidgetDescriptor> =>
    !!entry && typeof entry === "object" && typeof (entry as WidgetDescriptor).id === "string",
  );
  const byId = new Map(values.map((entry) => [entry.id, entry]));
  const requestedOrder = values.map((entry) => entry.id).filter((id): id is WidgetId =>
    DEFAULT_WIDGETS.some((widget) => widget.id === id),
  );
  const order = [...new Set([...requestedOrder, ...DEFAULT_WIDGETS.map((widget) => widget.id)])];
  return order.map((id) => {
    const defaults = DEFAULT_WIDGETS.find((widget) => widget.id === id)!;
    const saved = byId.get(id);
    return { ...defaults, visible: typeof saved?.visible === "boolean" ? saved.visible : defaults.visible };
  });
}

function readLocal(): WidgetDescriptor[] {
  try { return mergeLayout(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")); }
  catch { return DEFAULT_WIDGETS; }
}

async function persist(widgets: WidgetDescriptor[]): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
    if (!localStorage.getItem("accessToken")) return;
    await fetch(API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ dashboardWidgets: widgets }),
    });
  } catch {
    // Keep local preferences available when the API or browser storage is unavailable.
  }
}

export function useWidgetLayout(): UseWidgetLayoutReturn {
  const [widgets, setWidgets] = useState<WidgetDescriptor[]>(DEFAULT_WIDGETS);

  useEffect(() => {
    setWidgets(readLocal());
    if (!localStorage.getItem("accessToken")) return;
    const controller = new AbortController();
    void fetch(API_URL, { headers: authHeaders(), signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { preferences?: { dashboardWidgets?: unknown } } | null) => {
        if (!body?.preferences?.dashboardWidgets) return;
        const loaded = mergeLayout(body.preferences.dashboardWidgets);
        setWidgets(loaded);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const setOrder = useCallback((next: WidgetDescriptor[]) => {
    const ordered = mergeLayout(next);
    setWidgets(ordered);
    void persist(ordered);
  }, []);

  const setVisible = useCallback((id: WidgetId, visible: boolean) => {
    setWidgets((current) => {
      const updated = current.map((widget) => widget.id === id ? { ...widget, visible } : widget);
      void persist(updated);
      return updated;
    });
  }, []);

  return { widgets, setOrder, setVisible };
}
