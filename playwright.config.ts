import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL,
    acceptDownloads: true,
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_ADMIN_AUTH_BYPASS: "0",
      NEXION_BACKEND_URL: process.env.NEXION_BACKEND_URL ?? "http://127.0.0.1:8110",
    },
  },
});
