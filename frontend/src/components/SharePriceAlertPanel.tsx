"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Bell, Trash2, Plus, Check, AlertCircle, X, Mail, ShieldAlert } from "lucide-react";

export type AlertDirection = "above" | "below" | "either";
export type AlertChannel = "toast" | "email";

export interface SharePriceAlert {
  id: string;
  threshold: number; // 1% - 50%
  direction: AlertDirection;
  channels: AlertChannel[];
  email?: string;
  initialPrice?: number;
  lastCheckedPrice?: number;
  lastTriggeredAt?: string | null;
  active: boolean;
  createdAt: string;
}

const STORAGE_KEY = "aura_share_price_alerts";

function loadLocalAlerts(): SharePriceAlert[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalAlerts(alerts: SharePriceAlert[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  } catch {
    /* ignore */
  }
}

interface SharePriceAlertPanelProps {
  currentPrice?: number;
  onClose?: () => void;
  isModal?: boolean;
}

export default function SharePriceAlertPanel({
  currentPrice,
  onClose,
  isModal = false,
}: SharePriceAlertPanelProps) {
  const [alerts, setAlerts] = useState<SharePriceAlert[]>([]);
  const [threshold, setThreshold] = useState<string>("5");
  const [direction, setDirection] = useState<AlertDirection>("either");
  const [notifyToast, setNotifyToast] = useState<boolean>(true);
  const [notifyEmail, setNotifyEmail] = useState<boolean>(false);
  const [email, setEmail] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load existing preferences from API / localStorage
  const fetchAlerts = useCallback(async () => {
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("aura_access_token")
        : null;

    try {
      const res = await fetch("/api/users/preferences", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (res.ok) {
        const data = await res.json();
        const serverAlerts: SharePriceAlert[] =
          data.priceAlerts ?? data.sharePriceAlerts ?? [];
        if (Array.isArray(serverAlerts) && serverAlerts.length > 0) {
          setAlerts(serverAlerts);
          saveLocalAlerts(serverAlerts);
          return;
        }
      }
    } catch {
      // Fallback to local storage if API is unauthenticated / unreachable
    }

    setAlerts(loadLocalAlerts());
  }, []);

  useEffect(() => {
    void fetchAlerts();
  }, [fetchAlerts]);

  // Persist alert list via PUT /api/users/preferences
  const persistAlerts = async (
    updatedAlerts: SharePriceAlert[],
  ): Promise<boolean> => {
    setAlerts(updatedAlerts);
    saveLocalAlerts(updatedAlerts);

    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("aura_access_token")
        : null;

    try {
      const res = await fetch("/api/users/preferences", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          priceAlerts: updatedAlerts,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error) {
          setError(data.error);
          return false;
        }
      }
      return true;
    } catch {
      // Offline fallback: saved to localStorage
      return true;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const numThreshold = parseFloat(threshold);
    if (isNaN(numThreshold) || numThreshold < 1 || numThreshold > 50) {
      setError("Threshold percentage must be between 1% and 50%");
      return;
    }

    const channels: AlertChannel[] = [];
    if (notifyToast) channels.push("toast");
    if (notifyEmail) channels.push("email");

    if (channels.length === 0) {
      setError("Please select at least one notification channel (in-app toast and/or email)");
      return;
    }

    if (notifyEmail && (!email || !/^\S+@\S+\.\S+$/.test(email))) {
      setError("Please enter a valid email address for email notifications");
      return;
    }

    setLoading(true);

    const newAlert: SharePriceAlert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      threshold: numThreshold,
      direction,
      channels,
      email: notifyEmail ? email : undefined,
      initialPrice: currentPrice,
      lastCheckedPrice: currentPrice,
      active: true,
      createdAt: new Date().toISOString(),
    };

    const updated = [newAlert, ...alerts];
    const ok = await persistAlerts(updated);

    setLoading(false);

    if (ok) {
      setSuccessMessage(`Price alert for ${numThreshold}% (${direction}) created successfully`);
      setTimeout(() => setSuccessMessage(null), 3000);
      if (isModal && onClose) {
        setTimeout(onClose, 800);
      }
    }
  };

  const handleDelete = async (id: string) => {
    const updated = alerts.filter((a) => a.id !== id);
    await persistAlerts(updated);
  };

  const containerClasses = isModal
    ? "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-2xl max-w-lg w-full"
    : "rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900";

  return (
    <div className={containerClasses}>
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800 mb-5">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
            <Bell className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Share Price Alerts
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Get notified when the vault share price moves by a defined percentage
            </p>
          </div>
        </div>
        {isModal && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-600 dark:text-red-400"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="mb-4 flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-600 dark:text-emerald-400"
        >
          <Check className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Threshold input (1% - 50%) */}
        <div>
          <label
            htmlFor="price-alert-threshold"
            className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1"
          >
            Movement Threshold Percentage (1% – 50%)
          </label>
          <div className="relative">
            <input
              id="price-alert-threshold"
              type="number"
              min="1"
              max="50"
              step="0.5"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              required
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-8"
              placeholder="e.g. 5"
            />
            <span className="absolute right-3 top-2.5 text-xs text-zinc-400 font-medium">
              %
            </span>
          </div>

          {/* Quick presets */}
          <div className="flex gap-1.5 mt-2">
            {[2, 5, 10, 15, 20].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setThreshold(String(preset))}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  threshold === String(preset)
                    ? "bg-indigo-600 text-white border-indigo-600 font-medium"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                }`}
              >
                {preset}%
              </button>
            ))}
          </div>
        </div>

        {/* Direction: 'above', 'below', or 'either' */}
        <div>
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Trigger Direction
          </span>
          <div
            className="grid grid-cols-3 gap-2"
            role="radiogroup"
            aria-label="Price trigger direction"
          >
            {(
              [
                ["either", "Either (+/-)", "Moves up or down"],
                ["above", "Above (+)", "Price moves up"],
                ["below", "Below (-)", "Price moves down"],
              ] as const
            ).map(([value, label, sub]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={direction === value}
                onClick={() => setDirection(value)}
                className={`p-2 rounded-lg border text-left transition-all ${
                  direction === value
                    ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 text-indigo-700 dark:text-indigo-300 font-medium ring-1 ring-indigo-500"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                }`}
              >
                <div className="text-xs font-medium">{label}</div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400">{sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Notification channels */}
        <div>
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            Notification Channel
          </span>
          <div className="space-y-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyToast}
                onChange={(e) => setNotifyToast(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-zinc-700 dark:text-zinc-300">
                In-app toast notifications
              </span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-zinc-700 dark:text-zinc-300">
                Email notifications
              </span>
            </label>
          </div>

          {notifyEmail && (
            <div className="mt-2.5">
              <label
                htmlFor="price-alert-email"
                className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1"
              >
                Recipient Email Address
              </label>
              <div className="relative">
                <input
                  id="price-alert-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required={notifyEmail}
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 pl-8"
                />
                <Mail className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-2.5" />
              </div>
            </div>
          )}
        </div>

        {/* Submit button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          {loading ? "Saving Alert..." : "Subscribe to Price Alert"}
        </button>
      </form>

      {/* Active alerts list with delete option */}
      <div className="mt-6 pt-5 border-t border-zinc-100 dark:border-zinc-800">
        <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-3 flex items-center justify-between">
          <span>Active Subscriptions ({alerts.length})</span>
          <span className="text-[10px] text-zinc-400 font-normal">Evaluated hourly</span>
        </h3>

        {alerts.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center py-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
            No active share price alerts. Create one above to get notified.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-48 overflow-y-auto">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className="py-2.5 flex items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <span>
                      {alert.threshold}% movement ({alert.direction})
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-0.5">
                    <span>
                      Channels: {alert.channels.join(", ")}
                    </span>
                    {alert.email && <span>• {alert.email}</span>}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDelete(alert.id)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  title="Delete Alert"
                  aria-label={`Delete ${alert.threshold}% ${alert.direction} alert`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
