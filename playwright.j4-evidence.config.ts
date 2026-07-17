import { defineConfig } from "@playwright/test";

const runId = process.env.J4_RUN_ID;
if (!runId) throw new Error("J4_RUN_ID is required");
const artifactRoot = `D:/workspace/j4-acceptance-artifacts/playwright-${runId}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "j4-readonly-evidence.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["html", { outputFolder: `${artifactRoot}/html-report`, open: "never" }],
    ["json", { outputFile: `${artifactRoot}/report.json` }],
  ],
  outputDir: `${artifactRoot}/test-results`,
  use: {
    baseURL: "http://127.0.0.1:3002",
    browserName: "chromium",
    headless: true,
    trace: "off",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
