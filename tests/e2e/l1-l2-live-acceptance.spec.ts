import { expect, test, type Page, type Response } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";

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
});

test("L1/L2 真实降级链：可理解、可刷新、导出落真实任务且无 PII", async ({ page }) => {
  const biOverviewPaths: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes("/api/admin/bi/") && (path.endsWith("/overview") || path === "/api/admin/bi/kpi")) biOverviewPaths.push(path);
  });
  await openFromSidebar(page, "/analytics/kpi");
  await expect(page.getByRole("heading", { name: "KPI 看板" })).toBeVisible();
  await expect(page.locator("button.kpi-card")).toHaveCount(8);
  await expect(page.getByText("KPI 口径锁定表", { exact: true })).toBeVisible();
  await expect(page.getByText("单 KPI 下钻", { exact: false })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/nx_user|nx_audit_log|§2\.4\.6|A4 事件/);
  expect(biOverviewPaths).toContain("/api/admin/bi/kpi");

  const l1AttemptKeys: string[] = [];
  let simulateLostResponse = true;
  await page.route("**/api/admin/bi/reports", async (route) => {
    l1AttemptKeys.push(route.request().headers()["idempotency-key"] || "");
    if (simulateLostResponse) {
      simulateLostResponse = false;
      const committed = await route.fetch();
      expect(committed.status()).toBeLessThan(400);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: 503, message: "上游响应暂时不可用" }),
      });
      return;
    }
    await route.continue();
  });
  const l1 = await submitExport(page, "导出 KPI 序列 CSV", false);
  await page.unroute("**/api/admin/bi/reports");
  expect(l1AttemptKeys).toHaveLength(2);
  expect(new Set(l1AttemptKeys).size).toBe(1);
  expect(l1.status()).toBeLessThan(400);
  const l1Payload = await l1.json();
  expect(l1Payload.data.created).toMatchObject({
    name: "KPI 序列",
    type: "KPI_SERIES",
    rowCount: 8,
    containsPii: false,
    maskingPolicy: "NONE",
    status: "READY",
  });
  await expect(page.getByText(/KPI 序列已导出/)).toBeVisible();

  await openFromSidebar(page, "/analytics/funnel-cohort");
  await expect(page.getByRole("heading", { name: "漏斗/cohort/留存" })).toBeVisible();
  await expect(page.getByText("生命周期事实计数", { exact: true })).toBeVisible();
  await expect(page.getByText(/各行是独立累计量，不直接相除为转化率/)).toBeVisible();
  await expect(page.getByText(/Cohort、留存与逐级转化暂不可计算/)).toBeVisible();
  await expect(page.getByText("已注册").first()).toBeVisible();
  await expect(page.getByText("0", { exact: true }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/nx_user|nx_wallet_ledger|A4 事件/);
  expect(biOverviewPaths).toContain("/api/admin/bi/funnel/overview");

  const l2 = await submitExport(page, "导出生命周期计数 CSV");
  expect(l2.status()).toBeLessThan(400);
  const l2Payload = await l2.json();
  expect(l2Payload.data.created).toMatchObject({
    name: "漏斗生命周期事实",
    type: "FUNNEL_COHORT",
    rowCount: 6,
    containsPii: false,
    maskingPolicy: "NONE",
    status: "READY",
  });
  await expect(page.getByText(/生命周期计数任务已提交/)).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("生命周期事实计数", { exact: true })).toBeVisible();
});

async function openFromSidebar(page: Page, path: string) {
  const domain = page.getByRole("button", { name: "数据与分析 BI L", exact: true });
  if ((await domain.getAttribute("aria-expanded")) !== "true") await domain.click();
  const link = page.locator(`aside a[href="${path}"]`);
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}

async function submitExport(page: Page, buttonName: string, requiresConfirm = true): Promise<Response> {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/bi/reports"
      && response.status() < 500,
  );
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  if (requiresConfirm) {
    await expect(page.getByRole("dialog")).toBeVisible();
    const confirm = page.getByRole("button", { name: "导出", exact: true }).last();
    await expect(confirm).toBeVisible();
    await confirm.click();
  }
  return responsePromise;
}
