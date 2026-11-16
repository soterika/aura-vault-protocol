import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import FAQPage from "@/components/FAQPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "faq" });
  return { title: `${t("title")} — Aura Vault Protocol`, description: t("subtitle") };
}

export default function LocalizedFAQPage() {
  return <FAQPage />;
}
