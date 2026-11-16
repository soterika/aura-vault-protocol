"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

const LANGUAGES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
  { code: "de", name: "Deutsch", flag: "🇩🇪" },
  { code: "zh", name: "中文", flag: "🇨🇳" },
  { code: "ar", name: "العربية", flag: "🇸🇦" },
] as const;

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function changeLanguage(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextLocale = event.target.value as (typeof LANGUAGES)[number]["code"];
    startTransition(() => router.replace(pathname, { locale: nextLocale }));
  }

  return (
    <div className="relative flex items-center">
      <label htmlFor="language-select" className="sr-only">Language</label>
      <select
        id="language-select"
        aria-label="Language"
        value={locale}
        onChange={changeLanguage}
        disabled={isPending}
        className="appearance-none cursor-pointer rounded-lg border border-zinc-200 bg-white py-1 pl-2 pr-6 text-sm font-medium transition-colors hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
      >
        {LANGUAGES.map(({ code, name, flag }) => (
          <option key={code} value={code}>{flag} {name}</option>
        ))}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-1.5 text-xs text-zinc-400">▾</span>
    </div>
  );
}
