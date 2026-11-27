export type Period = "1D" | "7D" | "30D" | "ALL";

export type ActivityPoint = {
  date: string;
  tvl: number;
  deposits: number;
  withdrawals: number;
  uniqueDepositors: number;
  sharePrice: number;
};

export type YieldPoint = {
  date: string;
  apy: number;
  daily_yield: number;
};

export type Stats = {
  total_assets?: number | string;
  totalAssets?: number | string;
  apy7d?: number;
  apy30d?: number;
  sharePrice?: number | string;
  share_price?: number | string;
};

export type DatasetKey = "activity" | "yields" | "stats";

export type DatasetState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
};

export type AnalyticsDatasets = {
  activity: DatasetState<ActivityPoint[]>;
  yields: DatasetState<YieldPoint[]>;
  stats: DatasetState<Stats>;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

export function getDatasetPath(key: DatasetKey, period: Period): string {
  const days = period === "ALL" ? 3650 : Number(period.slice(0, -1));
  switch (key) {
    case "activity":
      return `/api/v1/vault/analytics/history?period=${period}`;
    case "yields":
      return `/api/v1/yield/history?days=${days}`;
    case "stats":
      return "/api/v1/vault/stats";
  }
}

export async function readJson(
  path: string,
  fetcher: typeof fetch = fetch
): Promise<any> {
  const response = await fetcher(`${API}${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Analytics request failed (${response.status})`);
  }
  const payload = await response.json();
  return payload.data ?? payload;
}

export async function fetchDataset(
  key: "activity",
  period: Period,
  fetcher?: typeof fetch
): Promise<ActivityPoint[]>;
export async function fetchDataset(
  key: "yields",
  period: Period,
  fetcher?: typeof fetch
): Promise<YieldPoint[]>;
export async function fetchDataset(
  key: "stats",
  period: Period,
  fetcher?: typeof fetch
): Promise<Stats>;
export async function fetchDataset(
  key: DatasetKey,
  period: Period,
  fetcher: typeof fetch = fetch
): Promise<ActivityPoint[] | YieldPoint[] | Stats> {
  const payload = await readJson(getDatasetPath(key, period), fetcher);
  switch (key) {
    case "activity":
      return payload.history ?? [];
    case "yields":
      return payload.history ?? [];
    case "stats":
      return payload.stats ?? payload;
  }
}

export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unable to load analytics";
}

export async function loadAllDatasets(
  period: Period,
  fetcher: typeof fetch = fetch
): Promise<AnalyticsDatasets> {
  const [activityRes, yieldsRes, statsRes] = await Promise.allSettled([
    fetchDataset("activity", period, fetcher),
    fetchDataset("yields", period, fetcher),
    fetchDataset("stats", period, fetcher),
  ]);

  return {
    activity:
      activityRes.status === "fulfilled"
        ? { data: activityRes.value, loading: false, error: null }
        : { data: [], loading: false, error: toErrorMessage(activityRes.reason) },
    yields:
      yieldsRes.status === "fulfilled"
        ? { data: yieldsRes.value, loading: false, error: null }
        : { data: [], loading: false, error: toErrorMessage(yieldsRes.reason) },
    stats:
      statsRes.status === "fulfilled"
        ? { data: statsRes.value, loading: false, error: null }
        : { data: {}, loading: false, error: toErrorMessage(statsRes.reason) },
  };
}
