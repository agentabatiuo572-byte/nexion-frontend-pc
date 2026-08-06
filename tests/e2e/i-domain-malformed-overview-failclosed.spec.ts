import { expect, test, type Page, type Response } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";

const CASES = [
  {
    moduleId: "I1",
    endpoint: "**/api/admin/content/copy-ab/overview",
    data: { stats: {}, copies: "malformed" },
  },
  {
    moduleId: "I2",
    endpoint: "**/api/admin/content/nova/overview",
    data: { stats: {}, templates: "malformed" },
  },
  {
    moduleId: "I3",
    endpoint: "**/api/admin/content/campaigns/overview",
    data: { stats: {}, audienceCatalog: { phases: "malformed" } },
  },
  {
    moduleId: "I4",
    endpoint: "**/api/admin/content/trust-disclosure/overview",
    data: { stats: {}, trustSectionVersions: [{ fields: "malformed" }] },
  },
  {
    moduleId: "I5",
    endpoint: "**/api/admin/content/trust-disclosure/overview",
    data: { stats: {}, trustSectionVersions: [{ fields: "malformed" }] },
  },
  {
    moduleId: "I6",
    endpoint: "**/api/admin/content/i18n-learning/overview",
    data: { stats: {}, messages: [{ placeholders: "malformed" }] },
  },
] as const;

for (const scenario of CASES) {
  test(`${scenario.moduleId} 畸形 200 必须中文失败关闭，重试后恢复真实数据`, async ({ page }) => {
    const pageErrors: string[] = [];
    const unexpected5xx: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => collectUnexpected5xx(response, unexpected5xx));

    await loginFromVisibleEntry(page);
    await page.route(scenario.endpoint, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, message: "OK", data: scenario.data }),
      });
    });

    await openFromVisibleSidebar(page, scenario.moduleId);
    await expect(page.getByText("I 域数据加载失败", { exact: false })).toBeVisible();
    await expect(page.getByText(`${scenario.moduleId} 返回数据格式异常，请刷新重试`, { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "重新加载", exact: true })).toBeVisible();
    await expect(page.locator(".idom table")).toHaveCount(0);
    await expect(
      page.locator(".idom").getByRole("button", { name: /新增|编辑|发布|保存|下架|归档|删除|启动|停止|采纳/ }),
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("This page couldn’t load");

    await page.unroute(scenario.endpoint);
    const recovered = page.waitForResponse(
      (response) =>
        response.url().includes(scenario.endpoint.replace("**", "")) &&
        response.request().method() === "GET" &&
        response.status() === 200,
    );
    await page.getByRole("button", { name: "重新加载", exact: true }).click();
    await recovered;
    await expect(page.getByText("I 域数据加载失败", { exact: false })).toBeHidden();
    await expect(page.getByRole("button", { name: "重新加载", exact: true })).toBeHidden();
    await expect(page.locator("body")).not.toContainText(/Cannot read properties|ReferenceError|TypeError/i);

    expect(pageErrors, "畸形 200 与恢复过程不应产生未处理 pageerror").toEqual([]);
    expect(unexpected5xx, "异常分支仅注入畸形 200，不应伴随真实 5xx").toEqual([]);
  });
}

async function loginFromVisibleEntry(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 8_000 }),
    username.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => undefined);
  if (await shell.isVisible()) return;
  await expect(username).toBeVisible({ timeout: 8_000 });
  await username.fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openFromVisibleSidebar(page: Page, moduleId: string) {
  const moduleCase = CONSOLE_NAV
    .flatMap((domain) => domain.l2.map((module) => ({ domain, module })))
    .find(({ module }) => module.id === moduleId);
  if (!moduleCase) throw new Error(`${moduleId} 不在导航真源中`);

  const group = page
    .getByRole("button", {
      name: new RegExp(
        `(${escapeRegExp(moduleCase.domain.name)}\\s+${escapeRegExp(moduleCase.domain.code)}|${escapeRegExp(moduleCase.domain.code)}\\s+${escapeRegExp(moduleCase.domain.name)})`,
      ),
    })
    .first();
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();

  const link = page.locator(`a[href="${moduleCase.module.path}"]`).first();
  await expect(link, `${moduleId} 必须有当前角色可见的侧栏入口`).toBeVisible({ timeout: 10_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(moduleCase.module.path)}(?:\\?.*)?$`), {
    timeout: 20_000,
  });
}

function collectUnexpected5xx(response: Response, failures: string[]) {
  if (!response.url().includes("/api/admin/") || response.status() < 500) return;
  failures.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
