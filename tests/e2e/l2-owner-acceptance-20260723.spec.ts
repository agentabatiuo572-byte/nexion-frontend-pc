import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const EVIDENCE = "D:/workspace/bug-pic/l-domain-parallel-acceptance-20260723-000935/L2-funnel-cohort/evidence";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /登录|继续/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => localStorage.removeItem("nexion:l2:view"));
});

test("L2 first-user primary journey is available from the visible sidebar entry", async ({ page }) => {
  await openL2(page);
  await page.screenshot({ path: `${EVIDENCE}/red-visible-entry.png`, fullPage: true });

  await expect(page.getByText("完整漏斗下钻 · 五级", { exact: true })).toBeVisible();
  await expect(page.getByText("Cohort 留存矩阵", { exact: true })).toBeVisible();
  await expect(page.getByText("多维交叉分析", { exact: true })).toBeVisible();
  await expect(page.getByText(/只有数据不足时才安全降级为独立事实计数/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("完整统计尚未开放时");
  await expect(page.getByText(/暂不可计算|不直接相除为转化率/)).toHaveCount(0);
});

test("L2 first-user can drill stages, switch cohort granularity/windows, save and refresh", async ({ page }) => {
  await openL2(page);
  await page.getByRole("button", { name: /首购/ }).first().click();
  await expect(page.getByText("首购 级展开", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Day14", exact: true }).click();
  await expect(page.locator("table.ret-tbl thead")).toContainText("Day14");
  await page.getByRole("button", { name: "注册月", exact: true }).click();
  await expect(page.locator("table.ret-tbl tbody tr").first()).toContainText("2026-05");
  await page.getByRole("button", { name: "Day7 留存", exact: true }).click();
  await page.getByRole("button", { name: "保存为视图", exact: true }).click();
  await expect(page.getByText(/当前切片、cohort 粒度与留存窗已保存/)).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "注册月", exact: true })).toHaveClass(/sel/);
  await expect(page.getByRole("button", { name: "Day14", exact: true })).toHaveClass(/sel/);
  await expect(page.locator("table.ret-tbl thead")).toContainText("Day14");
  await expect(page.locator("body")).not.toContainText(/null%|NaN|Infinity|undefined%/);
  await page.screenshot({ path: `${EVIDENCE}/green-interactions-refresh.png`, fullPage: true });
});

test("L2 PRD APIs and B overview share the same five stage counts", async ({ page }) => {
  await openL2(page);
  const paths = [
    "/api/admin/bi/funnel/drilldown?stage=checkout.completed",
    "/api/admin/bi/retention/cohort-matrix?window=Day1,Day7,Day14,Day30,Day60",
    "/api/admin/bi/retention/curve?cohort=2026-W18",
    "/api/admin/bi/funnel/cross?dim1=phase&dim2=locale&metric=cvr",
  ];
  const payloads = [];
  for (const path of paths) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(200);
    const payload = await response.json();
    expect(payload.code, path).toBe(0);
    expect(payload.data.available, path).toBe(true);
    payloads.push(payload.data);
  }
  expect(payloads[0].funnel).toHaveLength(5);
  expect(payloads[1].cohorts.length).toBeGreaterThanOrEqual(2);
  expect(payloads[2].curve.length).toBeGreaterThan(0);
  expect(Object.keys(payloads[3].crossAnalysis)).toEqual(expect.arrayContaining(["cvr", "ret", "trial"]));

  const l2 = await page.request.get("/api/admin/bi/funnel/overview").then((response) => response.json());
  const b = await page.request.get("/api/admin/platform/ops-dashboard/summary").then((response) => response.json());
  expect(l2.code).toBe(0);
  expect(b.code).toBe(0);
  expect(b.data.funnel.map((row: { count: number }) => row.count))
    .toEqual(l2.data.funnel.map((row: { users: number }) => row.users));
});

test("L2 aggregate export is effective, non-PII and auditable", async ({ page }) => {
  await openL2(page);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/bi/reports",
  );
  await page.getByRole("button", { name: "导出 cohort / 漏斗序列", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "导出", exact: true }).last().click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(400);
  const payload = await response.json();
  expect(payload.data.created).toMatchObject({
    type: "FUNNEL_COHORT",
    rowCount: 5,
    containsPii: false,
    maskingPolicy: "NONE",
    status: "READY",
  });
  await expect(page.getByText(/漏斗 cohort 导出任务已提交/)).toBeVisible();
});

test("L2 read endpoints reject an unauthenticated context", async ({ baseURL }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL: baseURL || "http://127.0.0.1:3002" });
  const response = await anonymous.get("/api/admin/bi/funnel/drilldown");
  expect(response.status()).toBe(401);
  const body = await response.json();
  expect(body.message).toBe("ADMIN_AUTH_REQUIRED");
  await anonymous.dispose();
});

test("L2 shows a recoverable error and returns to the full view", async ({ page }) => {
  let failOnce = true;
  await page.route("**/api/admin/bi/funnel/overview", async (route) => {
    if (failOnce) {
      failOnce = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: 503, message: "BI_BACKEND_UNAVAILABLE" }) });
      return;
    }
    await route.continue();
  });
  await openL2(page);
  await expect(page.getByText(/L2 数据加载失败/)).toBeVisible();
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByText("完整漏斗下钻 · 五级", { exact: true })).toBeVisible();
  await page.unroute("**/api/admin/bi/funnel/overview");
});

test("L2 empty source stays explicit and never fabricates conversion rates", async ({ page }) => {
  await openL2(page);
  await expect(page.getByText("生命周期事实计数", { exact: true })).toBeVisible();
  await expect(page.getByText(/各行是独立累计量，不直接相除为转化率/)).toBeVisible();
  await expect(page.getByText(/Cohort、留存与逐级转化暂不可计算/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/null%|NaN|Infinity|undefined%/);
  await page.screenshot({ path: `${EVIDENCE}/green-empty-safe-degradation.png`, fullPage: true });
});

async function openL2(page: Page) {
  const domain = page.getByRole("button", { name: "数据与分析 BI L", exact: true });
  if ((await domain.getAttribute("aria-expanded")) !== "true") await domain.click();
  const link = page.locator('aside a[href="/analytics/funnel-cohort"]');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/analytics\/funnel-cohort$/);
  await expect(page.getByRole("heading", { name: "漏斗\/cohort\/留存" })).toBeVisible();
}
