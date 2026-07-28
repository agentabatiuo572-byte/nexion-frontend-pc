import { expect, test, type Page, type Response } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await loginFromVisibleEntry(page);
});

test("L3 visible entry renders the seven authoritative sources and all four reports", async ({ page }) => {
  const seen = new Map<string, Response>();
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (L3_PATHS.has(pathname)) seen.set(`${pathname}${new URL(response.url()).search}`, response);
  });

  await openL3(page);
  await expect(page.getByText("收入结构报表", { exact: true })).toBeVisible();
  await expect(page.getByText("兑付报表", { exact: true })).toBeVisible();
  await expect(page.getByText("净敞口报表", { exact: true })).toBeVisible();
  await expect(page.getByText("负债到期报表", { exact: true })).toBeVisible();
  await expect(page.getByText("待核实入金", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "申请导出脱敏资金明细", exact: true })).toBeEnabled();
  await expect(page.locator("body")).not.toContainText(/NaN|Infinity|undefined|null%|用户级资金明细暂不可导出/);

  await expect.poll(() => [...seen.values()].filter((response) => response.status() === 200).length).toBeGreaterThanOrEqual(7);
  const liabilities = await page.request.get("/api/admin/treasury/liabilities?breakdown=true");
  expect(liabilities.status()).toBe(200);
  const liabilityPayload = await liabilities.json();
  expect(liabilityPayload.data.hardLiabilityCategoryCount).toBe(9);
  expect(liabilityPayload.data.breakdown).toHaveLength(9);
  const maturity7 = await page.request.get("/api/admin/treasury/maturity-forecast?window=7d");
  const maturity30 = await page.request.get("/api/admin/treasury/maturity-forecast?window=30d");
  expect((await maturity7.json()).data.daily).toHaveLength(7);
  expect((await maturity30.json()).data.daily).toHaveLength(30);

  await page.getByRole("button", { name: "季", exact: true }).click();
  await expect(page.getByRole("button", { name: "季", exact: true })).toHaveClass(/sel/);
  await expect(page.getByText("收入结构报表", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("l3-visible-entry-four-reports.png"), fullPage: true });
});

test("L3 masked detail follows reason, idempotency, L5 approval and tokenized download", async ({ page }) => {
  await openL3(page);
  await page.getByRole("button", { name: "申请导出脱敏资金明细", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("脱敏资金明细范围");
  await expect(dialog).toContainText("最多 100,000 行");
  const confirm = dialog.getByRole("button", { name: "确认提交", exact: true });
  await dialog.locator("textarea").fill("太短");
  await expect(confirm).toBeDisabled();
  await dialog.locator("textarea").fill("财务月结核账使用，仅限本次脱敏快照复核");
  await expect(confirm).toBeEnabled();

  let requestBody: Record<string, unknown> = {};
  let idempotencyKey = "";
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/admin/bi/reports") {
      requestBody = request.postDataJSON() as Record<string, unknown>;
      idempotencyKey = request.headers()["idempotency-key"] || "";
    }
  });
  const createdResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/bi/reports");
  await confirm.click();
  const createdHttp = await createdResponse;
  expect(createdHttp.status()).toBeLessThan(400);
  const createdPayload = await createdHttp.json();
  const created = createdPayload.data.created as {
    reportId: string;
    type: string;
    containsPii: boolean;
    maskingPolicy: string;
    status: string;
  };
  expect(created).toMatchObject({
    type: "FINANCE_AGG",
    containsPii: true,
    maskingPolicy: "MASKED",
    status: "PENDING_CONFIRM",
  });
  expect(idempotencyKey).toMatch(/^l3-finance-detail-/);
  expect(requestBody).toMatchObject({
    exportType: "财务资金明细",
    piiLevel: "HIGH_PII",
    maskPolicy: "MASKED",
  });
  expect(String(requestBody.timeRange)).toMatch(/^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/);
  expect(String(requestBody.fields).split(",").length).toBeGreaterThanOrEqual(1);

  await openFromSidebar(page, "/analytics/export");
  const row = page.locator("table tbody tr").filter({ hasText: created.reportId }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("含隐私");
  await expect(row).toContainText("已脱敏");
  await row.getByRole("button", { name: "审批脱敏明细", exact: true }).click();
  const approval = page.getByRole("dialog");
  await approval.locator("textarea").fill("复核字段、周期、用途与脱敏策略均符合月结要求");
  const approvedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === `/api/admin/bi/reports/${created.reportId}/approve`);
  await approval.getByRole("button", { name: "确认提交", exact: true }).click();
  expect((await approvedResponse).status()).toBeLessThan(400);
  await expect(row.getByRole("button", { name: "下载", exact: true })).toBeVisible();

  const tokenResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/admin/bi/exports/${created.reportId}/download-token`);
  const fileResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/admin/bi/exports/${created.reportId}/download`);
  const download = page.waitForEvent("download");
  await row.getByRole("button", { name: "下载", exact: true }).click();
  const [tokenHttp, fileHttp, file] = await Promise.all([tokenResponse, fileResponse, download]);
  expect(tokenHttp.status()).toBeLessThan(400);
  expect(fileHttp.status()).toBeLessThan(400);
  expect(file.suggestedFilename()).toMatch(/\.csv$/i);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain("用户编码（脱敏）");
  expect(csv).not.toMatch(/手机号|昵称|备注|真实姓名/);
});

