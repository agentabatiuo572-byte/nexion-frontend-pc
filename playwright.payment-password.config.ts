import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
const evidence = process.env.PAYMENT_PIN_EVIDENCE_DIR || path.resolve("test-results/payment-password");
export default defineConfig({
  testDir: "./tests/e2e", testMatch: ["payment-password-fixture.spec.ts", "payment-security-management.spec.ts"], timeout: 60_000,
  expect: { timeout: 12_000 }, workers: 1,
  outputDir: path.join(evidence, "playwright-results"),
  reporter: [["list"], ["json", { outputFile: path.join(evidence, "playwright-results.json") }]],
  use: { baseURL: process.env.PAYMENT_PIN_ADMIN_BASE_URL || "http://127.0.0.1:3108", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure", trace: "retain-on-failure" },
});
