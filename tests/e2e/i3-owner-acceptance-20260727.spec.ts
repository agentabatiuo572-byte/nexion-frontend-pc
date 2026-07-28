import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const EVIDENCE_DIR =
  process.env.I3_EVIDENCE_DIR ||
  "D:/workspace/nexion-ops-console/docs/验收报告/PC全面测试-20260726/evidence/I3-owner";

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("首次用户从登录和可见侧栏进入 I3，刷新和重登后恢复服务端事实", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      pageErrors.push(message.text());
    }
  });

  await login(page);
  await openI3(page);
  await expectI3Ready(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-visible-entry.png`, fullPage: true });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectI3Ready(page);
  await logout(page);
  await login(page);
  await openI3(page);
  await expectI3Ready(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-refresh-relogin.png`, fullPage: true });

  expect(pageErrors).toEqual([]);
});

test("I3 权威读取失败时不展示伪业务数据，恢复接口后可重新读取", async ({ page }) => {
  await login(page);
  await page.route("**/api/admin/content/campaigns/overview", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: 503, message: "I3_TEST_UNAVAILABLE", data: null }),
    }),
  );
  await openI3(page);
  await expect(page.getByText("I3 暂无真实接口数据")).toBeVisible();
  await expect(page.getByText("本月 campaign", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/03-read-failure-closed.png`, fullPage: true });

  await page.unroute("**/api/admin/content/campaigns/overview");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectI3Ready(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/04-read-recovered.png`, fullPage: true });
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
  await username.fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openI3(page: Page) {
  const group = page.getByRole("button", { name: /内容与合规 CMS\s+I|I\s+内容与合规 CMS/ }).first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  const link = page.locator('a[href="/content/notifications"]').first();
  await expect(link).toBeVisible({ timeout: 10_000 });
  await link.click();
  await expect(page).toHaveURL(/\/content\/notifications(?:\?.*)?$/, { timeout: 20_000 });
}

async function expectI3Ready(page: Page) {
  await expect(page.getByText("本月 campaign", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("通知唯一账本在服务器")).toBeVisible();
  await expect(page.getByText("I3 暂无真实接口数据")).toHaveCount(0);
}

async function logout(page: Page) {
  const direct = page.getByRole("button", { name: /退出登录|登出/ }).first();
  if (await direct.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await direct.click();
    return;
  }
  const account = page
    .locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]')
    .first();
  await account.click();
  const menuLogout = page.getByText(/退出登录|登出/, { exact: true }).first();
  await expect(menuLogout).toBeVisible();
  await menuLogout.click();
}
