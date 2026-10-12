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
      // Same, for the host runtime `npm run build:billkit` regenerates.
      "public/billkit.js",
    ],
  },
];

export default eslintConfig;
