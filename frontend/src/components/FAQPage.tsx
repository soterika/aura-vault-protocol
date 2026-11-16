"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { faqData, categories, type Locale } from "@/lib/faqData";

function faqLocaleFor(locale: string): Locale {
  return locale === "es" || locale === "fr" ? locale : "en";
}

export default function FAQPage() {
  const t = useTranslations("faq");
  const locale = faqLocaleFor(useLocale());
  const items = faqData[locale];
  const localeCategories = categories[locale];
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return items.filter((item) => {
      const matchesCategory = activeCategory === "all" || item.category === activeCategory;
      const matchesQuery = !normalizedQuery ||
        item.q.toLocaleLowerCase(locale).includes(normalizedQuery) ||
        item.a.toLocaleLowerCase(locale).includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [activeCategory, items, locale, query]);

  const grouped = useMemo(() => {
    const result = new Map<string, typeof filtered>();
    for (const item of filtered) {
      const group = result.get(item.category) ?? [];
      group.push(item);
      result.set(item.category, group);
    }
    return result;
  }, [filtered]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-black/[.08] px-6 py-12 dark:border-white/[.1]">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-2 text-3xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mb-6 text-base text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
          <div className="relative">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
            <input
              type="search"
              placeholder={t("search_placeholder")}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActiveCategory("all"); setOpenId(null); }}
              className="w-full rounded-lg border border-black/[.1] bg-transparent py-2.5 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-black/20 dark:border-white/[.15] dark:focus:ring-white/20"
            />
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6 lg:flex-row lg:px-8">
        <nav aria-label={t("categories_label")} className="w-full shrink-0 sm:w-48">
          <ul className="flex flex-row flex-wrap gap-2 overflow-x-auto rounded-xl border border-black/[.08] bg-white/80 p-2 dark:border-white/[.12] dark:bg-zinc-950/70 sm:flex-col sm:gap-1 sm:p-0">
            <li className="min-w-[140px] sm:min-w-0">
              <button onClick={() => { setActiveCategory("all"); setOpenId(null); }} aria-pressed={activeCategory === "all"} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-black/[.04] dark:hover:bg-white/[.05]">
                {t("all_categories")} <span className="ml-1 text-xs text-zinc-400">({items.length})</span>
              </button>
            </li>
            {localeCategories.map((category) => {
              const count = items.filter((item) => item.category === category.id).length;
              return (
                <li key={category.id} className="min-w-[140px] sm:min-w-0">
                  <button onClick={() => { setActiveCategory(category.id); setOpenId(null); }} aria-pressed={activeCategory === category.id} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-black/[.04] dark:hover:bg-white/[.05]">
                    {category.label} <span className="ml-1 text-xs text-zinc-400">({count})</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">{t("no_results")}</p>
          ) : Array.from(grouped.entries()).map(([categoryId, categoryItems]) => (
            <section key={categoryId} className="mb-8">
              {(query !== "" || activeCategory === "all") && (
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  {localeCategories.find((category) => category.id === categoryId)?.label ?? categoryId}
                </h2>
              )}
              <ul className="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-black/[.08] dark:divide-white/[.08] dark:border-white/[.1]">
                {categoryItems.map((item) => {
                  const isOpen = openId === item.id;
                  return (
                    <li key={item.id}>
                      <button onClick={() => setOpenId(isOpen ? null : item.id)} aria-expanded={isOpen} className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-black/[.02] dark:hover:bg-white/[.03]">
                        <span className="text-sm font-medium leading-snug">{item.q}</span>
                        {isOpen ? <ChevronUp aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-zinc-400" /> : <ChevronDown aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-zinc-400" />}
                      </button>
                      {isOpen && <div className="px-5 pb-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{item.a}</div>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <p className="mt-4 text-xs text-zinc-400">
            {t("cant_find")} {" "}
            <a href="https://github.com/soterika/aura-vault-protocol/issues" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
              {t("open_issue")}
            </a>
          </p>
        </main>
      </div>
    </div>
  );
}
