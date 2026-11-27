/**
 * Regression tests for release-scoped ServiceWorkerRegistration & SW cache
 * lifecycle — Issue #1464
 *
 * Verifies:
 *  - ServiceWorkerRegistration scopes the SW script URL to the release version.
 *  - Upgrading from one build to the next with a warm cache retires previous
 *    release caches safely on activation and loads new route chunks.
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildServiceWorkerUrl,
  registerServiceWorker,
} from "../components/ServiceWorkerRegistration";

interface MockCacheStore {
  caches: Map<string, Map<string, Response>>;
  open(name: string): Promise<{
    add(url: string): Promise<void>;
    match(req: Request | string): Promise<Response | undefined>;
    put(req: Request | string, res: Response): Promise<void>;
  }>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

function createMockCaches(
  initial: Record<string, string[]> = {}
): MockCacheStore {
  const store = new Map<string, Map<string, Response>>();
  for (const [cacheName, urls] of Object.entries(initial)) {
    const entries = new Map<string, Response>();
    for (const url of urls) {
      entries.set(url, new Response(`cached:${url}`, { status: 200 }));
    }
    store.set(cacheName, entries);
  }

  return {
    caches: store,
    async open(name: string) {
      if (!store.has(name)) {
        store.set(name, new Map());
      }
      const bucket = store.get(name)!;
      return {
        async add(url: string) {
          bucket.set(url, new Response(`precached:${url}`, { status: 200 }));
        },
        async match(req: Request | string) {
          const key = typeof req === "string" ? req : new URL(req.url).pathname;
          return bucket.get(key);
        },
        async put(req: Request | string, res: Response) {
          const key = typeof req === "string" ? req : new URL(req.url).pathname;
          bucket.set(key, res);
        },
      };
    },
    async keys() {
      return Array.from(store.keys());
    },
    async delete(name: string) {
      return store.delete(name);
    },
  };
}

function loadServiceWorker(
  swUrl: string,
  mockCaches: MockCacheStore,
  mockFetch: (input: RequestInfo | URL) => Promise<Response>
) {
  const swPath = path.resolve(__dirname, "../../public/sw.js");
  const code = fs.readFileSync(swPath, "utf8");
  const listeners = new Map<string, (event: unknown) => void>();

  const skipWaiting = vi.fn(async () => {});
  const claim = vi.fn(async () => {});

  const selfObj = {
    location: new URL(swUrl),
    addEventListener(type: string, cb: (event: unknown) => void) {
      listeners.set(type, cb);
    },
    skipWaiting,
    clients: { claim },
  };

  const context = vm.createContext({
    self: selfObj,
    caches: mockCaches,
    fetch: mockFetch,
    URL,
    Request,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    Promise,
  });

  vm.runInContext(code, context);

  return {
    listeners,
    skipWaiting,
    claim,
  };
}

describe("ServiceWorkerRegistration release scoping (#1464)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scopes the service worker registration URL to the release version", async () => {
    const register = vi.fn(async () => ({
      scope: "/",
      addEventListener: vi.fn(),
    })) as unknown as ServiceWorkerContainer["register"];

    const swContainer = {
      register,
      controller: null,
    };

    expect(buildServiceWorkerUrl("2026.11.20-abc")).toBe(
      "/sw.js?v=2026.11.20-abc"
    );

    await registerServiceWorker(swContainer, "2026.11.20-abc");

    expect(register).toHaveBeenCalledWith("/sw.js?v=2026.11.20-abc", {
      scope: "/",
    });
  });

  it("retires previous release caches on upgrade and loads new route chunks", async () => {
    // Warm cache from previous release build-1
    const mockCaches = createMockCaches({
      "aura-shell-build-1": ["/", "/dashboard", "/offline"],
      "aura-static-build-1": ["/_next/static/chunks/old-chunk.js"],
      "aura-api-build-1": ["/api/v1/vaults"],
    });

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      return new Response(`network:${url}`, { status: 200 });
    });

    const sw = loadServiceWorker(
      "https://app.auravault.test/sw.js?v=build-2",
      mockCaches,
      mockFetch
    );

    // Trigger install for build-2
    let installPromise: Promise<void> | undefined;
    sw.listeners.get("install")?.({
      waitUntil: (p: Promise<void>) => {
        installPromise = p;
      },
    });
    await installPromise;

    expect(sw.skipWaiting).toHaveBeenCalledTimes(1);
    expect(mockCaches.caches.has("aura-shell-build-2")).toBe(true);

    // Trigger activate for build-2: old build-1 caches must be retired
    let activatePromise: Promise<void> | undefined;
    sw.listeners.get("activate")?.({
      waitUntil: (p: Promise<void>) => {
        activatePromise = p;
      },
    });
    await activatePromise;

    expect(sw.claim).toHaveBeenCalledTimes(1);
    expect(mockCaches.caches.has("aura-shell-build-1")).toBe(false);
    expect(mockCaches.caches.has("aura-static-build-1")).toBe(false);
    expect(mockCaches.caches.has("aura-api-build-1")).toBe(false);
    expect(mockCaches.caches.has("aura-shell-build-2")).toBe(true);

    // Verify new route chunk loads and caches under build-2
    let chunkResponsePromise: Promise<Response> | undefined;
    sw.listeners.get("fetch")?.({
      request: new Request(
        "https://app.auravault.test/_next/static/chunks/new-route.js",
        { method: "GET" }
      ),
      respondWith: (p: Promise<Response>) => {
        chunkResponsePromise = p;
      },
    });
    const chunkResponse = await chunkResponsePromise;
    expect(chunkResponse?.status).toBe(200);
    expect(await chunkResponse?.text()).toContain("new-route.js");
    expect(mockCaches.caches.has("aura-static-build-2")).toBe(true);
  });
});
