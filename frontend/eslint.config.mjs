import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Prevent direct top-level imports of heavy libraries in Next.js layout files
  // to avoid bloating the initial global bundle; use next/dynamic instead.
  {
    files: ["src/app/**/layout.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "recharts",
              message:
                "Do not import 'recharts' directly in layout files. Use next/dynamic with { ssr: false } instead.",
            },
            {
              name: "chart.js",
              message:
                "Do not import 'chart.js' directly in layout files. Use next/dynamic with { ssr: false } instead.",
            },
            {
              name: "react-chartjs-2",
              message:
                "Do not import 'react-chartjs-2' directly in layout files. Use next/dynamic with { ssr: false } instead.",
            },
            {
              name: "d3",
              message:
                "Do not import 'd3' directly in layout files. Use next/dynamic with { ssr: false } instead.",
            },
            {
              name: "three",
              message:
                "Do not import 'three' directly in layout files. Use next/dynamic with { ssr: false } instead.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
