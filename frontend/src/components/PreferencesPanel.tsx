"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";

export interface UserPreferencesState {
  notifications: {
    emailOnHarvest: boolean;
    emailOnDeposit: boolean;
    harvestThresholdUsd: number;
  };
  display: {
    darkMode: boolean;
    timezone: string;
    numberFormat: "comma" | "space" | "period";
  };
  privacy: {
    addressDisplay: "full" | "truncated";
    optOutLeaderboard: boolean;
  };
  wallet: {
    defaultWallet: string;
    autoConnect: boolean;
  };
}

const DEFAULT_PREFERENCES: UserPreferencesState = {
  notifications: {
    emailOnHarvest: true,
    emailOnDeposit: true,
    harvestThresholdUsd: 25,
  },
  display: {
    darkMode: false,
    timezone: "UTC",
    numberFormat: "comma",
  },
  privacy: {
    addressDisplay: "truncated",
    optOutLeaderboard: false,
  },
  wallet: {
    defaultWallet: "freighter",
    autoConnect: true,
  },
};

type SectionKey = keyof UserPreferencesState;

const SECTION_META: Array<{ key: SectionKey; title: string; description: string }> = [
  { key: "notifications", title: "Notifications", description: "Email alerts and harvest threshold triggers" },
  { key: "display", title: "Display", description: "Theme, time zone, and number formatting" },
  { key: "privacy", title: "Privacy", description: "Address visibility and leaderboard participation" },
  { key: "wallet", title: "Wallet", description: "Default wallet provider and auto-connect behavior" },
];

