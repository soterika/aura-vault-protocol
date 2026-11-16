import type { Metadata } from "next";
import AnalyticsDashboard from "@/components/AnalyticsDashboard";

export const metadata: Metadata = {
  title: "Vault Analytics | Aura Vault",
  description: "Historical vault TVL, APY, deposit volume, depositor activity, and share price.",
};

export default function AnalyticsPage() {
  return <AnalyticsDashboard />;
}
