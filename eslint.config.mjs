import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "test-results/**",
      "playwright-report/**",
      ".playwright-mcp/**",
      "next-env.d.ts",
      // Built artifact, not source: `npm run build:share` regenerates it.
      "public/sharekit.js",
    ],
  },
];

export default eslintConfig;
