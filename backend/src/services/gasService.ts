import { getRedis } from "../redis.js";
import { cacheGet, cacheSet, NS } from "../cache.js";

export type GasFeeTier = "low" | "standard" | "fast";

export interface GasTierQuote {
  maxFeePerGasWei: string;
  maxPriorityFeePerGasWei: string;
  maxFeePerGasGwei: string;
  maxPriorityFeePerGasGwei: string;
  estimatedTxFeeWei: string;
  estimatedTxFeeGwei: string;
}

export interface GasHistoryEntry {
  chainId: number;
  fetchedAt: string;
  source: "feeHistory" | "gasPrice" | "fallback";
  congestion: boolean;
  baseFeePerGasWei: string;
  gasPriceWei: string;
  lowWei: string;
  standardWei: string;
  fastWei: string;
}

export interface GasEstimateResponse {
  chainId: number;
  fetchedAt: string;
  cached: boolean;
  source: "feeHistory" | "gasPrice" | "fallback";
  congestion: boolean;
  gasLimit: string;
  observed: {
    baseFeePerGasWei: string | null;
    gasPriceWei: string | null;
    averageGasUsedRatio: number | null;
  };
  low: GasTierQuote;
  standard: GasTierQuote;
  fast: GasTierQuote;
  history: GasHistoryEntry[];
}

export interface GasRpcClient {
  request<T>(method: string, params?: unknown[]): Promise<T>;
}

export interface GasServiceDeps {
  rpc: GasRpcClient;
  store?: GasPriceStore;
  cacheTtlMs?: number;
  historyLimit?: number;
  defaultGasLimit?: bigint;
  clock?: () => number;
}

interface FeeHistoryResponse {
  oldestBlock: string;
  baseFeePerGas: string[];
  gasUsedRatio: number[];
  reward?: string[][];
}

interface CachedGasEstimate {
  cachedAt: string;
  payload: GasEstimateResponse;
}

export interface GasPriceStore {
  readCached(chainId: number): Promise<GasEstimateResponse | null>;
  writeCached(chainId: number, payload: GasEstimateResponse, ttlMs: number): Promise<void>;
  appendHistory(chainId: number, entry: GasHistoryEntry, limit: number): Promise<void>;
  readHistory(chainId: number, limit: number): Promise<GasHistoryEntry[]>;
}

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_HISTORY_LIMIT = 20;
const DEFAULT_GAS_LIMIT = 21000n;
const GWEI = 1_000_000_000n;

function nowIso(clock: () => number): string {
  return new Date(clock()).toISOString();
}

function hexToBigInt(value: string | null | undefined): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function bigintToGwei(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / GWEI;
  const remainder = absolute % GWEI;
  const decimals = remainder.toString().padStart(9, "0").replace(/0+$/, "");
  const rendered = decimals.length > 0 ? `${whole}.${decimals}` : whole.toString();
  return negative ? `-${rendered}` : rendered;
}

function formatFee(wei: bigint, gasLimit: bigint): GasTierQuote {
  const total = wei * gasLimit;
  return {
    maxFeePerGasWei: wei.toString(),
    maxPriorityFeePerGasWei: "0",
    maxFeePerGasGwei: bigintToGwei(wei),
    maxPriorityFeePerGasGwei: "0",
    estimatedTxFeeWei: total.toString(),
    estimatedTxFeeGwei: bigintToGwei(total),
  };
}

function formatDynamicFee(
  maxFeePerGasWei: bigint,
  maxPriorityFeePerGasWei: bigint,
  gasLimit: bigint
): GasTierQuote {
  const total = maxFeePerGasWei * gasLimit;
  return {
    maxFeePerGasWei: maxFeePerGasWei.toString(),
    maxPriorityFeePerGasWei: maxPriorityFeePerGasWei.toString(),
    maxFeePerGasGwei: bigintToGwei(maxFeePerGasWei),
    maxPriorityFeePerGasGwei: bigintToGwei(maxPriorityFeePerGasWei),
    estimatedTxFeeWei: total.toString(),
    estimatedTxFeeGwei: bigintToGwei(total),
  };
}

function percentile(values: bigint[], pct: number): bigint {
  if (values.length === 0) return 0n;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * (sorted.length - 1))));
  return sorted[index];
}

function average(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  const total = numbers.reduce((sum, value) => sum + value, 0);
  return total / numbers.length;
}

