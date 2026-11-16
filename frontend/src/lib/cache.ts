/**
 * Triggers a CloudFront cache invalidation via the backend API.
 * Call after deploying new static assets.
 */
export async function invalidateCache(paths: string[] = ["/*"]): Promise<void> {
  const res = await fetch("/api/cache/invalidate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) throw new Error(`Cache invalidation failed: ${res.status}`);
}
