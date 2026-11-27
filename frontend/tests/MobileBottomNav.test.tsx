// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import MobileBottomNav from "@/components/MobileBottomNav";

const { mockUsePathname } = vi.hoisted(() => ({ mockUsePathname: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

vi.mock("next/link", () => {
  return { default: function MockLink({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  } };
});

describe("MobileBottomNav", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUsePathname.mockReturnValue("/dashboard");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders a <nav> with aria-label='Primary navigation' and mobile-only visibility", () => {
    render(<MobileBottomNav />);
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(nav).toBeInTheDocument();
    expect(nav).toHaveClass("md:hidden");
  });

  it("renders Vault, History, Leaderboard, and Settings tabs", () => {
    render(<MobileBottomNav />);
    expect(screen.getByRole("link", { name: "Vault" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "/transactions");
    expect(screen.getByRole("link", { name: "Leaderboard" })).toHaveAttribute("href", "/leaderboard");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("highlights the active tab based on the current route", () => {
    mockUsePathname.mockReturnValue("/transactions");
    render(<MobileBottomNav />);
    const historyLink = screen.getByRole("link", { name: "History" });
    expect(historyLink).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Vault" })).not.toHaveAttribute("aria-current");
  });

  it("shows tooltip on hover and on long-press", () => {
    render(<MobileBottomNav />);
    const settingsLink = screen.getByRole("link", { name: "Settings" });

    fireEvent.mouseEnter(settingsLink);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Settings (preferences, wallet, notifications)"
    );

    fireEvent.mouseLeave(settingsLink);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.touchStart(settingsLink);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Settings (preferences, wallet, notifications)"
    );

    fireEvent.touchEnd(settingsLink);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
