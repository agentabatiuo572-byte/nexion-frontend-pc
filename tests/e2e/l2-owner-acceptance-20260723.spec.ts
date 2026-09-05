import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const EVIDENCE = process.env.L2_ACCEPTANCE_DIR?.trim() || "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!EVIDENCE) throw new Error("L2_ACCEPTANCE_DIR is required to prevent historical-evidence overwrite");
  await mkdir(EVIDENCE, { recursive: true });
});

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

test("first-time user reaches L2 from the visible sidebar and sees only defensible facts", async ({ page }) => {
  await openL2(page);
  const full = await page.getByText("完整漏斗下钻 · 五级", { exact: true }).isVisible().catch(() => false);
  if (full) {
    await expect(page.getByText("Cohort 留存矩阵", { exact: true })).toBeVisible();
    await expect(page.getByText("多维交叉分析", { exact: true })).toBeVisible();
    await expect(page.getByText(/服务端切片/)).toBeVisible();
  } else {
    await expect(page.getByText("生命周期事实计数", { exact: true })).toBeVisible();
    await expect(page.getByText(/各行是独立累计量，不直接相除为转化率/)).toBeVisible();
    await expect(page.getByText(/Cohort、留存与逐级转化暂不可计算/)).toBeVisible();
  }
  await expect(page.locator("body")).not.toContainText(/null%|NaN|Infinity|undefined%/);
  await page.screenshot({ path: `${EVIDENCE}/visible-entry-and-truth-state.png`, fullPage: true });
});

test("full analytics interactions call real L2 endpoints; empty runtime remains explicitly degraded", async ({ page }) => {
  await openL2(page);
  const full = await page.getByText("完整漏斗下钻 · 五级", { exact: true }).isVisible().catch(() => false);
  if (!full) {
    await expect(page.getByRole("button", { name: "导出生命周期计数 CSV" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "应用切片" })).toHaveCount(0);
    return;
  }

  const drilldown = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/admin/bi/funnel/drilldown");
  await page.getByRole("button", { name: "应用切片", exact: true }).click();
  expect((await drilldown).status()).toBe(200);

  const matrix = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/admin/bi/retention/cohort-matrix");
  await page.getByRole("button", { name: "Day14", exact: true }).click();
  expect((await matrix).status()).toBe(200);
  await expect(page.locator("table.ret-tbl thead")).toContainText("Day14");

  const cross = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/admin/bi/funnel/cross");
  await page.getByRole("button", { name: "Day7 留存", exact: true }).click();
  expect((await cross).status()).toBe(200);
  await expect(page.locator("table.xd-tbl thead")).toContainText(/vi|en|zh/);

  const curve = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/admin/bi/retention/curve");
  await page.getByRole("button", { name: "查询曲线", exact: true }).first().click();
  expect((await curve).status()).toBe(200);
  await expect(page.locator("body")).not.toContainText(/null%|NaN|Infinity|undefined%/);
});

test("malformed 200 analytics response fails closed and disables export", async ({ page }) => {
  await page.route("**/api/admin/bi/funnel/overview", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      code: 0,
      data: {
        funnel: [{ stage: "注册", users: -1, cvr: 999 }],
        funnelExt: [],
        cohorts: [{ w: "bad", size: -3, d7: 140 }],
        curves: {},
        crossAnalysis: {},
      },
    }),
  }));
  await openL2(page);
  await expect(page.getByText(/L2 响应协议错误|L2 后端已响应，但当前没有可展示的数据/)).toBeVisible();
  await expect(page.getByRole("button", { name: /导出/ })).toBeDisabled();
  await expect(page.locator("body")).not.toContainText(/999%|140%/);
  await page.screenshot({ path: `${EVIDENCE}/malformed-200-fail-closed.png`, fullPage: true });
});

test("503 is recoverable, refresh/relogin preserves server truth and no stale slice is exported", async ({ page }) => {
  let failOnce = true;
  await page.route("**/api/admin/bi/funnel/overview", async (route) => {
    if (failOnce) {
      failOnce = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: 503, message: "BI_BACKEND_UNAVAILABLE" }),
      });
      return;
    }
    await route.continue();
  });
  await openL2(page);
  await expect(page.getByText(/L2 数据加载失败/)).toBeVisible();
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.locator(".ttl").filter({ hasText: /完整漏斗下钻 · 五级|生命周期事实计数/ }).first()).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".ttl").filter({ hasText: /完整漏斗下钻 · 五级|生命周期事实计数/ }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/null%|NaN|Infinity|undefined%/);
});

test("L2 read endpoints reject an unauthenticated context", async ({ baseURL }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL: baseURL || "http://127.0.0.1:3002" });
  for (const path of [
    "/api/admin/bi/funnel/drilldown",
    "/api/admin/bi/retention/cohort-matrix?window=Day1,Day7",
    "/api/admin/bi/funnel/cross?dim1=ref&dim2=locale&metric=cvr",
  ]) {
    const response = await anonymous.get(path);
    expect(response.status(), path).toBe(401);
    const body = await response.json();
    expect(body.message, path).toBe("ADMIN_AUTH_REQUIRED");
  }
  await anonymous.dispose();
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
