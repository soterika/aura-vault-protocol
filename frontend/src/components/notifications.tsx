"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n";

export type NotificationType = "success" | "error" | "info" | "warning";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  timestamp: number;
  read: boolean;
  dismissable?: boolean;
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

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}

const MAX_HISTORY = 50;
const STORAGE_KEY = "aura_notifications";

function loadHistory(): Notification[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(notifications: Notification[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(-MAX_HISTORY)));
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<Notification[]>([]);

  useEffect(() => {
    const history = loadHistory();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (history.length > 0) {
      setNotifications(history);
    }
  }, []);

  const toast = useCallback((type: NotificationType, title: string, message?: string) => {
    const notification: Notification = {
      id: crypto.randomUUID(),
      type,
      title,
      message,
      timestamp: Date.now(),
      read: false,
      dismissable: true,
    };
    setNotifications((prev) => {
      const next = [...prev, notification].slice(-MAX_HISTORY);
      saveHistory(next);
      return next;
    });
    setToasts((prev) => [...prev, notification]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((n) => n.id !== notification.id));
    }, 5000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      saveHistory(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      saveHistory(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, toast, markRead, markAllRead, dismiss, clearAll }}>
      {children}
      {/* Toast container */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm" aria-live="polite">
        {toasts.map((n) => (
          <div
            key={n.id}
            role="status"
            className={`flex items-start gap-3 rounded-lg border p-3 shadow-lg backdrop-blur-sm animate-toast-in ${
              n.type === "success" ? "bg-emerald-50 dark:bg-emerald-950/80 border-emerald-200 dark:border-emerald-800" :
              n.type === "error" ? "bg-red-50 dark:bg-red-950/80 border-red-200 dark:border-red-800" :
              n.type === "warning" ? "bg-amber-50 dark:bg-amber-950/80 border-amber-200 dark:border-amber-800" :
              "bg-blue-50 dark:bg-blue-950/80 border-blue-200 dark:border-blue-800"
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{n.title}</p>
              {n.message && <p className="text-xs text-zinc-500 mt-0.5">{n.message}</p>}
            </div>
            <button
              onClick={() => dismiss(n.id)}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-lg leading-none"
              aria-label={t("notifications.dismiss")}
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function NotificationCenter() {
  const { t } = useTranslation();
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        aria-label={unreadCount > 0 ? t("notifications.unread_aria", { count: unreadCount }) : t("notifications.title")}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl z-50">
          <div className="flex items-center justify-between p-3 border-b border-zinc-100 dark:border-zinc-800">
            <h3 className="text-sm font-semibold">{t("notifications.title")}</h3>
            <div className="flex gap-2">
              <button onClick={markAllRead} className="text-xs text-indigo-600 hover:underline">{t("notifications.mark_all_read")}</button>
              <button onClick={clearAll} className="text-xs text-red-500 hover:underline">{t("notifications.clear")}</button>
            </div>
          </div>
          {notifications.length === 0 ? (
            <p className="p-6 text-center text-sm text-zinc-400">{t("notifications.empty")}</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {[...notifications].reverse().slice(0, 20).map((n) => (
                <button
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className={`w-full text-left p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${!n.read ? "bg-indigo-50/50 dark:bg-indigo-950/20" : ""}`}
                >
                  <p className={`text-sm ${!n.read ? "font-medium" : ""}`}>{n.title}</p>
                  {n.message && <p className="text-xs text-zinc-500 mt-0.5">{n.message}</p>}
                  <p className="text-[10px] text-zinc-400 mt-1">{new Date(n.timestamp).toLocaleString()}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
