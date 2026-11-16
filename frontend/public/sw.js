/**
 * Aura Vault Protocol — Service Worker
 * Issue #284: Progressive Web App
 *
 * Strategy:
 *   - App shell (HTML, CSS, JS, fonts): Cache-first with network update
 *   - Static assets (_next/static): Cache-first (immutable, versioned)
 *   - API requests (/api/*): Network-first with 5 s timeout fallback
 *   - Offline fallback: /offline served from cache when network fails
 *
 * Cache names are versioned so old workers clean up on activation.
 */

const CACHE_VERSION = "v1";
const SHELL_CACHE = `aura-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `aura-static-${CACHE_VERSION}`;
const API_CACHE = `aura-api-${CACHE_VERSION}`;

/** Resources to pre-cache on install (app shell). */
const SHELL_URLS = [
  "/",
  "/offline",
  "/dashboard",
  "/faq",
  "/manifest.json",
];

// ── Install ────────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Pre-cache shell pages; ignore individual failures so a missing
      // screenshot or icon doesn't block the SW from installing.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)));
      // Activate immediately — don't wait for old clients to close.
      await self.skipWaiting();
    })()
  );
});

// ── Activate ───────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Delete caches from older versions.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              k !== SHELL_CACHE && k !== STATIC_CACHE && k !== API_CACHE
          )
          .map((k) => caches.delete(k))
      );
      // Take control of all open pages immediately.
      await self.clients.claim();
    })()
  );
});

// ── Fetch ──────────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET requests and cross-origin requests (e.g. Horizon, RPC).
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // SSE streams must never be intercepted by the service worker.
  if (url.pathname.startsWith("/api/v1/events/stream")) {
    return;
  }

  // ── Immutable Next.js static assets: cache-first, no expiry ───────────────
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── API requests: network-first with 5 s timeout ──────────────────────────
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE, 5_000));
    return;
  }

  // ── App shell pages: stale-while-revalidate ────────────────────────────────
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

// ── Strategies ────────────────────────────────────────────────────────────────

/**
 * Cache-first: serve from cache; fetch and update on miss.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback();
  }
}

/**
 * Network-first with timeout: try network, fall back to cache, then offline.
 */
async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);

    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached ?? offlineFallback();
  }
}

/**
 * Stale-while-revalidate: serve from cache immediately, update in background.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached ?? (await networkFetch) ?? offlineFallback();
}

/**
 * Return the offline fallback page from the shell cache.
 */
async function offlineFallback() {
  const cache = await caches.open(SHELL_CACHE);
  return (
    (await cache.match("/offline")) ??
    new Response("<h1>Offline</h1><p>Please check your connection.</p>", {
      headers: { "Content-Type": "text/html" },
    })
  );
}
