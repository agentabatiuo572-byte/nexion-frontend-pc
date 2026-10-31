import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: ["purchase-payment-operations.spec.ts"], timeout: 90_000, expect: { timeout: 15_000 }, workers: 1,
  outputDir: process.env.PAY1718_PC_EVIDENCE_DIR ? `${process.env.PAY1718_PC_EVIDENCE_DIR}/playwright-results` : "test-results/pay1718/playwright-results", reporter: [["list"]],
  use: { baseURL: process.env.PAY1718_PC_BASE_URL || "http://127.0.0.1:3198", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure", trace: "retain-on-failure" },
});
