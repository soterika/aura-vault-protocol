import { useState, useCallback } from "react";
import { translateError, createRetryableError } from "./errorTranslator";
import { useNotifications } from "@/components/notifications";
import { startProgress, doneProgress } from "@/components/ProgressBar";

/** Minimum duration (ms) before we show the progress bar. */
const PROGRESS_THRESHOLD_MS = 500;

interface FetchOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
}

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApiCall<T = unknown>() {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });
  const { toast } = useNotifications();

  const fetchWithRetry = useCallback(
    async (url: string, options: FetchOptions = {}) => {
      const { retries = 3, retryDelay = 1000, ...fetchOptions } = options;
      let lastError: unknown;

      // Start a timer: if the call takes longer than PROGRESS_THRESHOLD_MS
      // we show the global progress bar.
      let progressStarted = false;
      const progressTimer = setTimeout(() => {
        progressStarted = true;
        startProgress();
      }, PROGRESS_THRESHOLD_MS);

      try {
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            setState((prev) => ({ ...prev, loading: true, error: null }));

            const response = await fetch(url, fetchOptions);

            if (!response.ok) {
              throw response;
            }

            const data = await response.json();
            setState((prev) => ({ ...prev, data, loading: false, error: null }));
            return data;
          } catch (error) {
            lastError = error;

            const isRetryable = createRetryableError(error);
            const isLastAttempt = attempt === retries;

            if (!isRetryable || isLastAttempt) {
              const errorInfo = translateError(error);
              setState((prev) => ({
                ...prev,
                loading: false,
                error: errorInfo.message,
              }));
              toast("error", errorInfo.title, errorInfo.message);
              throw error;
            }

            const delay = retryDelay * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        throw lastError;
      } finally {
        // Always cancel the pending timer and complete the bar if it started.
        clearTimeout(progressTimer);
        if (progressStarted) {
          doneProgress();
        }
      }
    },
    [toast]
  );

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return { ...state, fetchWithRetry, reset };
}

/**
 * Standalone fetch wrapper that shows the progress bar for calls >500 ms.
 * Use this outside of React components where `useApiCall` is not available.
 *
 * @example
 * const data = await fetchWithProgress('/api/v1/vault/stats');
 */
export async function fetchWithProgress(
  url: string,
  options?: RequestInit
): Promise<Response> {
  let progressStarted = false;

  const progressTimer = setTimeout(() => {
    progressStarted = true;
    startProgress();
  }, PROGRESS_THRESHOLD_MS);

  try {
    const response = await fetch(url, options);
    return response;
  } finally {
    clearTimeout(progressTimer);
    if (progressStarted) {
      doneProgress();
    }
  }
}
