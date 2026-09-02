import Redis, { Cluster } from "ioredis";
import { logger } from "./logger.js";

let client: Redis | Cluster | null = null;

function createClient(): Redis | Cluster {
  const clusterNodes = process.env.REDIS_CLUSTER;

  if (clusterNodes) {
    const nodes = clusterNodes.split(",").map((node) => {
      const [host, port] = node.trim().split(":");
      return { host, port: parseInt(port || "6379", 10) };
    });
    return new Cluster(nodes, {
      redisOptions: {
        password: process.env.REDIS_PASSWORD,
        tls: process.env.REDIS_TLS === "true" ? {} : undefined,
      },
      enableReadyCheck: true,
      scaleReads: "slave",
    });
  }

  return new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });
}

export function getRedis(): Redis | Cluster {
  if (!client) {
    client = createClient();
    client.on("error", (err) => logger.error({ err: err.message }, "[Redis] Error"));
    client.on("connect", () => logger.info("[Redis] Connected"));
    client.on("ready", () => logger.info("[Redis] Ready"));
    client.on("reconnecting", () => logger.warn("[Redis] Reconnecting..."));
  }
  return client;
}

export async function pingRedis(): Promise<boolean> {
  try {
    const result = await getRedis().ping();
    return result === "PONG";
  } catch {
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
