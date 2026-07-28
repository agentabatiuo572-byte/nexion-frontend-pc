import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const MODULES = CONSOLE_NAV.flatMap((domain) =>
  domain.l2.map((module) => ({ domain, module })),
);
const UNHEALTHY =
  /数据加载失败|Handler dispatch failed|NoSuchMethodError|SQLSyntaxErrorException|BACKEND_UNAVAILABLE|Cannot read properties|ReferenceError|TypeError|mock 用户详情|localStorage/i;

test("75 个 PC 模块从可见入口完成刷新、重新登录和跨域终验", async ({ page }) => {
  test.setTimeout(1_800_000);
  const problems: string[] = [];
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  let currentModule = "登录";

  page.on("pageerror", (error) => consoleErrors.push(`${currentModule}: ${error.message}`));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    ) {
      consoleErrors.push(`${currentModule}: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    if (!response.url().includes("/api/admin/") || response.status() < 500) return;
    failedResponses.push(
      `${currentModule}: ${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`,
    );
  });

  expect(MODULES, "锁定导航应完整包含 75 个模块").toHaveLength(75);
  await loginFromVisibleEntry(page);

  for (const moduleCase of MODULES) {
    currentModule = moduleCase.module.id;
    try {
      await openFromVisibleSidebar(page, moduleCase);
      await assertHealthy(page, moduleCase.module.id);
      await page.reload({ waitUntil: "domcontentloaded" });
      await assertHealthy(page, moduleCase.module.id);
    } catch (error) {
      problems.push(`${currentModule} 首轮/刷新: ${errorText(error)}`);
    }
  }

  currentModule = "重新登录";
  await logoutFromVisibleControl(page);
  await loginFromVisibleEntry(page);

  for (const moduleCase of MODULES) {
    currentModule = moduleCase.module.id;
    try {
      await openFromVisibleSidebar(page, moduleCase);
      await assertHealthy(page, moduleCase.module.id);
    } catch (error) {
      problems.push(`${currentModule} 重新登录: ${errorText(error)}`);
    }
  }

  expect(problems, "每个模块均应从可见入口通过首轮、刷新和重新登录验收").toEqual([]);
  expect(consoleErrors, "页面不应产生未处理的脚本或控制台错误").toEqual([]);
  expect(failedResponses, "模块域内外主调用链不应返回 5xx").toEqual([]);
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
  await username.fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openFromVisibleSidebar(
  page: Page,
  moduleCase: (typeof MODULES)[number],
) {
  const link = page.locator(`a[href="${moduleCase.module.path}"]`).first();
  if (!(await link.isVisible({ timeout: 1_000 }).catch(() => false))) {
    const group = page
      .getByRole("button", {
        name: new RegExp(
          `(${escapeRegExp(moduleCase.domain.name)}\\s+${escapeRegExp(moduleCase.domain.code)}|${escapeRegExp(moduleCase.domain.code)}\\s+${escapeRegExp(moduleCase.domain.name)})`,
        ),
      })
      .first();
    await expect(group, `${moduleCase.domain.code} 域必须有可见侧栏分组`).toBeVisible({
      timeout: 8_000,
    });
    await group.click();
  }
  await expect(link, `${moduleCase.module.id} 必须有当前角色可见的侧栏入口`).toBeVisible({
    timeout: 8_000,
  });
  await link.click();
  await expect(page).toHaveURL(
    new RegExp(`${escapeRegExp(moduleCase.module.path)}(?:\\?.*)?$`),
    { timeout: 20_000 },
  );
}

async function assertHealthy(page: Page, moduleId: string) {
  await expect(page.getByText(new RegExp(`\\b${escapeRegExp(moduleId)}\\b`)).first()).toBeVisible({
    timeout: 15_000,
  });
  const body = await page.locator("body").innerText();
  expect(body, `${moduleId} 不应暴露失败、mock 或本地持久化文案`).not.toMatch(UNHEALTHY);
}

async function logoutFromVisibleControl(page: Page) {
  const logout = page.getByRole("button", { name: /退出登录|登出/ }).first();
  if (await logout.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await logout.click();
    return;
  }
  const account = page
    .locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]')
    .first();
  if (await account.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await account.click();
  }
  const menuLogout = page.getByText(/退出登录|登出/, { exact: true }).first();
  await expect(menuLogout, "必须能从当前可见账号控件退出登录").toBeVisible({
    timeout: 8_000,
  });
  await menuLogout.click();
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