test("L3 malformed HTTP 200 fails closed and disables both exports", async ({ page }) => {
  await page.route("**/api/admin/bi/finance/revenue?*", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.data.streams = payload.data.streams.slice(0, 3);
    await route.fulfill({ response, body: JSON.stringify(payload) });
  });
  await openFromSidebar(page, "/analytics/financial");
  await expect(page.getByRole("heading", { name: "财务报表" })).toBeVisible();
  await expect(page.getByText(/L3 数据加载失败/)).toBeVisible();
  await expect(page.locator("body")).toContainText("L3_FINANCE_PROTOCOL_INVALID");
  await expect(page.getByRole("button", { name: "导出财务当前汇总 CSV", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "申请导出脱敏资金明细", exact: true })).toBeDisabled();
  await expect(page.locator("body")).not.toContainText(/本期总收入[\s\S]*0\.00/);
  await page.screenshot({ path: test.info().outputPath("l3-malformed-200-fail-closed.png"), fullPage: true });
});

test("L3 refresh and real logout-login rebuild the same server-authoritative view", async ({ page }) => {
  await openL3(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("负债到期报表", { exact: true })).toBeVisible();

  await logoutFromVisibleAccountControl(page);
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible();
  await openL3(page);
  await expect(page.getByText("待核实入金", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/NaN|Infinity|undefined|null%/);
});

async function logoutFromVisibleAccountControl(page: Page) {
  const directLogout = page.getByRole("button", { name: "退出登录", exact: true }).first();
  if (await directLogout.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await directLogout.click();
    return;
  }
  const accountMenu = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(accountMenu, "当前账号入口必须可见").toBeVisible();
  await accountMenu.click();
  const menuLogout = page.getByRole("button", { name: "退出登录", exact: true }).last();
  await expect(menuLogout, "账号菜单必须提供退出登录").toBeVisible();
  await menuLogout.click();
}

const L3_PATHS = new Set([
  "/api/admin/bi/finance/overview",
  "/api/admin/bi/finance/revenue",
  "/api/admin/bi/finance/redemption",
  "/api/admin/treasury/coverage",
  "/api/admin/treasury/liabilities",
  "/api/admin/treasury/maturity-forecast",
]);

async function loginFromVisibleEntry(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /登录|继续/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openL3(page: Page) {
  await openFromSidebar(page, "/analytics/financial");
  await expect(page.getByRole("heading", { name: "财务报表" })).toBeVisible();
  await expect(page.getByText("收入结构报表", { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function openFromSidebar(page: Page, path: string) {
  const domain = page.getByRole("button", { name: "数据与分析 BI L", exact: true });
  if ((await domain.getAttribute("aria-expanded")) !== "true") await domain.click();
  const link = page.locator(`aside a[href="${path}"]`);
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}
