import { expect, test, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const RUN_ID = "pc-full-acceptance-20260728-151023";

test.describe.configure({ mode: "serial" });

test("F2 HTTP 500 失败关闭并在真实上游恢复后重新加载", async ({ page }) => {
  await login(page);
  await page.route("**/api/admin/teams/rates**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: 500, message: "F_ACCEPTANCE_FAULT_INJECTION", data: null }),
    });
  });
  await openFromSidebar(page, "/network/royalty");
  await expect(page.getByText(/F2 数据加载失败/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /调整|暂停管理/ })).toHaveCount(0);

  await page.unroute("**/api/admin/teams/rates**");
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "GET"
    && new URL(candidate.url()).pathname === "/api/admin/teams/rates"
    && candidate.status() === 200);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await response;
  await expect(page.getByText("L1–L7 网络版税费率(Unilevel)", { exact: true })).toBeVisible();
});

test("F3 网络超时/结果未知失败关闭并恢复", async ({ page }) => {
  await login(page);
  await page.route("**/api/admin/teams/binary**", async (route) => {
    await route.abort("timedout");
  });
  await openFromSidebar(page, "/network/binary");
  await expect(page.getByText(/F3 数据加载失败/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /调整门槛|调整比例|暂停引擎|恢复引擎/ })).toHaveCount(0);

  await page.unroute("**/api/admin/teams/binary**");
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "GET"
    && new URL(candidate.url()).pathname === "/api/admin/teams/binary"
    && candidate.status() === 200);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await response;
  await expect(page.getByText("平衡匹配公式", { exact: true }).first()).toBeVisible();
});

test("F API 404 与 422 明确失败且无副作用", async ({ page }) => {
  await login(page);
  const missing = await page.request.get("/api/admin/teams/not-a-real-f-module");
  expect(missing.status()).toBe(404);

  const invalid = await page.request.patch(
    "/api/admin/teams/commissions/config/F.cooldown",
    {
      headers: { "Idempotency-Key": `${RUN_ID}-f-422-cooldown` },
      data: {
        value: "-1",
        reason: `${RUN_ID} F2 负数冷却期 422 负向验收`,
        operator: USERNAME,
      },
    },
  );
  const body = await invalid.json() as { code?: number; message?: string };
  expect(invalid.status() === 422 || body.code === 422, JSON.stringify(body)).toBe(true);
  const overview = await page.request.get("/api/admin/teams/rates");
  expect(overview.status()).toBe(200);
  const overviewBody = await overview.json() as {
    code?: number;
    data?: { configValues?: Record<string, string> };
  };
  expect(overviewBody.code).toBe(0);
  expect(overviewBody.data?.configValues?.["F.cooldown"]).not.toBe("-1");
});

async function openFromSidebar(page: Page, route: string) {
  const group = page.getByRole("button", { name: /分销与团队/ }).first();
  const link = page.locator(`aside a[href="${route}"]`).first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${route.replaceAll("/", "\\/")}$`));
}

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}
