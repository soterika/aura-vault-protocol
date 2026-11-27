"use client";

import React from "react";
import Link from "next/link";

export type EmptyVariant =
  | "no-transactions"
  | "no-leaderboard"
  | "no-positions"
  | "no-notifications"
  | "no-data"
  | string;

export interface EmptyStateProps {
  variant?: EmptyVariant;
  title?: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  onCtaClick?: () => void;
  headingLevel?: "h2" | "h3" | "h4";
  className?: string;
}

interface VariantConfig {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
}

const variantDefaults: Record<string, VariantConfig> = {
  "no-transactions": {
    title: "No transactions yet",
    description: "Your deposit, withdrawal, and harvest history will appear here.",
    ctaLabel: "Make your first deposit →",
    ctaHref: "/dashboard",
  },
  "no-leaderboard": {
    title: "No depositors yet",
    description: "Be the first to deposit into the vault and claim the top spot.",
    ctaLabel: "Be the first →",
    ctaHref: "/dashboard",
  },
  "no-positions": {
    title: "You have no vault shares",
    description: "Deposit to start earning yield on your assets.",
    ctaLabel: "Deposit to start earning yield →",
    ctaHref: "/dashboard",
  },
  "no-notifications": {
    title: "No notifications",
    description: "You are all caught up. Enable alerts in Preferences to stay updated.",
    ctaLabel: "Enable them in Preferences →",
    ctaHref: "/settings",
  },
  "no-data": {
    title: "No data available",
    description: "Data will appear here once it is available.",
  },
};

function EmptyIllustration({ variant }: { variant: EmptyVariant }) {
  const baseClass = "h-16 w-16 text-zinc-400 dark:text-zinc-500";

  switch (variant) {
    case "no-transactions":
      return (
        <svg
          className={baseClass}
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect
            x="12"
            y="10"
            width="40"
            height="44"
            rx="6"
            className="stroke-current"
            strokeWidth="2.5"
          />
          <path
            d="M22 24H42M22 33H36M22 42H30"
            className="stroke-current"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle
            cx="46"
            cy="46"
            r="10"
            className="fill-indigo-50 stroke-indigo-500 dark:fill-indigo-950 dark:stroke-indigo-400"
            strokeWidth="2.5"
          />
          <path
            d="M46 42V50M42 46H50"
            className="stroke-indigo-600 dark:stroke-indigo-400"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );

    case "no-leaderboard":
      return (
        <svg
          className={baseClass}
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect
            x="8"
            y="34"
            width="14"
            height="20"
            rx="3"
            className="stroke-current"
            strokeWidth="2.5"
          />
          <rect
            x="25"
            y="20"
            width="14"
            height="34"
            rx="3"
            className="fill-indigo-50 stroke-indigo-500 dark:fill-indigo-950 dark:stroke-indigo-400"
            strokeWidth="2.5"
          />
          <rect
            x="42"
            y="28"
            width="14"
            height="26"
            rx="3"
            className="stroke-current"
            strokeWidth="2.5"
          />
          <path
            d="M32 10L33.8 13.6L37.8 14.2L34.9 17L35.6 21L32 19.1L28.4 21L29.1 17L26.2 14.2L30.2 13.6L32 10Z"
            className="fill-indigo-500 dark:fill-indigo-400"
          />
        </svg>
      );

    case "no-positions":
      return (
        <svg
          className={baseClass}
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle
            cx="32"
            cy="32"
            r="22"
            className="stroke-current"
            strokeWidth="2.5"
          />
          <circle
            cx="32"
            cy="32"
            r="14"
            className="fill-indigo-50 stroke-indigo-500 dark:fill-indigo-950 dark:stroke-indigo-400"
            strokeWidth="2"
            strokeDasharray="4 3"
          />
          <path
            d="M32 24V40M26 32H38"
            className="stroke-indigo-600 dark:stroke-indigo-400"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      );

    case "no-notifications":
      return (
        <svg
          className={baseClass}
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M32 12C23.7 12 17 18.7 17 27V38L12 44H52L47 38V27C47 18.7 40.3 12 32 12Z"
            className="stroke-current"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path
            d="M26 44C26 47.3 28.7 50 32 50C35.3 50 38 47.3 38 44"
            className="stroke-current"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle
            cx="45"
            cy="19"
            r="6"
            className="fill-indigo-50 stroke-indigo-500 dark:fill-indigo-950 dark:stroke-indigo-400"
            strokeWidth="2"
          />
        </svg>
      );

    default:
      return (
        <svg
          className={baseClass}
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect
            x="12"
            y="14"
            width="40"
            height="36"
            rx="6"
            className="stroke-current"
            strokeWidth="2.5"
          />
          <path
            d="M22 38L29 30L35 35L42 25"
            className="stroke-indigo-500 dark:stroke-indigo-400"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

export function EmptyState({
  variant = "no-data",
  title,
  description,
  ctaLabel,
  ctaHref,
  onCtaClick,
  headingLevel = "h3",
  className = "",
}: EmptyStateProps) {
  const defaults = variantDefaults[variant] ?? variantDefaults["no-data"];
  const resolvedTitle = title ?? defaults.title;
  const resolvedDescription = description ?? defaults.description;
  const resolvedCtaLabel = ctaLabel ?? defaults.ctaLabel;
  const resolvedCtaHref = ctaHref ?? defaults.ctaHref;

  const Heading = headingLevel;
  const ctaClasses =
    "mt-2 inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:focus-visible:ring-offset-zinc-900";

  return (
    <div
      className={`flex flex-col items-center justify-center gap-2.5 px-4 py-8 text-center ${className}`}
      role="status"
      aria-label={resolvedTitle}
    >
      <EmptyIllustration variant={variant} />
      <Heading className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {resolvedTitle}
      </Heading>
      <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        {resolvedDescription}
      </p>
      {resolvedCtaLabel &&
        (resolvedCtaHref ? (
          <Link href={resolvedCtaHref} className={ctaClasses}>
            {resolvedCtaLabel}
          </Link>
        ) : onCtaClick ? (
          <button type="button" onClick={onCtaClick} className={ctaClasses}>
            {resolvedCtaLabel}
          </button>
        ) : null)}
    </div>
  );
}
