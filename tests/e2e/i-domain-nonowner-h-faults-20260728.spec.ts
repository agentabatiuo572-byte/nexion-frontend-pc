import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";

const MODULES = [
  { id: "I1", endpoint: "**/api/admin/content/copy-ab/overview" },
  { id: "I2", endpoint: "**/api/admin/content/nova/overview" },
  { id: "I3", endpoint: "**/api/admin/content/campaigns/overview" },
  { id: "I4", endpoint: "**/api/admin/content/trust-disclosure/overview" },
  { id: "I5", endpoint: "**/api/admin/content/trust-disclosure/overview" },
  { id: "I6", endpoint: "**/api/admin/content/i18n-learning/overview" },
] as const;

for (const module of MODULES) {
  test(`${module.id} HTTP 500 与真实恢复均在模块内失败关闭`, async ({ page }) => {
    await login(page);
    await page.route(module.endpoint, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: 500, message: `${module.id}_REVIEW_FAILURE`, data: null }),
      }),
    );
    await openFromSidebar(page, module.id);
    await expectFailureClosed(page, module.id);
    await page.unroute(module.endpoint);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectRecovered(page, module.id);
  });

  test(`${module.id} 网络结果未知与真实恢复均在模块内失败关闭`, async ({ page }) => {
    await login(page);
    await page.route(module.endpoint, (route) => route.abort("timedout"));
    await openFromSidebar(page, module.id);
    await expectFailureClosed(page, module.id);
    await page.unroute(module.endpoint);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectRecovered(page, module.id);
  });
}

test("匿名 401、已认证未知路由 404 均拒绝且不泄露业务数据", async ({ page }) => {
  const anonymous = await page.request.get("/api/admin/content/copy-ab/overview");
  expect(anonymous.status()).toBe(401);
  const anonymousBody = await anonymous.text();
  expect(anonymousBody).not.toMatch(/copies|experiments|templates|campaigns/i);

  await login(page);
  const missing = await page.request.get("/api/admin/content/__acceptance_missing_endpoint__");
  expect(missing.status()).toBe(404);
  const missingBody = await missing.text();
  expect(missingBody).not.toMatch(/copies|experiments|templates|campaigns/i);
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 8_000 }),
    username.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => undefined);
  if (await shell.isVisible()) return;
  await expect(username).toBeVisible();
  await username.fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openFromSidebar(page: Page, moduleId: string) {
  const moduleCase = CONSOLE_NAV
    .flatMap((domain) => domain.l2.map((item) => ({ domain, item })))
    .find(({ item }) => item.id === moduleId);
  if (!moduleCase) throw new Error(`${moduleId} 不在导航真源中`);
  const group = page
    .getByRole("button", {
      name: new RegExp(
        `(${escapeRegExp(moduleCase.domain.name)}\\s+${moduleCase.domain.code}|${moduleCase.domain.code}\\s+${escapeRegExp(moduleCase.domain.name)})`,
      ),
    })
    .first();
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  const link = page.locator(`a[href="${moduleCase.item.path}"]`).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(moduleCase.item.path)}(?:\\?.*)?$`));
}

async function expectFailureClosed(page: Page, moduleId: string) {
  await expect(page.getByText("I 域数据加载失败", { exact: false })).toBeVisible();
  await expect(page.getByText(new RegExp(`${moduleId} 数据加载失败，请刷新重试`))).toBeVisible();
  await expect(page.getByRole("button", { name: "重新加载", exact: true })).toBeVisible();
  await expect(page.locator(".idom table")).toHaveCount(0);
  await expect(
    page.locator(".idom").getByRole("button", { name: /新增|编辑|发布|保存|下架|归档|删除|启动|停止|采纳/ }),
  ).toHaveCount(0);
}

async function expectRecovered(page: Page, moduleId: string) {
  await expect(page.getByText("I 域数据加载失败", { exact: false })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(new RegExp(`${moduleId} 数据加载失败，请刷新重试`))).toHaveCount(0);
  await expect(page.locator(".idom table").first()).toBeVisible();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
