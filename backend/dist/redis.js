import Redis, { Cluster } from "ioredis";
let client = null;
function createClient() {
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
export function getRedis() {
    if (!client) {
        client = createClient();
        client.on("error", (err) => console.error("[Redis] Error:", err.message));
        client.on("connect", () => console.log("[Redis] Connected"));
        client.on("ready", () => console.log("[Redis] Ready"));
        client.on("reconnecting", () => console.log("[Redis] Reconnecting..."));
    }
    return client;
}
export async function pingRedis() {
    try {
        const result = await getRedis().ping();
        return result === "PONG";
    }
    catch {
        return false;
    }
}
export async function disconnectRedis() {
    if (client) {
        await client.quit();
        client = null;
    }
}