const TIMEZONES = ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Tokyo"];
const WALLETS = [
  { id: "freighter", label: "Freighter" },
  { id: "xbull", label: "xBull" },
  { id: "albedo", label: "Albedo" },
  { id: "lobstr", label: "LOBSTR" },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export function PreferencesPanel() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<UserPreferencesState>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    notifications: true,
    display: false,
    privacy: false,
    wallet: false,
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("aura_access_token") : null;
    if (!token) {
      setAuthenticated(false);
      setLoading(false);
      return;
    }

    setAuthenticated(true);
    let cancelled = false;

    fetch(`${API_BASE}/api/users/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((payload) => {
        if (cancelled) return;
        const remote = payload?.preferences ?? {};
        setPrefs({
          notifications: { ...DEFAULT_PREFERENCES.notifications, ...remote.notifications },
          display: { ...DEFAULT_PREFERENCES.display, ...remote.display },
          privacy: { ...DEFAULT_PREFERENCES.privacy, ...remote.privacy },
          wallet: { ...DEFAULT_PREFERENCES.wallet, ...remote.wallet },
        });
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("Failed to load preferences", "Using default settings.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [toast]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const persistPreferences = useCallback(
    (next: UserPreferencesState) => {
      const token = typeof window !== "undefined" ? localStorage.getItem("aura_access_token") : null;
      if (!token) {
        toast.error("Authentication required", "Please sign in to save preferences.");
        return;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/users/preferences`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(next),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          toast.success("Preferences saved");
        } catch {
          toast.error("Save failed", "Unable to update your preferences.");
        }
      }, 500);
    },
    [toast],
  );

  const updateSection = <K extends SectionKey>(
    section: K,
    patch: Partial<UserPreferencesState[K]>,
  ) => {
    setPrefs((prev) => {
      const next: UserPreferencesState = {
        ...prev,
        [section]: { ...prev[section], ...patch },
      };
      persistPreferences(next);
      return next;
    });
  };

  const toggleSection = (key: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleHeaderKeyDown = (index: number, e: React.KeyboardEvent<HTMLButtonElement>) => {
    const count = SECTION_META.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      headerRefs.current[(index + 1) % count]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      headerRefs.current[(index - 1 + count) % count]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      headerRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      headerRefs.current[count - 1]?.focus();
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 mb-8" aria-busy="true" aria-label="Loading preferences">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 animate-pulse"
          >
            <div className="h-4 w-36 bg-zinc-200 dark:bg-zinc-800 rounded mb-2" />
            <div className="h-3 w-56 bg-zinc-100 dark:bg-zinc-800/60 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div
        role="alert"
        className="mb-8 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-5 text-sm text-amber-900 dark:text-amber-200"
      >
        Connect and authenticate your wallet to view and manage your account preferences.
      </div>
    );
  }

  return (
    <div className="space-y-3 mb-8" aria-label="User Preferences">
      {SECTION_META.map((section, idx) => {
        const isOpen = openSections[section.key];
        const panelId = `prefs-panel-${section.key}`;
        const headerId = `prefs-header-${section.key}`;

        return (
          <div
            key={section.key}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden"
          >
            <button
              ref={(el) => {
                headerRefs.current[idx] = el;
              }}
              id={headerId}
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggleSection(section.key)}
              onKeyDown={(e) => handleHeaderKeyDown(idx, e)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <div>
                <h2 className="text-base font-medium">{section.title}</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{section.description}</p>
              </div>
              <span aria-hidden="true" className="text-zinc-400 text-sm">
                {isOpen ? "−" : "+"}
              </span>
            </button>

            {isOpen && (
              <div
                id={panelId}
                role="region"
                aria-labelledby={headerId}
                className="px-4 pb-4 pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-3"
              >
                {section.key === "notifications" && (
                  <>
                    <label className="flex items-center justify-between text-sm">
                      <span>Email on harvest</span>
                      <input
                        type="checkbox"
                        checked={prefs.notifications.emailOnHarvest}
                        onChange={(e) => updateSection("notifications", { emailOnHarvest: e.target.checked })}
                        className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </label>
                    <label className="flex items-center justify-between text-sm">
                      <span>Email on deposit</span>
                      <input
                        type="checkbox"
                        checked={prefs.notifications.emailOnDeposit}
                        onChange={(e) => updateSection("notifications", { emailOnDeposit: e.target.checked })}
                        className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </label>
                    <label className="flex items-center justify-between text-sm gap-4">
                      <span>Harvest threshold (USD)</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={prefs.notifications.harvestThresholdUsd}
                        onChange={(e) =>
                          updateSection("notifications", {
                            harvestThresholdUsd: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-28 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </label>
                  </>
                )}

                {section.key === "display" && (
                  <>
                    <label className="flex items-center justify-between text-sm">
                      <span>Dark mode</span>
                      <input
                        type="checkbox"
                        checked={prefs.display.darkMode}
                        onChange={(e) => updateSection("display", { darkMode: e.target.checked })}
                        className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </label>
                    <label className="flex items-center justify-between text-sm gap-4">
                      <span>Default time zone</span>
                      <select
                        value={prefs.display.timezone}
                        onChange={(e) => updateSection("display", { timezone: e.target.value })}
                        className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        {TIMEZONES.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center justify-between text-sm gap-4">
                      <span>Number format (thousands separator)</span>
                      <select
                        value={prefs.display.numberFormat}
                        onChange={(e) =>
                          updateSection("display", {
                            numberFormat: e.target.value as UserPreferencesState["display"]["numberFormat"],
                          })
                        }
                        className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="comma">1,234.56 (Comma)</option>
                        <option value="space">1 234.56 (Space)</option>
                        <option value="period">1.234,56 (Period)</option>
                      </select>
                    </label>
                  </>
                )}

                {section.key === "privacy" && (
                  <>
                    <label className="flex items-center justify-between text-sm gap-4">
                      <span>Address display</span>
                      <select
                        value={prefs.privacy.addressDisplay}
                        onChange={(e) =>
                          updateSection("privacy", {
                            addressDisplay: e.target.value as "full" | "truncated",
                          })
                        }
                        className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="truncated">Truncated (GABC...XYZ)</option>
                        <option value="full">Full address</option>
                      </select>
                    </label>
                    <label className="flex items-center justify-between text-sm">
                      <span>Opt-out from leaderboard</span>
                      <input
                        type="checkbox"
                        checked={prefs.privacy.optOutLeaderboard}
                        onChange={(e) => updateSection("privacy", { optOutLeaderboard: e.target.checked })}
                        className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </label>
                  </>
                )}

                {section.key === "wallet" && (
                  <>
                    <label className="flex items-center justify-between text-sm gap-4">
                      <span>Default wallet</span>
                      <select
                        value={prefs.wallet.defaultWallet}
                        onChange={(e) => updateSection("wallet", { defaultWallet: e.target.value })}
                        className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        {WALLETS.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center justify-between text-sm">
                      <span>Auto-connect on load</span>
                      <input
                        type="checkbox"
                        checked={prefs.wallet.autoConnect}
                        onChange={(e) => updateSection("wallet", { autoConnect: e.target.checked })}
                        className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
