import { expect, test, type Page } from "@playwright/test";

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
  await page.route("**/api/admin/bi/reports", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    const body = request.postDataJSON() as Record<string, unknown>;
    await route.continue({ postData: JSON.stringify({ ...body, ticket: "99103-L3-FINANCE" }) });
  });
});

test("L3 真实财务事实可核验，聚合导出可在 L5 使用限时令牌下载", async ({ page }) => {
  await openFromSidebar(page, "/analytics/financial");
  await expect(page.getByRole("heading", { name: "财务报表" })).toBeVisible();
  await expect(page.getByText("本期总收入", { exact: true })).toBeVisible();
  await expect(page.getByText("兑付率(本期)", { exact: true })).toBeVisible();
  await expect(page.getByText("兑付覆盖率(来自权威账本)", { exact: true })).toBeVisible();
  await expect(page.getByText("储备可覆盖到期", { exact: true })).toBeVisible();
  for (const heading of ["收入结构报表", "兑付报表", "净敞口报表", "负债到期报表"]) {
    await expect(page.getByText(heading, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(/部分周期统计尚未接入/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "申请导出脱敏资金明细", exact: true })).toBeEnabled();
  await expect(page.locator("body")).not.toContainText(/nx_wallet|nx_admin|LEDGER·TREASURY|MATURITY 聚合|REVENUE/);

  let createRequestCount = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/admin/bi/reports") {
      createRequestCount += 1;
    }
  });
  const createdResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/bi/reports"
      && response.status() < 400,
  );
  await page.getByRole("button", { name: "导出财务当前汇总 CSV", exact: true }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  const createdPayload = await (await createdResponse).json();
  const created = createdPayload.data.created as { reportId: string; rowCount: number; containsPii: boolean; status: string };
  expect(created.reportId).toBeTruthy();
  expect(created.rowCount).toBeGreaterThan(10);
  expect(created.containsPii).toBe(false);
  expect(created.status).toBe("READY");
  await expect(page.getByText(/财务当前汇总已生成/)).toBeVisible();
  await expect.poll(() => createRequestCount).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("负债到期报表", { exact: true })).toBeVisible();
  await expect(page.getByText("锁仓本息其他", { exact: true })).toBeVisible();

  await openFromSidebar(page, "/analytics/export");
  const reportRow = page.locator("table tbody tr").filter({ hasText: created.reportId }).first();
  await expect(reportRow).toBeVisible({ timeout: 20_000 });

  const tokenResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/admin/bi/exports/${created.reportId}/download-token`
      && response.status() < 400,
  );
  const fileResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/admin/bi/exports/${created.reportId}/download`
      && (url.searchParams.get("token")?.length || 0) >= 32
      && response.status() < 400;
  });
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await reportRow.getByRole("button", { name: "下载", exact: true }).click();
  await tokenResponse;
  await fileResponse;
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain("资金池概览");
  expect(csv).toContain("负债科目");
  expect(csv).toContain("钱包账单");
  expect(csv).not.toMatch(/nx_wallet|nx_admin/);
});

test("L3 断网失败给出中文业务出口，恢复网络后可安全重试", async ({ page, context }) => {
  await openFromSidebar(page, "/analytics/financial");
  const exportButton = page.getByRole("button", { name: "导出财务当前汇总 CSV", exact: true });
  await context.setOffline(true);
  try {
    await exportButton.click();
    await expect(page.getByText(/网络连接已中断，未收到任务创建成功确认/)).toBeVisible();
    await expect(page.getByText(/请恢复网络后重试，同一请求会自动防重/)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Failed to fetch");
  } finally {
    await context.setOffline(false);
  }

  const retryResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/bi/reports"
      && response.status() < 400,
  );
  await exportButton.click();
  await retryResponse;
  await expect(page.getByText(/财务当前汇总已生成/)).toBeVisible();
});

async function openFromSidebar(page: Page, path: string) {
  const domain = page.getByRole("button", { name: "数据与分析 BI L", exact: true });
  if ((await domain.getAttribute("aria-expanded")) !== "true") await domain.click();
  const link = page.locator(`aside a[href="${path}"]`);
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}
