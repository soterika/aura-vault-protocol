import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import WalletConnect from "@/components/WalletConnect";
import ProgressBar from "@/components/ProgressBar";
import { OnboardingTour } from "@/components/OnboardingTour";
import { HeaderWidgets } from "@/components/HeaderWidgets";
import { NotificationProvider, NotificationCenter } from "@/components/notifications";
import { FreighterNetworkProvider, FreighterNetworkBanner } from "@/components/FreighterNetworkBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aura Vault Protocol",
  description: "Share-based yield vault on Stellar — deposit, compound, and withdraw with Freighter.",
  manifest: "/manifest.json",
  themeColor: "#6366f1",
  appleWebApp: { capable: true, title: "Aura Vault", statusBarStyle: "black-translucent" },
};

const noFlashScript = `(function(){try{var t=localStorage.getItem('aura-theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const t = await getTranslations({ locale, namespace: "nav" });

  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full bg-white text-zinc-900 transition-colors duration-200 dark:bg-zinc-950 dark:text-zinc-100">
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
        <NextIntlClientProvider messages={messages}>
          <FreighterNetworkProvider>
            <ThemeProvider>
              <NotificationProvider>
                <Suspense fallback={null}><ProgressBar /></Suspense>
                <OnboardingTour />
                <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/90">
                  <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
                    <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                      <Image src="/logo.svg" alt="" width={26} height={26} priority />
                      <span>Aura Vault</span>
                    </Link>
                    <HeaderWidgets />
                    <nav aria-label="Main navigation" className="flex items-center gap-3 text-sm">
                      <Link href="/dashboard" className="hover:underline">{t("dashboard")}</Link>
                      <Link href="/faq" className="hover:underline">{t("faq")}</Link>
                      <Link href="/settings" className="hover:underline">{t("settings")}</Link>
                    </nav>
                    <div className="flex items-center gap-2">
                      <NotificationCenter />
                      <LanguageSwitcher />
                      <ThemeToggle />
                      <WalletConnect />
                    </div>
                  </div>
                </header>
                <FreighterNetworkBanner />
                <main className="flex flex-1 flex-col">{children}</main>
                <ServiceWorkerRegistration />
              </NotificationProvider>
            </ThemeProvider>
          </FreighterNetworkProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
