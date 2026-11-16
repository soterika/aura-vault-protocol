"use client";

import { type ButtonHTMLAttributes, type ReactNode, useState } from "react";
import { LoadingSpinner } from "./LoadingSpinner";

interface AnimatedButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
}

export function AnimatedButton({
  children,
  loading = false,
  variant = "primary",
  size = "md",
  disabled = false,
  ...props
}: AnimatedButtonProps) {
  const [pressed, setPressed] = useState(false);

  const variantClasses = {
    primary: "bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600",
    secondary: "bg-zinc-200 hover:bg-zinc-300 text-zinc-900 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-100",
    danger: "bg-red-600 hover:bg-red-700 text-white dark:bg-red-500 dark:hover:bg-red-600",
    ghost: "bg-transparent hover:bg-zinc-100 text-zinc-900 dark:hover:bg-zinc-800 dark:text-zinc-100",
  };

  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
  };

  return (
    <button
      {...props}
      disabled={disabled || loading}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      className={`
        inline-flex items-center justify-center gap-2 rounded-lg font-medium
        transition-all duration-150 ease-out
        active:scale-95
        disabled:opacity-50 disabled:cursor-not-allowed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500
        ${variantClasses[variant]} ${sizeClasses[size]}
        ${pressed ? "scale-95" : "scale-100"}
        ${props.className}
      `}
    >
      {loading ? <LoadingSpinner size="sm" /> : null}
      {!loading && children}
    </button>
  );
}
