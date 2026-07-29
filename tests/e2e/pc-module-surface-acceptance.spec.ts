import { expect, test, type Page, type Response } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

const MODULE_ID = (process.env.ADMIN_MODULE_ID ?? "").trim().toUpperCase();
const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";

const moduleCase = CONSOLE_NAV
  .flatMap((domain) => domain.l2.map((module) => ({ domain, module })))
  .find(({ module }) => module.id === MODULE_ID);

test.describe(`PC 管理端模块表面验收 ${MODULE_ID || "<未指定>"}`, () => {
  test.beforeAll(() => {
    if (!moduleCase) {
      throw new Error(`ADMIN_MODULE_ID=${MODULE_ID || "<empty>"} 不是当前导航中的有效模块`);
    }
  });

  test("从登录页和可见侧栏进入，页面健康，刷新与重新登录后仍可恢复", async ({ page }) => {
    const errors: string[] = [];
    const failedResponses: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.text().startsWith("Failed to load resource:")
      ) {
        errors.push(message.text());
      }
    });
    page.on("response", (response) => collectFailedResponse(response, failedResponses));

    await loginFromVisibleEntry(page);
    await openFromVisibleSidebar(page);
    await assertHealthy(page);

    await page.reload({ waitUntil: "domcontentloaded" });
    await assertHealthy(page);

    await logoutFromVisibleControl(page);
    await loginFromVisibleEntry(page);
    await openFromVisibleSidebar(page);
    await assertHealthy(page);

    expect(errors, "页面不应产生未处理的脚本或控制台错误").toEqual([]);
    expect(failedResponses, "模块主页面读取不应返回 5xx").toEqual([]);
  });
});

async function loginFromVisibleEntry(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 8_000 }),
    username.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => undefined);
  if (await shell.isVisible()) return;
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    for (let attempt = 0; attempt < 2 && !(await shell.isVisible()); attempt += 1) {
      await fillUnlessShellRecovered(username, USERNAME, shell);
      if (await shell.isVisible()) return;
      await fillUnlessShellRecovered(
        page.locator('input[autocomplete="current-password"]'),
        PASSWORD,
        shell,
      );
      if (await shell.isVisible()) return;
      const loginRequest = page.waitForRequest((request) =>
        request.method() === "POST"
        && new URL(request.url()).pathname === "/api/admin/auth/login", {
        timeout: 5_000,
      }).catch(() => null);
      try {
        await page.getByRole("button", { name: /继续|登录/ }).click();
      } catch (error) {
        if (!(await shell.isVisible())) throw error;
      }
      if (await shell.isVisible()) return;
      const request = await loginRequest;
      if (request) break;
    }
  }
  await expect(shell).toBeVisible({ timeout: 20_000 });
  await expect(username).toBeHidden({ timeout: 20_000 });
}

async function openFromVisibleSidebar(page: Page) {
  if (!moduleCase) return;
  const group = page
    .getByRole("button", {
      name: new RegExp(
        `(${escapeRegExp(moduleCase.domain.name)}\\s+${escapeRegExp(moduleCase.domain.code)}|${escapeRegExp(moduleCase.domain.code)}\\s+${escapeRegExp(moduleCase.domain.name)})`,
      ),
    })
    .first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await group.click();
  }
  const link = page.locator(`a[href="${moduleCase.module.path}"]`).first();
  await expect(link, `${MODULE_ID} 必须有当前角色可见的侧栏入口`).toBeVisible({ timeout: 10_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(moduleCase.module.path)}(?:\\?.*)?$`), {
    timeout: 20_000,
  });
}

async function assertHealthy(page: Page) {
  if (!moduleCase) return;
  await expect(page.getByText(new RegExp(`\\b${escapeRegExp(MODULE_ID)}\\b`)).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator("body")).not.toContainText(/数据加载失败|Handler dispatch failed|NoSuchMethodError|SQLSyntaxErrorException|BACKEND_UNAVAILABLE|Cannot read properties|ReferenceError|TypeError/i);
  await expect(page.locator("body")).not.toContainText(/mock 用户详情|localStorage/i);
}

async function logoutFromVisibleControl(page: Page) {
  const logout = page
    .getByRole("button", { name: /^(退出登录|登出)$/ })
    .first();
  if (await logout.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await logout.click();
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
    return;
  }
  const account = page.locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]').first();
  if (await account.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await account.click();
  }
  const menuLogout = page.getByText(/退出登录|登出/, { exact: true }).first();
  await expect(menuLogout, "必须能从当前可见账号控件退出登录").toBeVisible({ timeout: 8_000 });
  await menuLogout.click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function fillUnlessShellRecovered(
  field: ReturnType<Page["locator"]>,
  value: string,
  shell: ReturnType<Page["locator"]>,
) {
  try {
    await field.fill(value);
  } catch (error) {
    if (await shell.isVisible()) return;
    throw error;
  }
}

function collectFailedResponse(response: Response, failures: string[]) {
  if (!response.url().includes("/api/admin/") || response.status() < 500) return;
  failures.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
