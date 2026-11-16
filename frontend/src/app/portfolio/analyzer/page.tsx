import PortfolioAnalyzer from "@/components/PortfolioAnalyzer";

export const metadata = {
  title: "Portfolio analyser | Aura Vault",
  description: "Compare public Aura Vault positions from a CSV of Stellar wallets.",
};

export default function PortfolioAnalyzerPage() {
  return <PortfolioAnalyzer />;
}
