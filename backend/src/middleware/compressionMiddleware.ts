/**
 * compressionMiddleware — issue #1272
 *
 * Applies gzip / deflate compression to HTTP responses before they leave the
 * server.  Only responses larger than 1 kB are compressed; already-compressed
 * content types (images, video, pre-gzipped archives) are skipped so we
 * don't waste CPU recompressing them.
 *
 * Configuration
 *   threshold : 1024 bytes — responses smaller than 1 kB are sent uncompressed
 *   level     : 6          — zlib compression level (0–9); 6 balances speed/ratio
 *   filter    : skip already-compressed MIME types to avoid double-compression
 */

import compression from "compression";
import type { Request, Response } from "express";

/**
 * MIME type prefixes / patterns that are already compressed.
 * Compressing them again wastes CPU and can slightly *increase* payload size.
 */
const ALREADY_COMPRESSED_RE =
  /^(image\/(png|jpe?g|gif|webp|avif|svg\+xml)|video\/|audio\/|application\/(zip|gzip|x-gzip|zstd|br|x-brotli|pdf|wasm|octet-stream)|font\/)/i;

/**
 * Custom filter — delegates to the default `compression` filter first, then
 * additionally skips responses whose Content-Type indicates already-compressed
 * data.
 */
function shouldCompress(req: Request, res: Response): boolean {
  // Honor explicit `Cache-Control: no-transform` or similar opt-outs
  if (req.headers["x-no-compression"]) {
    return false;
  }

  const contentType = res.getHeader("Content-Type");
  if (typeof contentType === "string" && ALREADY_COMPRESSED_RE.test(contentType)) {
    return false;
  }

  // Fall back to the default compression filter (checks Accept-Encoding, etc.)
  return compression.filter(req, res);
}

/**
 * Ready-to-use Express middleware.
 *
 * Register this **before** route handlers so every JSON, HTML, and text
 * response is eligible for compression:
 *
 *   import { compressionMiddleware } from './middleware/compressionMiddleware.js';
 *   app.use(compressionMiddleware);
 */
export const compressionMiddleware = compression({
  // Only compress when the uncompressed body exceeds 1 kB
  threshold: 1024,
  // zlib level 6: good compression ratio without excessive CPU cost
  level: 6,
  filter: shouldCompress,
});
