import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const withBundleAnalyzer = process.env.ANALYZE === "true"
  ? require("@next/bundle-analyzer")({ enabled: true })
  : (config: NextConfig) => config;

let withSentryConfig: (config: NextConfig, options: Record<string, unknown>) => NextConfig;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  withSentryConfig = require("@sentry/nextjs").withSentryConfig;
} catch {
  withSentryConfig = (config) => config;
}

const nextConfig: NextConfig = {
  compress: true,
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 31_536_000,
    deviceSizes: [320, 640, 768, 1024, 1280, 1920, 2560],
  },
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
  // next-intl's plugin uses experimental.turbo (Next.js <15 key) which is
  // rejected by Next.js 16. We manually wire the alias under the top-level
  // `turbopack` key that Next.js 16 requires.
  turbopack: {
    resolveAlias: { "next-intl/config": "./src/i18n/request.ts" },
  },
};

export default withSentryConfig(withBundleAnalyzer(withNextIntl(nextConfig)), {
  silent: true,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  autoInstrumentServerFunctions: true,
  autoInstrumentMiddleware: true,
  disableLogger: true,
});
