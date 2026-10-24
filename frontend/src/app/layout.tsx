import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppearanceInitializer } from "@/components/AppearanceInitializer";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
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
  description: "Share-based yield vault on Stellar — deposit, compound, and withdraw with Freighter.",
  manifest: "/manifest.json",
  themeColor: "#6366f1",
  appleWebApp: { capable: true, title: "Aura Vault", statusBarStyle: "black-translucent" },
};

const configuredNetwork = (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet").toLowerCase();
const warningNetwork = configuredNetwork === "futurenet" ? "futurenet" : "testnet";
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
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
