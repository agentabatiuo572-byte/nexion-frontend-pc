import { expect, request, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const EVIDENCE_DIR = process.env.JM_REVIEW_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/pc-full-acceptance-20260727/adversarial-J-M";
const DOMAIN_CODES = new Set(["J", "K", "L", "M"]);
const MODULES = CONSOLE_NAV
  .filter((domain) => DOMAIN_CODES.has(domain.code))
  .flatMap((domain) => domain.l2.map((module) => ({ domain, module })));
const UNHEALTHY =
  /数据加载失败|Handler dispatch failed|NoSuchMethodError|SQLSyntaxErrorException|BACKEND_UNAVAILABLE|Cannot read properties|ReferenceError|TypeError|mock 用户详情|localStorage|\bNaN\b|\bundefined\b/i;

test.describe.configure({ mode: "serial", timeout: 900_000 });

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("J1-M5 首次用户从可见入口逐模块进入、刷新并在重登后恢复", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const serverFailures: string[] = [];
  const visited: Array<{ id: string; path: string; apiReads: number }> = [];
  let currentModule = "登录";
  let apiReads = 0;

  page.on("pageerror", (error) => pageErrors.push(`${currentModule}: ${error.message}`));
  page.on("console", (message) => {
    if (
      message.type() === "error"
      && !message.text().startsWith("Failed to load resource:")
    ) {
      consoleErrors.push(`${currentModule}: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    if (!response.url().includes("/api/admin/")) return;
    if (response.request().method() === "GET" && response.status() < 400) apiReads += 1;
    if (response.status() >= 500) {
      serverFailures.push(
        `${currentModule}: ${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`,
      );
    }
  });

  expect(MODULES, "J1-M5 锁定范围应包含 21 个模块").toHaveLength(21);
  await loginFromVisibleEntry(page);

  for (const moduleCase of MODULES) {
    currentModule = moduleCase.module.id;
    const readsBefore = apiReads;
    await openFromVisibleSidebar(page, moduleCase);
    await assertHealthy(page, moduleCase.module.id);
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertHealthy(page, moduleCase.module.id);
    visited.push({
      id: moduleCase.module.id,
      path: moduleCase.module.path,
      apiReads: apiReads - readsBefore,
    });
    if (moduleCase.module.id.endsWith("1")) {
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, `${moduleCase.domain.code}-visible-entry-refresh.png`),
        fullPage: true,
      });
    }
  }

  currentModule = "重新登录";
  await logoutFromVisibleControl(page);
  await loginFromVisibleEntry(page);
  for (const moduleCase of MODULES) {
    currentModule = moduleCase.module.id;
    await openFromVisibleSidebar(page, moduleCase);
    await assertHealthy(page, moduleCase.module.id);
  }

  await writeFile(
    path.join(EVIDENCE_DIR, "visible-entry-refresh-relogin.json"),
    JSON.stringify({ modules: visited, pageErrors, consoleErrors, serverFailures }, null, 2),
    "utf8",
  );
  expect(visited.map((item) => item.id)).toEqual(MODULES.map(({ module }) => module.id));
  expect(
    visited.filter((item) => item.apiReads === 0),
    "每个模块首轮和刷新必须至少读取一个受保护服务端资源",
  ).toEqual([]);
  expect(pageErrors, "页面不应产生未处理脚本错误").toEqual([]);
  expect(consoleErrors, "页面不应产生未处理控制台错误").toEqual([]);
  expect(serverFailures, "J-M 域内外主调用链不应返回 5xx").toEqual([]);
});

test("J-M 未登录权限、认证后未知资源与 J4 只读安全门禁失败关闭", async ({ page }) => {
  const anonymous = await request.newContext({ baseURL: BASE_URL });
  try {
    for (const endpoint of [
      "/api/admin/emergency/kill-switches",
      "/api/admin/risk/multi-account/overview",
      "/api/admin/bi/kpi?window=7d",
      "/api/admin/content/tickets/overview",
    ]) {
      const response = await anonymous.get(endpoint);
      expect(response.status(), `${endpoint} 未登录必须拒绝`).toBe(401);
      expect(await response.json()).toMatchObject({
        code: 401,
        message: "ADMIN_AUTH_REQUIRED",
      });
    }
  } finally {
    await anonymous.dispose();
  }

  await loginFromVisibleEntry(page);
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/admin/")
      && !["GET", "HEAD", "OPTIONS"].includes(request.method())
    ) {
      mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  const unknown = await page.request.get(
    `/api/admin/emergency/__unknown_adversarial_${Date.now()}`,
  );
  expect(unknown.status(), "认证后的未知资源必须明确 404，不能伪装成功").toBe(404);

  await openFromVisibleSidebar(
    page,
    MODULES.find(({ module }) => module.id === "J4")!,
  );
  await expect(page.getByText(/实战先进入 A2 确认队列/)).toBeVisible();
  await expect(page.getByText(/J1\/J2\/C2\/K1\/I3\/I5/)).toBeVisible();
  expect(mutations, "J4 安全复审不得触发任何正式写入或执行请求").toEqual([]);
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "J4-v4-readonly-safety-gate.png"),
    fullPage: true,
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
  await username.fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openFromVisibleSidebar(
  page: Page,
  moduleCase: (typeof MODULES)[number],
) {
  const link = page.locator(`aside a[href="${moduleCase.module.path}"]`).first();
  if (!(await link.isVisible({ timeout: 1_000 }).catch(() => false))) {
    const group = page
      .getByRole("button", {
        name: new RegExp(
          `(${escapeRegExp(moduleCase.domain.name)}\\s+${escapeRegExp(moduleCase.domain.code)}|${escapeRegExp(moduleCase.domain.code)}\\s+${escapeRegExp(moduleCase.domain.name)})`,
        ),
      })
      .first();
    await expect(group, `${moduleCase.domain.code} 域应有可见侧栏分组`).toBeVisible({
      timeout: 8_000,
    });
    await group.click();
  }
  await expect(link, `${moduleCase.module.id} 应有当前角色可见的侧栏入口`).toBeVisible({
    timeout: 8_000,
  });
  await link.click();
  await expect(page).toHaveURL(
    new RegExp(`${escapeRegExp(moduleCase.module.path)}(?:\\?.*)?$`),
    { timeout: 20_000 },
  );
}

async function assertHealthy(page: Page, moduleId: string) {
  await expect(
    page.getByText(new RegExp(`\\b${escapeRegExp(moduleId)}\\b`)).first(),
  ).toBeVisible({ timeout: 20_000 });
  const body = await page.locator("body").innerText();
  expect(body, `${moduleId} 不得暴露错误、mock、本地持久化或非法值`).not.toMatch(UNHEALTHY);
}

async function logoutFromVisibleControl(page: Page) {
  const logout = page.getByRole("button", { name: /退出登录|登出/ }).first();
  if (await logout.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await logout.click();
  } else {
    const account = page
      .locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]')
      .first();
    await expect(account).toBeVisible({ timeout: 8_000 });
    await account.click();
    const menuLogout = page.getByText(/退出登录|登出/, { exact: true }).first();
    await expect(menuLogout).toBeVisible({ timeout: 8_000 });
    await menuLogout.click();
  }
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 15_000,
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
