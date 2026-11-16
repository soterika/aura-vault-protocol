import * as SecureStore from "expo-secure-store";

const QUEUE_KEY = "aura_offline_queue";
const CACHE_PREFIX = "aura_cache_";

export interface QueuedTransaction {
  id: string;
  type: "deposit" | "withdraw" | "harvest";
  params: Record<string, unknown>;
  createdAt: number;
}

export async function queueTransaction(tx: Omit<QueuedTransaction, "id" | "createdAt">): Promise<void> {
  const queue = await getQueue();
  queue.push({
    ...tx,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  });
  await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(queue));
}

export async function getQueue(): Promise<QueuedTransaction[]> {
  const raw = await SecureStore.getItemAsync(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function clearQueue(): Promise<void> {
  await SecureStore.deleteItemAsync(QUEUE_KEY);
}

export async function cacheData(key: string, data: unknown): Promise<void> {
  await SecureStore.setItemAsync(
    CACHE_PREFIX + key,
    JSON.stringify({ data, cachedAt: Date.now() })
  );
}

export async function getCachedData<T>(key: string, maxAgeMs = 5 * 60 * 1000): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(CACHE_PREFIX + key);
  if (!raw) return null;
  const { data, cachedAt } = JSON.parse(raw);
  if (Date.now() - cachedAt > maxAgeMs) return null;
  return data as T;
}