function isCongested(gasUsedRatios: number[]): boolean {
  const avg = average(gasUsedRatios);
  if (avg === null) return false;
  const latest = gasUsedRatios[gasUsedRatios.length - 1] ?? 0;
  return avg >= 0.85 || latest >= 0.95;
}

function bump(value: bigint, numerator: bigint, denominator: bigint): bigint {
  return (value * numerator) / denominator;
}

function buildDynamicTier(
  baseFee: bigint,
  priorityFee: bigint,
  multiplierNumerator: bigint,
  multiplierDenominator: bigint,
  gasLimit: bigint
): GasTierQuote {
  const adjustedBase = bump(baseFee, multiplierNumerator, multiplierDenominator);
  const maxFeePerGasWei = adjustedBase + priorityFee;
  return formatDynamicFee(maxFeePerGasWei, priorityFee, gasLimit);
}

function choosePriorityFee(
  feeHistory: FeeHistoryResponse,
  index: number,
  fallback: bigint
): bigint {
  const collected = feeHistory.reward?.map((row) => hexToBigInt(row[index]) ?? fallback).filter((value): value is bigint => value !== null) ?? [];
  if (collected.length === 0) return fallback;
  return percentile(collected, 50);
}

function serializeHistory(entry: GasHistoryEntry): string {
  return JSON.stringify(entry);
}

function deserializeHistory(raw: string): GasHistoryEntry | null {
  try {
    return JSON.parse(raw) as GasHistoryEntry;
  } catch {
    return null;
  }
}

class RedisGasStore implements GasPriceStore {
  async readCached(chainId: number): Promise<GasEstimateResponse | null> {
    const cached = await cacheGet<CachedGasEstimate>(NS.GAS_PRICE, String(chainId));
    return cached?.payload ?? null;
  }

  async writeCached(chainId: number, payload: GasEstimateResponse, ttlMs: number): Promise<void> {
    await cacheSet(
      NS.GAS_PRICE,
      String(chainId),
      { cachedAt: payload.fetchedAt, payload } satisfies CachedGasEstimate,
      Math.max(1, Math.ceil(ttlMs / 1000))
    );
  }

  async appendHistory(chainId: number, entry: GasHistoryEntry, limit: number): Promise<void> {
    const redis = getRedis();
    const key = `${NS.GAS_HISTORY}:${chainId}`;
    const score = new Date(entry.fetchedAt).getTime();
    await redis.zadd(key, score, serializeHistory(entry));
    await redis.zremrangebyrank(key, 0, -(limit + 1));
    await redis.expire(key, 30 * 24 * 60 * 60);
  }

  async readHistory(chainId: number, limit: number): Promise<GasHistoryEntry[]> {
    const redis = getRedis();
    const key = `${NS.GAS_HISTORY}:${chainId}`;
    const raw = await redis.zrevrange(key, 0, limit - 1);
    return raw.map(deserializeHistory).filter((entry): entry is GasHistoryEntry => entry !== null);
  }
}

export class GasPriceService {
  private readonly cacheTtlMs: number;
  private readonly historyLimit: number;
  private readonly defaultGasLimit: bigint;
  private readonly clock: () => number;
  private readonly rpc: GasRpcClient;
  private readonly store: GasPriceStore;

  constructor(deps: GasServiceDeps) {
    this.cacheTtlMs = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.historyLimit = deps.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.defaultGasLimit = deps.defaultGasLimit ?? DEFAULT_GAS_LIMIT;
    this.clock = deps.clock ?? Date.now;
    this.rpc = deps.rpc;
    this.store = deps.store ?? new RedisGasStore();
  }

  async estimate(chainId: number, gasLimit = this.defaultGasLimit, forceRefresh = false): Promise<GasEstimateResponse> {
    if (!forceRefresh) {
      const cached = await this.store.readCached(chainId);
      if (cached) {
        return { ...cached, cached: true };
      }
    }

    let payload: GasEstimateResponse;
    try {
      payload = await this.fetchFromChain(chainId, gasLimit);
    } catch (err) {
      payload = await this.buildFallback(chainId, gasLimit, err);
    }

    await this.store.writeCached(chainId, payload, this.cacheTtlMs);
    await this.store.appendHistory(chainId, this.toHistoryEntry(payload), this.historyLimit);

    return payload;
  }

  async history(chainId: number, limit = 10): Promise<GasHistoryEntry[]> {
    return this.store.readHistory(chainId, Math.max(1, limit));
  }

