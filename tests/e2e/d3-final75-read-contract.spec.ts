import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { finalAccount, login, logout } from "./helpers/d-final6-review-harness";

const reads = [
  "/api/admin/treasury/forecast-config",
  "/api/admin/treasury/reserve",
  "/api/admin/treasury/liabilities?breakdown=true",
  "/api/admin/treasury/maturity-forecast?window=7d",
  "/api/admin/treasury/net-exposure?window=30d",
  "/api/admin/treasury/net-exposure?window=90d",
] as const;
const EVIDENCE_DIR = process.env.D3_FINAL75_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/D/final12-product001-repair-e";

test("FINAL75 D3 最小 read 权限获得完整权威模型，而非通用页面错误", async ({ page }) => {
  await login(page, finalAccount("final75_readonly"), "d3-final75-model");
  const observed: Array<{ path: string; status: number; code?: unknown; dataKeys: string[]; model?: unknown }> = [];
  page.on("response", async (response) => {
    const requestPath = new URL(response.url()).pathname + new URL(response.url()).search;
    if (!requestPath.startsWith("/api/admin/treasury/")) return;
    const body = await response.json().catch(() => null) as { code?: unknown; data?: unknown } | null;
    const data = body?.data as Record<string, unknown> | undefined;
    const model = requestPath.includes("liabilities") ? {
      totalType: typeof data?.totalUsdt,
      breakdownLength: Array.isArray(data?.breakdown) ? data.breakdown.length : -1,
      firstBreakdown: Array.isArray(data?.breakdown) ? data.breakdown[0] : null,
    } : requestPath.includes("maturity-forecast") ? {
      window: data?.window,
      dailyLength: Array.isArray(data?.daily) ? data.daily.length : -1,
      cumulativeLength: Array.isArray(data?.cumulative) ? data.cumulative.length : -1,
      firstDaily: Array.isArray(data?.daily) ? data.daily[0] : null,
    } : requestPath.includes("net-exposure") ? {
      window: data?.window,
      seriesLength: Array.isArray(data?.series) ? data.series.length : -1,
      firstSeries: Array.isArray(data?.series) ? data.series[0] : null,
    } : requestPath.endsWith("/reserve") ? {
      reserveTotalType: typeof data?.reserveTotalUsdt,
      water: data?.waterLevel,
    } : undefined;
    observed.push({
      path: requestPath,
      status: response.status(),
      code: body?.code,
      dataKeys: body?.data && typeof body.data === "object" && !Array.isArray(body.data) ? Object.keys(body.data as object).sort() : [],
      model,
    });
  });
  for (const path of reads) {
    const response = await page.request.get(path);
    expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
    const payload = await response.json() as { code?: number; data?: unknown };
    expect(payload.code, path).toBe(0);
    expect(payload.data, path).toBeTruthy();
  }
  await page.goto("/finance/pool", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, "d3-final75-raw-model.json"), `${JSON.stringify({ observed }, null, 2)}\n`);
  await expect(page.getByText("应付负债 · 9 类科目", { exact: true })).toBeVisible();
});

test("D3 BFF keeps anonymous reads at 401 and FINAL75 writes at 403 without widening its read role", async ({ page }) => {
  const anonymous = await page.request.get("/api/admin/treasury/reserve");
  expect(anonymous.status()).toBe(401);

  await login(page, finalAccount("final75_readonly"), "d3-final75-authorization");
  const denied = await page.request.put("/api/admin/treasury/forecast-config", {
    headers: { "Idempotency-Key": `d3-final75-denied-${crypto.randomUUID()}` },
    data: { forecastWindow: "7d", reason: "read role must not write", operator: "final75" },
  });
  expect(denied.status()).toBe(403);
  expect((await page.request.get("/api/admin/treasury/reserve")).status()).toBe(200);
  await logout(page);
});
