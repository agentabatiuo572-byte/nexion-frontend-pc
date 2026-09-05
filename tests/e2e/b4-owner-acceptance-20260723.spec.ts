import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const PUBLIC = "D:/workspace/bug-pic/b-domain-acceptance-20260723/final/B4";

test.describe.configure({ mode: "serial" });

test("B4 visible-entry journey exposes the complete H1-canonical read-only workflow", async ({ page }) => {
  await login(page);
  const group = page.getByRole("button", { name: /总览驾驶舱/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  const entry = page.locator('aside a[href="/overview/rhythm"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/overview\/rhythm$/);
  await expect(page.getByRole("heading", { name: "节奏状态" })).toBeVisible();

  await expect(page.getByLabel("分布粒度")).toBeVisible();
  await expect(page.getByLabel("查看月份")).toBeVisible();
  await expect(page.getByLabel("Phase 筛选")).toBeVisible();
  await expect(page.getByText("8-dial 现值", { exact: false })).toBeVisible();
  await expect(page.locator("[data-testid='b4-dial-row']")).toHaveCount(8);
  await expect(page.getByText("距下一月粒度拐点", { exact: true })).toBeVisible();
  await expect(page.getByText("本月被推动的杠杆组合", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /导出 Phase 分布/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /B3 转化归因/ })).toBeVisible();
  await expect(page.locator('.b4-attribution-links a[href="/overview/dual-ledger"]')).toBeVisible();
  await expect(page.locator('.b4-attribution-links a[href="/overview/liquidity"]')).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Premium|NEXv2|NEX v2|NaN|Infinity|undefined/);
  await page.screenshot({ path: `${PUBLIC}/01-visible-entry-b4-workflow.png`, fullPage: true });
});

test("B4 rejects unauthenticated reads and unknown proxy routes", async ({ baseURL }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL: baseURL || "http://127.0.0.1:3002" });
  expect((await anonymous.get("/api/admin/phase/overview")).status()).toBe(401);
  expect((await anonymous.get("/api/admin/phase/not-allowed")).status()).toBe(404);
  await anonymous.dispose();
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /登录|继续/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}
