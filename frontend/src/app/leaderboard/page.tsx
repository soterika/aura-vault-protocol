import { Leaderboard } from "@/components/Leaderboard";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export const metadata = {
  title: "Leaderboard — Aura Vault",
  description: "Explore vault position rankings and rank movement over time.",
};

export default function LeaderboardPage() {
  return (
    <ErrorBoundary section="leaderboard">
      <Leaderboard />
    </ErrorBoundary>
  );
}
