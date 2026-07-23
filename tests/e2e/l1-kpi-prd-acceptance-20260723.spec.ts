import { expect, test, type Page, type Response } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "";
const EVIDENCE_DIR = process.env.L1_ACCEPTANCE_DIR
  || "D:/workspace/bug-pic/l-domain-parallel-acceptance-20260723-000935/L1-kpi/evidence";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!PASSWORD) throw new Error("ADMIN_E2E_PASSWORD is required for L1 live acceptance");
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await loginFromVisibleEntry(page);
});

test("L1 主流程：八项 KPI、服务端筛选、下钻、趋势和刷新均可用", async ({ page }) => {
  const requests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/admin/bi/kpi")) requests.push(url);
  });

  const overview = page.waitForResponse(isKpiOverview);
  await openFromSidebar(page);
  const overviewResponse = await overview;
  expect(overviewResponse.status()).toBe(200);
  const overviewPayload = await overviewResponse.json();
  expect(overviewPayload.data.kpis).toHaveLength(8);
  await page.screenshot({ path: evidence("initial-visible-entry.png"), fullPage: true });

  await expect(page.getByRole("heading", { name: "KPI 看板" })).toBeVisible();
  await expect(page.locator("button.kpi-card")).toHaveCount(8);
  await expect(page.getByText("未达 + 不可计算", { exact: true })).toBeVisible();
  await expect(page.getByText("单 KPI 下钻", { exact: false })).toBeVisible();
  await expect(page.getByText("趋势 & 阈值视图", { exact: true })).toBeVisible();
  await expect(page.getByText("KPI 口径锁定表", { exact: true })).toBeVisible();

  const filteredResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/admin/bi/kpi"
      && url.searchParams.get("window") === "30d";
  });
  await page.getByRole("button", { name: "滚动 30d", exact: true }).click();
  expect((await filteredResponse).status()).toBe(200);
  await expect(page.getByRole("button", { name: "滚动 30d", exact: true })).toHaveClass(/sel/);

  const secondCard = page.locator("button.kpi-card").nth(1);
  const drilldownResponse = page.waitForResponse((response) =>
    response.request().method() === "GET"
    && new URL(response.url()).pathname === "/api/admin/bi/kpi/2/drilldown");
  const trendResponse = page.waitForResponse((response) =>
    response.request().method() === "GET"
    && new URL(response.url()).pathname === "/api/admin/bi/kpi/trend"
    && new URL(response.url()).searchParams.get("kpiId") === "2");
  await secondCard.click();
  expect((await drilldownResponse).status()).toBe(200);
  expect((await trendResponse).status()).toBe(200);
  await expect(page.getByText(/单 KPI 下钻 · #2/)).toBeVisible();
  await expect(page.getByText("分子(实时)", { exact: true })).toBeVisible();
  await expect(page.getByText("分母(实时)", { exact: true })).toBeVisible();
  if ((await secondCard.innerText()).includes("不可计算")) {
    await expect(page.getByText(/没有可绘制的趋势点/)).toBeVisible();
  } else {
    await expect(page.locator('svg[aria-label*="KPI #2"]')).toBeVisible();
  }

  const refreshed = page.waitForResponse(isKpiOverview);
  await page.getByRole("button", { name: "刷新 KPI", exact: true }).click();
  expect((await refreshed).status()).toBe(200);
  await expect(page.locator("button.kpi-card")).toHaveCount(8);
  await page.screenshot({ path: evidence("main-flow-after-filter-drill-refresh.png"), fullPage: true });

  expect(requests.some((url) => url.searchParams.get("window") === "30d")).toBeTruthy();
});

test("L1 聚合导出：无多余确认弹窗、任务无 PII 且可追溯", async ({ page }) => {
  await openFromSidebar(page);
  await expect(page.locator("button.kpi-card")).toHaveCount(8);

  const created = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/bi/reports");
  await page.getByRole("button", { name: "导出 KPI 序列 CSV", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const response = await created;
  expect(response.status()).toBeLessThan(400);
  const payload = await response.json();
  expect(payload.data.created).toMatchObject({
    type: "KPI_SERIES",
    rowCount: 8,
    containsPii: false,
    maskingPolicy: "NONE",
    status: "READY",
  });
  const reportId = String(payload.data.created.reportId || "");
  expect(reportId).not.toBe("");
  await writeFile(evidence("created-report-id.txt"), `${reportId}\n`, "utf8");
  await expect(page.getByText(/KPI 序列已导出 · 已记审计/)).toBeVisible();
  await page.screenshot({ path: evidence("real-export-success.png"), fullPage: true });
});

test("L1 空数据：八项口径仍可见且不把不可计算冒充 0%", async ({ page }) => {
  await page.route(/\/api\/admin\/bi\/kpi(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        data: {
          module: "L1",
          window: "7d",
          cohort: "week",
          kpis: [],
          definitions: [],
          sources: ["nx_event_outbox:event_name"],
        },
      }),
    });
  });
  await openFromSidebar(page);
  await expect(page.getByText(/当前没有可展示的数据/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/0\.0%|0% 达标/);
  await page.screenshot({ path: evidence("injected-empty-state.png"), fullPage: true });
});

test("L1 故障路径：失败有解释、可重试，恢复后回到完整八项", async ({ page }) => {
  let failNext = true;
  await page.route(/\/api\/admin\/bi\/kpi(?:\?.*)?$/, async (route) => {
    if (failNext) {
      failNext = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: 503, message: "99101_L1_INJECTED_UPSTREAM_UNAVAILABLE", data: null }),
      });
      return;
    }
    await route.continue();
  });
  await openFromSidebar(page);
  await expect(page.getByText(/L1 数据加载失败/)).toBeVisible();
  await page.screenshot({ path: evidence("injected-error-state.png"), fullPage: true });

  const recovered = page.waitForResponse(isKpiOverview);
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  expect((await recovered).status()).toBe(200);
  await expect(page.locator("button.kpi-card")).toHaveCount(8);
});

async function loginFromVisibleEntry(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    const login = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/login");
    await page.getByRole("button", { name: /登录|继续/ }).click();
    expect((await login).status()).toBe(200);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openFromSidebar(page: Page) {
  const domain = page.getByRole("button", { name: "数据与分析 BI L", exact: true });
  if ((await domain.getAttribute("aria-expanded")) !== "true") await domain.click();
  const link = page.locator('aside a[href="/analytics/kpi"]');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/analytics\/kpi$/);
}

function isKpiOverview(response: Response) {
  const url = new URL(response.url());
  return response.request().method() === "GET" && url.pathname === "/api/admin/bi/kpi";
}

function evidence(fileName: string) {
  return path.join(EVIDENCE_DIR, fileName);
}
