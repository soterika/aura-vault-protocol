"use client";

/**
 * FreighterNetworkBanner — #248
 *
 * Detects when the connected Freighter wallet is on the wrong Stellar network
 * and displays a dismissible warning banner that disables all transaction buttons
 * until the user switches networks.
 *
 * Acceptance criteria:
 *  ✓ Check getNetworkDetails() after every wallet connection
 *  ✓ Show dismissible banner if network does not match NEXT_PUBLIC_STELLAR_NETWORK
 *  ✓ Banner links to Freighter network settings
 *  ✓ All transaction buttons disabled while mismatch exists (via context)
 *  ✓ Re-check automatically when Freighter fires a network-change event
 *
 * Architecture:
 *   1. FreighterNetworkProvider  — React context that holds mismatch state
 *   2. FreighterNetworkBanner    — Banner UI component
 *   3. useNetworkMismatch()      — Hook for disabling transaction buttons
 *
 * Freighter API reference:
 *   window.freighterApi.getNetworkDetails() → { network, networkUrl, networkPassphrase }
 *   window.freighterApi.addListener("networkChanged", callback)
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

// ─── Freighter API types ───────────────────────────────────────────────────

interface FreighterNetworkDetails {
  network: string;
  networkUrl: string;
  networkPassphrase: string;
}

interface FreighterApi {
  isConnected: () => Promise<boolean>;
  getNetworkDetails: () => Promise<FreighterNetworkDetails>;
  /** Event name may vary; handle both spellings */
  addListener?: (event: string, cb: () => void) => void;
  on?: (event: string, cb: () => void) => void;
}

function getFreighterApi(): FreighterApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as Record<string, unknown>)
    .freighterApi as FreighterApi | undefined;
}

// ─── Expected network (from env) ──────────────────────────────────────────

/**
 * Normalise network strings for comparison.
 * e.g. "TESTNET" === "testnet" === "Test SDF Network ; September 2015"
 */
function normaliseNetwork(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (s.includes("test")) return "testnet";
  if (s.includes("main") || s.includes("public")) return "mainnet";
  if (s.includes("futurenet")) return "futurenet";
  return s;
}

const EXPECTED_NETWORK =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "TESTNET";

// ─── Context ──────────────────────────────────────────────────────────────

interface NetworkMismatchContextValue {
  /** true when the connected wallet is on the wrong network */
  isMismatch: boolean;
  /** The network Freighter is currently on (empty if not connected) */
  connectedNetwork: string;
  /** The network the app expects */
  expectedNetwork: string;
  /** Manually trigger a re-check */
  recheck: () => Promise<void>;
}

const NetworkMismatchContext = createContext<NetworkMismatchContextValue>({
  isMismatch: false,
  connectedNetwork: "",
  expectedNetwork: EXPECTED_NETWORK,
  recheck: async () => {},
});

/**
 * Hook for components (e.g. Deposit / Withdraw buttons) that need to
 * disable themselves during a network mismatch.
 *
 * @example
 *   const { isMismatch } = useNetworkMismatch();
 *   <button disabled={isMismatch}>Deposit</button>
 */
