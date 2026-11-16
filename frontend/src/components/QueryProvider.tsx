"use client";

/**
 * QueryProvider — Issue #1266
 *
 * Wraps the app in @tanstack/react-query's QueryClientProvider.
 * Must be a Client Component because QueryClient uses browser APIs.
 *
 * Config:
 *  - staleTime: 30 s  — data is considered fresh for 30 s after fetch
 *  - gcTime: 5 min    — unused cache entries garbage-collected after 5 min
 *  - retry: 3         — automatic retries with exponential back-off
 *  - refetchOnWindowFocus: true — re-validates on tab focus
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Create QueryClient inside useState so it's stable per component instance
  // and not shared across requests in SSR environments.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,       // 30 s — matches vault stats cache TTL
            gcTime: 5 * 60 * 1000,  // 5 min
            retry: 3,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
            refetchOnWindowFocus: true,
          },
          mutations: {
            retry: 0, // don't retry mutations automatically
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
