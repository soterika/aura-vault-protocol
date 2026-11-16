/**
 * Next.js instrumentation hook.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Next.js calls `register()` once when the server (or edge) starts.
 * We initialise Sentry here so it captures SSR errors too.
 * The client-side init lives in sentry.client.config.ts (loaded via next.config.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
