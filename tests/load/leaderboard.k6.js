import http from "k6/http";
import { check, sleep } from "k6";

const base = __ENV.BASE_URL || "http://127.0.0.1:4100";
export const options = {
  scenarios: {
    warm_cache: { executor: "constant-vus", vus: 200, duration: "120s", exec: "warmCache" },
    cache_miss_burst: { executor: "per-vu-iterations", vus: 200, iterations: 1, startTime: "2m10s", exec: "cacheMissBurst" },
    paginated_navigation: { executor: "per-vu-iterations", vus: 200, iterations: 10, startTime: "2m20s", exec: "paginatedNavigation" },
  },
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<200", "p(99)<500"] },
};

function request(page = 1) {
  const response = http.get(`${base}/api/vault/leaderboard?page=${page}&pageSize=100`);
  check(response, { "leaderboard responds successfully": (r) => r.status === 200 });
}
export function warmCache() { request(1); sleep(0.2); }
export function cacheMissBurst() { request(1); }
export function paginatedNavigation() { for (let page = 1; page <= 10; page += 1) request(page); }
