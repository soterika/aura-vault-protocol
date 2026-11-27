import http from "k6/http";
import { check, sleep } from "k6";

const base = __ENV.BASE_URL || "http://127.0.0.1:4100";
const vaultId = __ENV.VAULT_ID || "";

export const options = {
  scenarios: {
    sustained_traffic: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 50),
      duration: __ENV.DURATION || "5m",
      exec: "readStats",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<250", "p(99)<750"],
    checks: ["rate>0.99"],
  },
};

export function readStats() {
  const url = vaultId
    ? `${base}/api/v1/vault/stats?vaultId=${encodeURIComponent(vaultId)}`
    : `${base}/api/v1/vault/stats`;
  const response = http.get(url, {
    headers: { Accept: "application/json" },
    tags: { endpoint: "vault-stats" },
  });

  check(response, {
    "vault stats returns 200": (r) => r.status === 200,
    "vault stats advertises cache control": (r) =>
      r.headers["Cache-Control"] !== undefined,
    "vault stats reports cache status": (r) =>
      r.headers["X-Cache"] === "HIT" ||
      r.headers["X-Cache"] === "MISS" ||
      r.headers["X-Cache"] === "STALE",
    "vault stats payload has data": (r) => {
      try {
        const body = JSON.parse(r.body as string);
        return body !== null && typeof body === "object";
      } catch {
        return false;
      }
    },
  });

  sleep(0.5);
}
