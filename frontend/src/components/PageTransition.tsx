"use client";

import { type ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
}

/** Wraps page content with a fade-in entrance animation. */
export default function PageTransition({ children, className = "" }: Props) {
  return (
    <div className={`animate-fade-in ${className}`}>
      {children}
    </div>
  );
}
