import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3111);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    viewport: { width: 1600, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      // The viewport is set here too: project-level `use` wins over the
      // top-level one, and the desktop preset would otherwise shrink it.
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 900 } },
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