  private async fetchFromChain(chainId: number, gasLimit: bigint): Promise<GasEstimateResponse> {
    const feeHistoryPromise = this.rpc.request<FeeHistoryResponse>("eth_feeHistory", [12, "latest", [10, 25, 50, 75, 90]]);
    const gasPricePromise = this.rpc.request<string>("eth_gasPrice", []);
    const maxPriorityPromise = this.rpc.request<string>("eth_maxPriorityFeePerGas", []);

    const [feeHistoryResult, gasPriceResult, maxPriorityResult] = await Promise.allSettled([
      feeHistoryPromise,
      gasPricePromise,
      maxPriorityPromise,
    ]);

    if (feeHistoryResult.status === "fulfilled") {
      return this.fromFeeHistory(chainId, gasLimit, feeHistoryResult.value, gasPriceResult, maxPriorityResult, false);
    }

    if (gasPriceResult.status === "fulfilled") {
      return this.fromLegacyGasPrice(chainId, gasLimit, gasPriceResult.value, false);
    }

    throw feeHistoryResult.reason ?? gasPriceResult.reason;
  }

  private async buildFallback(chainId: number, gasLimit: bigint, error: unknown): Promise<GasEstimateResponse> {
    const history = await this.store.readHistory(chainId, this.historyLimit);
    if (history.length > 0) {
      const recent = history.slice(0, Math.min(history.length, 5));
      const low = percentile(recent.map((entry) => BigInt(entry.lowWei)), 25);
      const standard = percentile(recent.map((entry) => BigInt(entry.standardWei)), 50);
      const fast = percentile(recent.map((entry) => BigInt(entry.fastWei)), 75);
      const congestion = recent.some((entry) => entry.congestion);

      const adjustedLow = congestion ? bump(low, 11n, 10n) : low;
      const adjustedStandard = congestion ? bump(standard, 12n, 10n) : standard;
      const adjustedFast = congestion ? bump(fast, 13n, 10n) : fast;

      return {
        chainId,
        fetchedAt: nowIso(this.clock),
        cached: false,
        source: "fallback",
        congestion,
        gasLimit: gasLimit.toString(),
        observed: {
          baseFeePerGasWei: history[0]?.baseFeePerGasWei ?? null,
          gasPriceWei: history[0]?.gasPriceWei ?? null,
          averageGasUsedRatio: null,
        },
        low: formatDynamicFee(adjustedLow, 0n, gasLimit),
        standard: formatDynamicFee(adjustedStandard, 0n, gasLimit),
        fast: formatDynamicFee(adjustedFast, 0n, gasLimit),
        history,
      };
    }

    const cached = await this.store.readCached(chainId);
    if (cached) {
      return { ...cached, cached: false, source: "fallback" };
    }

    const conservative = bump(5n * GWEI, 3n, 2n);
    const quote = formatFee(conservative, gasLimit);
    return {
      chainId,
      fetchedAt: nowIso(this.clock),
      cached: false,
      source: "fallback",
      congestion: true,
      gasLimit: gasLimit.toString(),
      observed: {
        baseFeePerGasWei: null,
        gasPriceWei: null,
        averageGasUsedRatio: null,
      },
      low: quote,
      standard: quote,
      fast: quote,
      history: [],
    };
  }

  private fromLegacyGasPrice(
    chainId: number,
    gasLimit: bigint,
    gasPriceHex: string,
    cached: boolean
  ): GasEstimateResponse {
    const gasPrice = hexToBigInt(gasPriceHex) ?? 0n;
    const quote = formatFee(gasPrice, gasLimit);
    const historyEntry: GasHistoryEntry = {
      chainId,
      fetchedAt: nowIso(this.clock),
      source: "gasPrice",
      congestion: false,
      baseFeePerGasWei: "0",
      gasPriceWei: gasPrice.toString(),
      lowWei: gasPrice.toString(),
      standardWei: gasPrice.toString(),
      fastWei: gasPrice.toString(),
    };

    return {
      chainId,
      fetchedAt: historyEntry.fetchedAt,
      cached,
      source: "gasPrice",
      congestion: false,
      gasLimit: gasLimit.toString(),
      observed: {
        baseFeePerGasWei: null,
        gasPriceWei: gasPrice.toString(),
        averageGasUsedRatio: null,
      },
      low: quote,
      standard: quote,
      fast: quote,
      history: [historyEntry],
    };
  }

