"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

export type BannerType = "info" | "warning" | "critical";

export interface Announcement {
  id: string;
  type: BannerType;
  title: string;
  message?: string;
}

const DISMISSED_KEY = "aura_dismissed_banners";
const MAX_VISIBLE = 2;

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
}

async function fetchAnnouncements(): Promise<Announcement[]> {
  try {
    const res = await fetch("/api/v1/announcements");
    if (!res.ok) throw new Error("fetch failed");
    return res.json();
  } catch {
    // Fallback mock data when endpoint is unavailable
    return [
      {
        id: "ann-001",
        type: "info",
        title: "New Feature: Harvest Analytics",
        message: "View detailed yield breakdowns in your portfolio dashboard.",
      },
    ];
  }
}

const bannerStyles: Record<BannerType, string> = {
  info: "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100",
  warning:
    "bg-yellow-50 dark:bg-yellow-950/40 border-yellow-300 dark:border-yellow-700 text-yellow-900 dark:text-yellow-100",
  critical:
    "bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-700 text-red-900 dark:text-red-100",
};

const iconMap: Record<BannerType, string> = {
  info: "ℹ",
  warning: "⚠",
  critical: "🚨",
};

export default function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDismissed(loadDismissed());
    fetchAnnouncements().then(setAnnouncements);
    setMounted(true);
  }, []);

  // Avoid SSR mismatch — render nothing until client hydration
  if (!mounted) return null;

  const visible = announcements
    .filter((a) => a.type === "critical" || !dismissed.has(a.id))
    .slice(0, MAX_VISIBLE);

  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    saveDismissed(next);
  };

  return (
    <div className="flex flex-col gap-0">
      {visible.map((ann) => (
        <div
          key={ann.id}
          role={ann.type === "critical" ? "alert" : "status"}
          className={`flex items-start gap-3 border-b px-4 py-2.5 text-sm ${
            bannerStyles[ann.type]
          }`}
        >
          <span aria-hidden="true" className="shrink-0 text-base leading-5">
            {iconMap[ann.type]}
          </span>
          <div className="flex-1 min-w-0">
            <span className="font-semibold">{ann.title}</span>
            {ann.message && (
              <span className="ml-1.5 opacity-80">{ann.message}</span>
            )}
          </div>
          {ann.type !== "critical" && (
            <button
              onClick={() => dismiss(ann.id)}
              className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-current"
              aria-label={`Dismiss: ${ann.title}`}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
