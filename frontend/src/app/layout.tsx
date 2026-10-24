import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppearanceInitializer } from "@/components/AppearanceInitializer";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import WalletConnect from "@/components/WalletConnect";
import ProgressBar from "@/components/ProgressBar";
import { OnboardingTour } from "@/components/OnboardingTour";
import { HeaderWidgets } from "@/components/HeaderWidgets";
import { ToastProvider } from "@/components/toast";
import { NotificationCenter, NotificationProvider } from "@/components/notifications";
import NavHeader from "@/components/NavHeader";
import { FreighterNetworkBanner, FreighterNetworkProvider } from "@/components/FreighterNetworkBanner";
import { NetworkStatusBanner } from "@/components/NetworkStatusBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aura Vault Protocol",
  description: "Automated yield vaults on Stellar and Soroban",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Aura Vault", statusBarStyle: "black-translucent" },
};

const configuredNetwork = (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet").toLowerCase();
const warningNetwork = configuredNetwork === "futurenet" ? "futurenet" : "testnet";
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const noFlashScript = `(function(){try{var t=localStorage.getItem('aura-theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-white text-zinc-900 transition-colors duration-200 dark:bg-zinc-950 dark:text-zinc-100">
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
        <ThemeProvider>
          <AppearanceInitializer />
          <NextIntlClientProvider messages={messages}>
            <ToastProvider>
              <NotificationProvider>
                <FreighterNetworkProvider>
                  {configuredNetwork !== "mainnet" && <NetworkStatusBanner network={warningNetwork} />}
                  <FreighterNetworkBanner />
                  <Suspense fallback={null}><ProgressBar /></Suspense>
                  <OnboardingTour />
                  <NavHeader />
                  <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-6">
                    <HeaderWidgets />
                    <div className="flex items-center gap-4">
                      <WalletConnect />
                      <NotificationCenter />
                      <LanguageSwitcher />
                      <ThemeToggle />
                    </div>
                  </header>
                  <main className="flex flex-1 flex-col">{children}</main>
                  <ServiceWorkerRegistration />
                </FreighterNetworkProvider>
              </NotificationProvider>
            </ToastProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
