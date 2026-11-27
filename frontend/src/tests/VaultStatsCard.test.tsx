// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { VaultStatsCard, VaultStatsCardSkeleton } from "../components/VaultStatsCard";

describe("VaultStatsCard", () => {
  const defaultProps = {
    apy: "12.45%",
    totalAssets: "1,250,000 USDC",
    yourShares: "4,200.00",
  };

  it("renders primary APY metric centred and secondary metrics in two columns", () => {
    render(<VaultStatsCard {...defaultProps} />);

    const card = screen.getByTestId("vault-stats-card");
    expect(card).toHaveClass("h-[160px]", "sm:h-auto");

    const apyBlock = screen.getByTestId("vault-stat-apy");
    expect(apyBlock).toHaveClass("text-center", "items-center");
    expect(screen.getByText("Current APY")).toBeInTheDocument();
    expect(screen.getByText("12.45%")).toBeInTheDocument();

    expect(screen.getByText("Total Assets")).toBeInTheDocument();
    expect(screen.getByText("1,250,000 USDC")).toBeInTheDocument();

    expect(screen.getByText("Your Shares")).toBeInTheDocument();
    expect(screen.getByText("4,200.00")).toBeInTheDocument();
  });

  it("renders matching skeleton loader when isLoading is true", () => {
    render(<VaultStatsCard {...defaultProps} isLoading />);

    const skeleton = screen.getByTestId("vault-stats-card-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(skeleton).toHaveClass("h-[160px]", "sm:h-auto");
    expect(screen.queryByTestId("vault-stats-card")).not.toBeInTheDocument();
  });

  it("renders VaultStatsCardSkeleton directly with accessible status role", () => {
    render(<VaultStatsCardSkeleton />);
    const skeleton = screen.getByRole("status", { name: "Loading vault statistics" });
    expect(skeleton).toHaveClass("h-[160px]");
  });
});
