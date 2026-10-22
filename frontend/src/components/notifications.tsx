"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";

export type NotificationType = "success" | "error" | "info" | "warning";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  timestamp: number;
  read: boolean;
}

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  toast: (type: NotificationType, title: string, message?: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);
const MAX_HISTORY = 50;
const STORAGE_KEY = "aura_notifications";

function loadHistory(): Notification[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is Notification =>
      item && typeof item.id === "string" && typeof item.title === "string" && typeof item.timestamp === "number" && typeof item.read === "boolean",
    ).slice(-MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function saveHistory(notifications: Notification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(-MAX_HISTORY)));
  } catch {
    // Notifications remain available for the current session if storage is blocked.
  }
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotifications must be used within NotificationProvider");
  return context;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<Notification[]>([]);

  useEffect(() => {
    setNotifications(loadHistory());
  }, []);

  const toast = useCallback((type: NotificationType, title: string, message?: string) => {
    const notification: Notification = {
      id: crypto.randomUUID(), type, title, message, timestamp: Date.now(), read: false,
    };
    setNotifications((current) => {
      const next = [...current, notification].slice(-MAX_HISTORY);
      saveHistory(next);
      return next;
    });
    setToasts((current) => [...current, notification]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== notification.id)), 5000);
  }, []);

  const dismiss = useCallback((id: string) => setToasts((current) => current.filter((item) => item.id !== id)), []);
  const markRead = useCallback((id: string) => {
    setNotifications((current) => {
      const next = current.map((item) => item.id === id ? { ...item, read: true } : item);
      saveHistory(next);
      return next;
    });
  }, []);
  const markAllRead = useCallback(() => {
    setNotifications((current) => {
      const next = current.map((item) => ({ ...item, read: true }));
      saveHistory(next);
      return next;
    });
  }, []);
  const clearAll = useCallback(() => {
    setNotifications([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
  }, []);

  const value = { notifications, unreadCount: notifications.filter((item) => !item.read).length, toast, markRead, markAllRead, dismiss, clearAll };
  return (
    <NotificationContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </NotificationContext.Provider>
  );
}

function ToastContainer({ toasts, dismiss }: { toasts: Notification[]; dismiss: (id: string) => void }) {
  const t = useTranslations("notifications");
  return (
    <div className="fixed right-4 top-4 z-50 flex max-w-sm flex-col gap-2" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} role="status" className={`flex items-start gap-3 rounded-lg border p-3 shadow-lg backdrop-blur-sm ${
          item.type === "success" ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/80" :
          item.type === "error" ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/80" :
          item.type === "warning" ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/80" :
          "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/80"
        }`}>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</p>
            {item.message && <p className="mt-0.5 text-xs text-zinc-500">{item.message}</p>}
          </div>
          <button onClick={() => dismiss(item.id)} className="text-lg leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" aria-label={t("dismiss")}>×</button>
        </div>
      ))}
    </div>
  );
}

export function NotificationCenter() {
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotifications();
  const t = useTranslations("notifications");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const ariaLabel = unreadCount > 0 ? t("unread_aria", { count: unreadCount }) : t("read_aria");

  return (
    <div className="relative">
      <button onClick={() => setOpen((current) => !current)} className="relative rounded-lg p-2 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label={ariaLabel} aria-expanded={open}>
        <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6.002 6.002 0 0 0-4-5.659V5a2 2 0 1 0-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && (
        <section aria-label={t("title")} className="absolute right-0 top-full z-50 mt-2 max-h-96 w-80 overflow-auto rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-100 p-3 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">{t("title")}</h2>
            <div className="flex gap-2">
              <button onClick={markAllRead} className="text-xs text-indigo-600 hover:underline">{t("mark_all_read")}</button>
              <button onClick={clearAll} className="text-xs text-red-500 hover:underline">{t("clear")}</button>
            </div>
          </div>
          {notifications.length === 0 ? <p className="p-6 text-center text-sm text-zinc-400">{t("empty")}</p> : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {[...notifications].reverse().slice(0, 20).map((item) => (
                <button key={item.id} onClick={() => markRead(item.id)} className={`w-full p-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${!item.read ? "bg-indigo-50/50 dark:bg-indigo-950/20" : ""}`}>
                  <span className={`text-sm ${!item.read ? "font-medium" : ""}`}>{item.title}</span>
                  {item.message && <span className="mt-0.5 block text-xs text-zinc-500">{item.message}</span>}
                  <time className="mt-1 block text-[10px] text-zinc-400" dateTime={new Date(item.timestamp).toISOString()}>{format.dateTime(new Date(item.timestamp), { dateStyle: "short", timeStyle: "short" })}</time>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
