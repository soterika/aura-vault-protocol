"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

const STORAGE_KEY = "aura:ui:sections";
type SectionState = Record<string, boolean>;

function readState(): SectionState {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as SectionState : {};
  } catch {
    return {};
  }
}

export default function CollapsibleSection({ id, title, children, className = "" }: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useLayoutEffect(() => {
    setCollapsed(readState()[id] === true);
  }, [id]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readState(), [id]: next })); } catch { /* persistence is optional */ }
  }

  return (
    <section className={className} data-collapsible-section={id}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        <button type="button" aria-expanded={!collapsed} aria-controls={`${id}-content`} onClick={toggle}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
          {collapsed ? "Expand" : "Collapse"}
          <ChevronDown size={16} aria-hidden="true" className={`transition-transform duration-200 ${collapsed ? "-rotate-90" : "rotate-0"}`} />
        </button>
      </header>
      <div id={`${id}-content`} aria-hidden={collapsed} inert={collapsed} className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}>
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </section>
  );
}
