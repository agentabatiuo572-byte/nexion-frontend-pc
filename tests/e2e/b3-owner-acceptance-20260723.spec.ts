import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const PUBLIC = "D:/workspace/bug-pic/b-domain-acceptance-20260723/final/B3";

test.describe.configure({ mode: "serial" });

test("B3 visible-entry journey exposes the complete canonical funnel workflow", async ({ page }) => {
  await login(page);
  const group = page.getByRole("button", { name: /总览驾驶舱/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  const entry = page.locator('aside a[href="/overview/funnel"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/overview\/funnel$/);
  await expect(page.getByRole("heading", { name: "转化漏斗" })).toBeVisible();

  await expect(page.getByLabel("注册 cohort")).toBeVisible();
  await expect(page.getByLabel("Phase")).toBeVisible();
  await expect(page.getByLabel("推荐码 / 渠道")).toBeVisible();
  await expect(page.getByText("Day0 接入率", { exact: true })).toBeVisible();
  await expect(page.getByText("Day7 留存率", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存为视图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 cohort" })).toBeVisible();
  await expect(page.getByRole("link", { name: /L2 完整下钻/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /H1 Phase 归因/ })).toBeVisible();
  await expect(page.locator("[data-testid='b3-stage']")).toHaveCount(5);
  await expect(page.locator("body")).not.toContainText(/NaN|Infinity|null%|undefined%/);
  await page.screenshot({ path: `${PUBLIC}/01-visible-entry-five-stage.png`, fullPage: true });
});

test("B3 rejects unauthenticated reads", async ({ baseURL }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL: baseURL || "http://127.0.0.1:3002" });
  const response = await anonymous.get("/api/admin/funnel");
  expect(response.status()).toBe(401);
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
