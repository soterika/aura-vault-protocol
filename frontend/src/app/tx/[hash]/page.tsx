'use client';

/**
 * /tx/[hash] — Transaction Status Page
 *
 * Displays status, type, amount, shares, and timestamp for any
 * on-chain transaction hash. Works without a connected wallet.
 *
 * Behaviour:
 *  - Polls the backend every 5 s while the transaction is pending
 *  - "Share" button copies the current URL to the clipboard
 *  - Handles invalid / unknown hashes with a clear 404-style state
 *  - Links out to Stellar Expert for the full ledger record
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

type TxStatus = 'pending' | 'confirmed' | 'failed';
type OperationType = 'Deposit' | 'Withdraw' | 'Harvest';

interface TransactionDetail {
  hash: string;
  status: TxStatus;
  operationType: OperationType;
  amount: string;
  shares: string;
  timestamp: string; // ISO-8601
  ledger?: number;
  explorerUrl: string;
}

type FetchState =
  | { phase: 'loading' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | { phase: 'data'; tx: TransactionDetail };

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;
const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL ??
  'https://stellar.expert/explorer/testnet/tx';
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidHash(hash: string): boolean {
  // Stellar tx hashes are 64-char lowercase hex strings
  return /^[0-9a-f]{64}$/i.test(hash);
}

async function fetchTransaction(hash: string): Promise<TransactionDetail> {
  const res = await fetch(`${API_BASE}/api/v1/transactions/${hash}`, {
    cache: 'no-store',
  });
  if (res.status === 404) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' });
  }
  if (!res.ok) {
    throw new Error(`Unexpected status ${res.status}`);
  }
  const json = await res.json();
  const data = json.data as TransactionDetail;
  return {
    ...data,
    explorerUrl: `${EXPLORER_BASE}/${data.hash}`,
  };
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

// ── Status indicator ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  TxStatus,
  { label: string; icon: string; colour: string }
> = {
  pending: {
    label: 'Pending',
    icon: '⏳',
    colour: 'text-yellow-600 dark:text-yellow-400',
  },
  confirmed: {
    label: 'Confirmed',
    icon: '✓',
    colour: 'text-green-700 dark:text-green-400',
  },
  failed: {
    label: 'Failed',
    icon: '✕',
    colour: 'text-red-700 dark:text-red-400',
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function TransactionStatusPage() {
  const params = useParams();
  const hash = typeof params?.hash === 'string' ? params.hash : '';

  const [state, setState] = useState<FetchState>({ phase: 'loading' });
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch (+ poll while pending) ──────────────────────────────
  const load = useCallback(async () => {
    if (!isValidHash(hash)) {
      setState({ phase: 'not_found' });
      return;
    }

    try {
      const tx = await fetchTransaction(hash);
      setState({ phase: 'data', tx });

      if (tx.status !== 'pending') {
        // Stop polling once terminal state is reached
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'NOT_FOUND') {
        setState({ phase: 'not_found' });
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } else {
        setState({
          phase: 'error',
          message:
            err instanceof Error ? err.message : 'Failed to fetch transaction',
        });
      }
    }
  }, [hash]);

  useEffect(() => {
    load();

    // Start polling — will be stopped once the tx reaches a final state
    pollRef.current = setInterval(load, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  // ── Share / copy URL ──────────────────────────────────────────
  const handleShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. non-secure origin in tests)
      // Silently skip — the URL is still visible in the address bar
    }
  }, []);

  // ── Render states ─────────────────────────────────────────────

  if (state.phase === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center gap-3 text-gray-500"
        >
          <svg
            className="animate-spin h-8 w-8 text-indigo-500"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          <p className="text-sm">Loading transaction…</p>
        </div>
      </main>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <p className="text-5xl" aria-hidden="true">🔍</p>
          <h1 className="text-xl font-semibold">Transaction not found</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            The hash{' '}
            <code className="font-mono text-xs break-all">{hash || '(none)'}</code>{' '}
            does not match any transaction on this network. Double-check the
            URL and try again.
          </p>
          <Link
            href="/"
            className="inline-block mt-2 text-sm text-indigo-600 dark:text-indigo-400 underline underline-offset-2"
          >
            ← Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (state.phase === 'error') {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <p className="text-5xl" aria-hidden="true">⚠️</p>
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {state.message}
          </p>
          <button
            onClick={load}
            className="mt-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  // state.phase === 'data'
  const { tx } = state;
  const status = STATUS_CONFIG[tx.status];

  const shortHash = `${tx.hash.slice(0, 8)}…${tx.hash.slice(-8)}`;

  return (
    <main className="min-h-screen py-10 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* ── Header ───────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-indigo-600 dark:text-indigo-400 underline underline-offset-2"
            aria-label="Back to dashboard"
          >
            ← Dashboard
          </Link>

          <button
            onClick={handleShare}
            aria-label="Copy page URL to clipboard"
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border',
              'transition-colors duration-150',
              copied
                ? 'border-green-500 text-green-700 dark:text-green-400'
                : 'border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
            ].join(' ')}
          >
            {copied ? (
              <>
                <span aria-hidden="true">✓</span> Copied!
              </>
            ) : (
              <>
                <span aria-hidden="true">🔗</span> Share
              </>
            )}
          </button>
        </div>

        {/* ── Card ─────────────────────────────────────────────── */}
        <article
          aria-label="Transaction details"
          className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm overflow-hidden"
        >
          {/* Status banner */}
          <div
            className={`px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3`}
          >
            <span
              className={`text-2xl ${status.colour}`}
              aria-hidden="true"
            >
              {status.icon}
            </span>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Status
              </p>
              <p className={`text-lg font-semibold ${status.colour}`}>
                {status.label}
                {tx.status === 'pending' && (
                  <span
                    className="ml-2 inline-block animate-pulse text-sm"
                    aria-label="Checking for updates…"
                  >
                    …
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Details grid */}
          <dl className="divide-y divide-gray-100 dark:divide-gray-800">
            <Row label="Transaction Hash">
              <div className="flex items-center gap-2">
                <code
                  className="text-xs font-mono break-all"
                  title={tx.hash}
                >
                  {shortHash}
                </code>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(tx.hash);
                  }}
                  aria-label="Copy full transaction hash"
                  className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                >
                  <CopyIcon />
                </button>
              </div>
            </Row>

            <Row label="Operation">{tx.operationType}</Row>

            <Row label="Amount">{tx.amount}</Row>

            <Row label="Shares">{tx.shares}</Row>

            <Row label="Time">{formatDate(tx.timestamp)}</Row>

            {tx.ledger != null && (
              <Row label="Ledger">#{tx.ledger.toLocaleString()}</Row>
            )}
          </dl>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800">
            <a
              href={tx.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
            >
              View on Stellar Expert
              <ExternalLinkIcon />
            </a>
          </div>
        </article>
      </div>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-start gap-4 px-6 py-3">
      <dt className="text-sm text-gray-500 dark:text-gray-400 shrink-0 w-32">
        {label}
      </dt>
      <dd className="text-sm text-right text-gray-900 dark:text-gray-100 break-all">
        {children}
      </dd>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