export function useNetworkMismatch() {
  return useContext(NetworkMismatchContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────

/**
 * FreighterNetworkProvider
 *
 * Wrap your app (or just the wallet-connected section) with this provider.
 * It polls Freighter on mount and subscribes to its network-change event.
 */
export function FreighterNetworkProvider({ children }: { children: ReactNode }) {
  const [connectedNetwork, setConnectedNetwork] = useState("");
  const [isMismatch, setIsMismatch] = useState(false);

  const check = useCallback(async () => {
    const api = getFreighterApi();
    if (!api) return;

    try {
      const connected = await api.isConnected();
      if (!connected) {
        setConnectedNetwork("");
        setIsMismatch(false);
        return;
      }
      const details = await api.getNetworkDetails();
      const network = details.network || details.networkPassphrase || "";
      setConnectedNetwork(network);
      setIsMismatch(
        normaliseNetwork(network) !== normaliseNetwork(EXPECTED_NETWORK)
      );
    } catch {
      // Freighter not responding — clear mismatch
      setConnectedNetwork("");
      setIsMismatch(false);
    }
  }, []);

  // Initial check + subscribe to network-change events
  useEffect(() => {
    check();

    const api = getFreighterApi();
    if (!api) return;

    const handler = () => { check(); };

    // Freighter may use addListener or on (API varies by version)
    if (typeof api.addListener === "function") {
      api.addListener("networkChanged", handler);
    } else if (typeof api.on === "function") {
      api.on("networkChanged", handler);
    }

    // Also re-check when the wallet connection state changes in localStorage
    const storageHandler = (e: StorageEvent) => {
      if (e.key === "aura_wallet_state") check();
    };
    window.addEventListener("storage", storageHandler);

    return () => {
      window.removeEventListener("storage", storageHandler);
      // Freighter doesn't expose removeListener in all versions; ignore
    };
  }, [check]);

  return (
    <NetworkMismatchContext.Provider
      value={{
        isMismatch,
        connectedNetwork,
        expectedNetwork: EXPECTED_NETWORK,
        recheck: check,
      }}
    >
      {children}
    </NetworkMismatchContext.Provider>
  );
}

// ─── Banner component ──────────────────────────────────────────────────────

/**
 * FreighterNetworkBanner
 *
 * Renders a full-width amber warning banner when the connected wallet is on
 * the wrong Stellar network. The banner:
 *   - Is dismissible (the user can hide it for the session)
 *   - Links to the Freighter extension settings page
 *   - Disappears automatically when the network mismatch resolves
 *
 * Place this just inside <body>, before the page content.
 *
 * Playwright / Cypress selectors:
 *   data-cy="network-mismatch-banner"   – the banner element
 *   data-cy="network-mismatch-dismiss"  – close button
 *   data-cy="freighter-settings-link"   – link to Freighter settings
 */
export function FreighterNetworkBanner() {
  const { isMismatch, connectedNetwork, expectedNetwork } = useNetworkMismatch();
  const [dismissed, setDismissed] = useState(false);

  // Un-dismiss when the mismatch changes (e.g. user switched network then back)
  useEffect(() => {
    if (isMismatch) setDismissed(false);
  }, [isMismatch]);

  if (!isMismatch || dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-cy="network-mismatch-banner"
      className={[
        "w-full z-50 px-4 py-3",
        "bg-amber-50 dark:bg-amber-950",
        "border-b border-amber-300 dark:border-amber-700",
        "text-amber-900 dark:text-amber-100",
      ].join(" ")}
    >
      <div className="mx-auto max-w-7xl flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        {/* ── Message ─────────────────────────────────────────────────── */}
        <div className="flex items-start gap-2 sm:items-center">
          {/* Warning icon */}
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="flex-shrink-0 mt-0.5 sm:mt-0 text-amber-600 dark:text-amber-400"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9"  x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>

          <p className="text-sm font-medium">
            <span className="font-semibold">Wrong network detected.</span>{" "}
            Your Freighter wallet is connected to{" "}
            <span className="font-mono font-semibold">
              {connectedNetwork || "an unknown network"}
            </span>
            , but this app requires{" "}
            <span className="font-mono font-semibold">{expectedNetwork}</span>.
            All transaction buttons are disabled until you switch.{" "}
            <a
              href="https://www.freighter.app"
              target="_blank"
              rel="noopener noreferrer"
              data-cy="freighter-settings-link"
              className={[
                "underline underline-offset-2 font-semibold",
                "text-amber-800 dark:text-amber-200",
                "hover:text-amber-900 dark:hover:text-amber-100",
                "focus-visible:outline-none focus-visible:ring-2",
                "focus-visible:ring-amber-600 dark:focus-visible:ring-amber-300",
                "rounded-sm",
              ].join(" ")}
            >
              Open Freighter settings ↗
            </a>
          </p>
        </div>

        {/* ── Dismiss button ───────────────────────────────────────────── */}
        <button
          type="button"
          data-cy="network-mismatch-dismiss"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss network mismatch warning"
          className={[
            "flex-shrink-0 self-start sm:self-center",
            "rounded-md p-1",
            "text-amber-700 dark:text-amber-300",
            "hover:bg-amber-100 dark:hover:bg-amber-900",
            "focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-amber-600 dark:focus-visible:ring-amber-300",
            "transition-colors duration-150",
          ].join(" ")}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="18" y1="6"  x2="6"  y2="18" />
            <line x1="6"  y1="6"  x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
