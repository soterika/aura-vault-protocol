"use client";

/**
 * /ref/[code] — referral landing page.
 *
 * When a user visits this page via a referral link:
 *   1. The referral code is decoded from the URL slug.
 *   2. The decoded address (referrer) is persisted to localStorage under the
 *      key "aura_referral_code" so it can be attached to the user's first
 *      deposit transaction.
 *   3. The visitor is redirected to the dashboard after a short delay.
 *
 * The code is stored as the raw base58 slug (not the decoded address) so
 * the deposit flow can verify it was generated correctly.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { referralCodeToAddress, storeReferralCode } from "@/lib/referral";

interface Props {
  params: { code: string };
}

type State = "loading" | "valid" | "invalid";

const REDIRECT_DELAY_MS = 2500;

export default function ReferralPage({ params }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>("loading");
  const [referrerAddress, setReferrerAddress] = useState<string | null>(null);

  useEffect(() => {
    const { code } = params;
    const address = referralCodeToAddress(code);

    if (!address) {
      setState("invalid");
      return;
    }

    // Persist to localStorage so the deposit modal can read it
    storeReferralCode(code);
    setReferrerAddress(address);
    setState("valid");

    const timer = setTimeout(() => {
      router.push("/dashboard");
    }, REDIRECT_DELAY_MS);

    return () => clearTimeout(timer);
  }, [params, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black px-4">
      <div className="max-w-sm w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center shadow-sm">
        {state === "loading" && (
          <p className="text-sm text-zinc-500">Verifying referral link…</p>
        )}

        {state === "valid" && (
          <>
            {/* Aura logo placeholder */}
            <div
              className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-100"
              aria-hidden="true"
            >
              <span className="text-lg font-bold text-white dark:text-black">
                A
              </span>
            </div>

            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
              You&apos;ve been referred!
            </h1>

            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">
              Referred by:
            </p>
            <p
              className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all mb-4"
              aria-label="Referrer address"
            >
              {referrerAddress
                ? `${referrerAddress.slice(0, 8)}…${referrerAddress.slice(-8)}`
                : "—"}
            </p>

            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Redirecting to the dashboard&hellip;
            </p>

            {/* Progress bar */}
            <div
              className="mt-3 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
              role="progressbar"
              aria-label="Redirect progress"
            >
              <div
                className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100 animate-[shrink_2.5s_linear_forwards]"
                style={{
                  animation: `progress-shrink ${REDIRECT_DELAY_MS}ms linear forwards`,
                }}
              />
            </div>
          </>
        )}

        {state === "invalid" && (
          <>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
              Invalid referral link
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
              This referral link is not valid. You can still sign up and use
              Aura without a referral.
            </p>
            <a
              href="/dashboard"
              className="inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
            >
              Go to Dashboard
            </a>
          </>
        )}
      </div>

      {/* Keyframe for progress bar — injected as a global style */}
      <style>{`
        @keyframes progress-shrink {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </div>
  );
}
