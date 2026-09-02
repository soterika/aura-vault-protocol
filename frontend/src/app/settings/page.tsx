"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ThemeToggle } from "@/components/ThemeToggle";
import "@/lib/i18n";

interface Settings {
  slippageTolerance: number;
  notifyDeposits: boolean;
  notifyWithdrawals: boolean;
  notifyVaultEvents: boolean;
  emailNotifications: boolean;
  email: string;
  twoFactorEnabled: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  slippageTolerance: 0.5,
  notifyDeposits: true,
  notifyWithdrawals: true,
  notifyVaultEvents: false,
  emailNotifications: false,
  email: "",
  twoFactorEnabled: false,
};

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const stored = localStorage.getItem("aura_settings");
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings) {
  localStorage.setItem("aura_settings", JSON.stringify(settings));
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const slippageOptions = [0.1, 0.5, 1.0, 3.0];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-semibold mb-8">{t("settings.title")}</h1>

        {saved && (
          <div role="status" className="mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400">
            {t("settings.saved")}
          </div>
        )}

        {/* Appearance */}
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">{t("settings.appearance.title")}</h2>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
              {t("settings.appearance.description")}
            </p>
            <ThemeToggle />
          </div>
        </section>

        {/* Wallet Info */}
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">{t("settings.wallet.title")}</h2>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">{t("settings.wallet.no_wallet")}</p>
            <button className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors">
              {t("settings.wallet.connect")}
            </button>
          </div>
        </section>

        {/* Slippage */}
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">{t("settings.slippage.title")}</h2>
          <div className="flex gap-2">
            {slippageOptions.map((val) => (
              <button
                key={val}
                onClick={() => update("slippageTolerance", val)}
                className={`w-full rounded-lg px-4 py-2 text-sm font-medium border transition-colors sm:w-auto ${
                  settings.slippageTolerance === val
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 hover:border-indigo-400"
                }`}
              >
                {val}%
              </button>
            ))}
          </div>
          {settings.slippageTolerance >= 3 && (
            <p className="mt-2 text-xs text-amber-600">{t("settings.slippage.high_warning")}</p>
          )}
        </section>

        {/* Notifications */}
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">{t("settings.notifications.title")}</h2>
          <div className="space-y-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
            {([
              ["notifyDeposits", t("settings.notifications.deposits")] as const,
              ["notifyWithdrawals", t("settings.notifications.withdrawals")] as const,
              ["notifyVaultEvents", t("settings.notifications.vault_events")] as const,
              ["emailNotifications", t("settings.notifications.email")] as const,
            ]).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between cursor-pointer">
                <span className="text-sm">{label}</span>
                <input
                  type="checkbox"
                  checked={settings[key] as boolean}
                  onChange={(e) => update(key, e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                />
              </label>
            ))}
            {settings.emailNotifications && (
              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <label className="text-xs text-zinc-500 block mb-1">{t("settings.notifications.email_address")}</label>
                <input
                  type="email"
                  value={settings.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder={t("settings.notifications.email_placeholder")}
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}
          </div>
        </section>

        {/* Security */}
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">{t("settings.security.title")}</h2>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-sm font-medium">{t("settings.security.two_factor")}</span>
                <p className="text-xs text-zinc-500 mt-0.5">{t("settings.security.two_factor_desc")}</p>
              </div>
              <input
                type="checkbox"
                checked={settings.twoFactorEnabled}
                onChange={(e) => update("twoFactorEnabled", e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
              />
            </label>
          </div>
        </section>

        {/* Danger Zone */}
        <section>
          <h2 className="text-lg font-medium mb-3 text-red-600">{t("settings.danger.title")}</h2>
          <div className="rounded-xl border border-red-200 dark:border-red-900/30 p-4 bg-red-50 dark:bg-red-950/20">
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
              {t("settings.danger.description")}
            </p>
            <button
              onClick={() => setShowDeactivate(true)}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
            >
              {t("settings.danger.deactivate")}
            </button>
            {showDeactivate && (
              <div className="mt-3 p-3 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-zinc-900">
                <p className="text-sm text-red-600 font-medium mb-2">{t("settings.danger.confirm_message")}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDeactivate(false)}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    {t("settings.danger.cancel")}
                  </button>
                  <button className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700">
                    {t("settings.danger.confirm")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
