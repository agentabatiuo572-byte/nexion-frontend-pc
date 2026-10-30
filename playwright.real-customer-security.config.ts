import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
const evidence = process.env.PAYMENT_CUSTOMER_EVIDENCE_DIR || "D:/WORKS/PLAN/output/payment-pin-20261030/real-customer-security";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "real-customer-payment-security.spec.ts", timeout: 60_000,
  expect: { timeout: 15_000 }, workers: 1,
  outputDir: path.join(evidence, "playwright-results"),
  reporter: [["list"], ["json", { outputFile: path.join(evidence, "playwright-results.json") }]],
  use: { baseURL: "http://127.0.0.1:3108", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure", trace: "retain-on-failure" },
});