  private fromFeeHistory(
    chainId: number,
    gasLimit: bigint,
    feeHistory: FeeHistoryResponse,
    gasPriceResult: PromiseSettledResult<string>,
    maxPriorityResult: PromiseSettledResult<string>,
    cached: boolean
  ): GasEstimateResponse {
    const baseFees = feeHistory.baseFeePerGas.map((value) => hexToBigInt(value) ?? 0n);
    const latestBaseFee = baseFees.at(-1) ?? 0n;
    const congestion = isCongested(feeHistory.gasUsedRatio);
    const averageGasUsedRatio = average(feeHistory.gasUsedRatio);
    const gasPrice = gasPriceResult.status === "fulfilled" ? (hexToBigInt(gasPriceResult.value) ?? latestBaseFee) : latestBaseFee;
    const maxPriorityFallback = maxPriorityResult.status === "fulfilled"
      ? (hexToBigInt(maxPriorityResult.value) ?? 1_500_000_000n)
      : 1_500_000_000n;

    const prioritySamples = [
      choosePriorityFee(feeHistory, 0, maxPriorityFallback / 4n),
      choosePriorityFee(feeHistory, 1, maxPriorityFallback / 2n),
      choosePriorityFee(feeHistory, 2, maxPriorityFallback),
      choosePriorityFee(feeHistory, 3, maxPriorityFallback + maxPriorityFallback / 2n),
      choosePriorityFee(feeHistory, 4, maxPriorityFallback * 2n),
    ];

    const lowPriority = prioritySamples[0] ?? maxPriorityFallback / 4n;
    const standardPriority = prioritySamples[2] ?? maxPriorityFallback;
    const fastPriority = prioritySamples[4] ?? maxPriorityFallback * 2n;

    const low = buildDynamicTier(latestBaseFee, lowPriority, congestion ? 11n : 10n, 10n, gasLimit);
    const standard = buildDynamicTier(latestBaseFee, standardPriority, congestion ? 12n : 11n, 10n, gasLimit);
    const fast = buildDynamicTier(latestBaseFee, fastPriority, congestion ? 14n : 12n, 10n, gasLimit);

    const fetchedAt = nowIso(this.clock);
    const historyEntry: GasHistoryEntry = {
      chainId,
      fetchedAt,
      source: "feeHistory",
      congestion,
      baseFeePerGasWei: latestBaseFee.toString(),
      gasPriceWei: gasPrice.toString(),
      lowWei: low.maxFeePerGasWei,
      standardWei: standard.maxFeePerGasWei,
      fastWei: fast.maxFeePerGasWei,
    };

    return {
      chainId,
      fetchedAt,
      cached,
      source: "feeHistory",
      congestion,
      gasLimit: gasLimit.toString(),
      observed: {
        baseFeePerGasWei: latestBaseFee.toString(),
        gasPriceWei: gasPrice.toString(),
        averageGasUsedRatio,
      },
      low,
      standard,
      fast,
      history: [historyEntry],
    };
  }

  private toHistoryEntry(response: GasEstimateResponse): GasHistoryEntry {
    return {
      chainId: response.chainId,
      fetchedAt: response.fetchedAt,
      source: response.source,
      congestion: response.congestion,
      baseFeePerGasWei: response.observed.baseFeePerGasWei ?? "0",
      gasPriceWei: response.observed.gasPriceWei ?? "0",
      lowWei: response.low.maxFeePerGasWei,
      standardWei: response.standard.maxFeePerGasWei,
      fastWei: response.fast.maxFeePerGasWei,
    };
  }
}

export class JsonRpcClient implements GasRpcClient {
  constructor(
    private readonly rpcUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 3_000
  ) {}

  async request<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await this.fetchImpl(this.rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`RPC ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as { result?: T; error?: { message?: string } };
    if (payload.error) {
      throw new Error(payload.error.message ?? `RPC request failed for ${method}`);
    }
    if (payload.result === undefined) {
      throw new Error(`RPC response missing result for ${method}`);
    }
    return payload.result;
  }
}

export function createGasPriceService(): GasPriceService {
  const rpcUrl = process.env.GAS_RPC_URL ?? process.env.ETH_RPC_URL ?? "https://cloudflare-eth.com";
  return new GasPriceService({
    rpc: new JsonRpcClient(rpcUrl),
    cacheTtlMs: parseInt(process.env.GAS_CACHE_TTL_MS ?? "60000", 10),
    historyLimit: parseInt(process.env.GAS_HISTORY_LIMIT ?? "20", 10),
    defaultGasLimit: BigInt(process.env.GAS_DEFAULT_LIMIT ?? "21000"),
  });
}
