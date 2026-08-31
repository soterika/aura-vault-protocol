import type { Metadata } from "next";
import VaultDashboard from "@/components/VaultDashboard";

export const metadata: Metadata = {
  title: "Aura Vault",
  description: "Aura Vault Protocol dashboard",
};

export default function Home() {
  return <VaultDashboard />;
}
