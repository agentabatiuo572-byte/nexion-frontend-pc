import { expect, request, test, type Page, type Response } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const EVIDENCE_DIR =
  process.env.E3_EVIDENCE_DIR ||
  "D:/workspace/nexion-ops-console/docs/验收报告/PC全面测试-20260726/evidence/E3-owner";

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("首次运营用户从可见侧栏理解 E3、打开手册、检查调整入口并在刷新重登后恢复", async ({ page }) => {
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      pageErrors.push(message.text());
    }
  });
  page.on("response", (response) => collectServerError(response, serverErrors));

  await loginFromVisibleEntry(page);
  await openE3FromVisibleSidebar(page);
  await expectCanonicalSurface(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-e3-canonical-surface.png`, fullPage: true });

  await page.getByRole("button", { name: "操作说明手册" }).click();
  const manual = page.getByRole("dialog", { name: /操作说明手册/ });
  await expect(manual).toBeVisible();
  await expect(manual).toContainText("仅抵新机货款、不入可提余额");
  await expect(manual).toContainText("B1");
  await expect(manual).toContainText("A2");
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-operation-manual.png`, fullPage: true });
  await manual.getByRole("button", { name: "关闭" }).click();

  const adjustment = page.getByRole("button", { name: "调整" }).first();
  await expect(adjustment).toBeVisible();
  await adjustment.click();
  const confirm = page.getByRole("dialog").last();
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(/操作确认|目标新值/);
  await expect(confirm.getByRole("button", { name: /确认|提交/ })).toBeDisabled();
  await page.screenshot({ path: `${EVIDENCE_DIR}/03-safe-adjustment-entry.png`, fullPage: true });
  await confirm.getByRole("button", { name: "关闭" }).click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectCanonicalSurface(page);
  await logoutFromVisibleControl(page);
  await loginFromVisibleEntry(page);
  await openE3FromVisibleSidebar(page);
  await expectCanonicalSurface(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/04-refresh-relogin.png`, fullPage: true });

  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});

test("E3 权威读取失败时关闭业务面，并可由可见刷新动作恢复", async ({ page }) => {
  await loginFromVisibleEntry(page);
  await page.route("**/api/admin/devices/e3/overview", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: 503, message: "E3_TEST_UNAVAILABLE", data: null }),
    }),
  );
  await openE3FromVisibleSidebar(page);
  await expect(page.getByText("E3 配置不完整")).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新" })).toBeVisible();
  await expect(page.getByText("升级置换阶梯")).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/05-read-failure-closed.png`, fullPage: true });

  await page.unroute("**/api/admin/devices/e3/overview");
  await page.getByRole("button", { name: "刷新" }).click();
  await expectCanonicalSurface(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/06-read-recovered.png`, fullPage: true });
});

test("E3 接口权限、MySQL 来源、未知参数拒绝和零配置副作用", async ({ page, baseURL }) => {
  await loginFromVisibleEntry(page);
  const beforeResponse = await page.request.get("/api/admin/devices/e3/overview");
  expect(beforeResponse.status()).toBe(200);
  const before = await beforeResponse.json();
  expect(before.code).toBe(0);
  expect(before.data.sources).toEqual(expect.arrayContaining([
    "nx_compute_e3_config",
    "nx_tradein_application",
    "nx_trade_in_order",
    "nx_user_device",
  ]));
  expect(before.data.config.tradeinEnabled).toBeTruthy();
  expect(before.data.config.tradeinLadderCut1).toBeDefined();

  const tradeinResponse = await page.request.get("/api/admin/devices/e3/tradein/overview");
  expect(tradeinResponse.status()).toBe(200);
  const tradein = await tradeinResponse.json();
  expect(tradein.code).toBe(0);
  expect(tradein.data).toEqual(expect.objectContaining({
    tradeinMonthCount: expect.any(Number),
    tradeinDiscountUsdt: expect.any(Number),
    txStats: expect.any(Array),
  }));

  const invalid = await page.request.patch("/api/admin/devices/e3/config", {
    headers: { "Idempotency-Key": `e3-owner-invalid-${Date.now()}` },
    data: {
      key: "E.tradein.notARealKey",
      value: "1",
      reason: "E3验收未知参数必须拒绝且不得修改配置",
      operator: USERNAME,
    },
  });
  expect(invalid.status()).toBe(422);
  const invalidBody = await invalid.json();
  expect(invalidBody.code).not.toBe(0);
  expect(String(invalidBody.message)).toMatch(/UNKNOWN|UNSUPPORTED|INVALID|CONFIG_KEY/i);

  const afterResponse = await page.request.get("/api/admin/devices/e3/overview");
  const after = await afterResponse.json();
  expect(after.data.config).toEqual(before.data.config);

  const anonymous = await request.newContext({ baseURL });
  const anonymousRead = await anonymous.get("/api/admin/devices/e3/overview");
  expect(anonymousRead.status()).toBe(401);
  await anonymous.dispose();
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
    await fillUnlessShellRecovered(username, USERNAME, shell);
    if (await shell.isVisible()) return;
    await fillUnlessShellRecovered(page.locator('input[autocomplete="current-password"]'), PASSWORD, shell);
    if (await shell.isVisible()) return;
    await page.getByRole("button", { name: /继续|登录/ }).click();
  }
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openE3FromVisibleSidebar(page: Page) {
  const group = page.getByRole("button", { name: /设备与商城\s+E|E\s+设备与商城/ }).first();
  if (
    await group.isVisible({ timeout: 5_000 }).catch(() => false)
    && await group.getAttribute("aria-expanded") !== "true"
  ) {
    await group.click();
  }
  const link = page.locator('a[href="/devices/trade-in"]').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/devices\/trade-in$/);
}

async function expectCanonicalSurface(page: Page) {
  await expect(page.getByText("任务产能曲线")).toBeVisible();
  await expect(page.getByText("升级置换阶梯")).toBeVisible();
  await expect(page.getByText("原子换机 tx 监控")).toBeVisible();
  await expect(page.getByText("E3 配置不完整")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/mock 用户详情|localStorage|BACKEND_UNAVAILABLE/i);
}

async function logoutFromVisibleControl(page: Page) {
  const logout = page.getByRole("button", { name: /退出登录|登出/ }).first();
  if (await logout.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await logout.click();
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    return;
  }
  const account = page.locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]').first();
  if (await account.isVisible({ timeout: 3_000 }).catch(() => false)) await account.click();
  const menuLogout = page.getByText(/退出登录|登出/, { exact: true }).first();
  await expect(menuLogout).toBeVisible();
  await menuLogout.click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
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

function collectServerError(response: Response, failures: string[]) {
  if (!response.url().includes("/api/admin/") || response.status() < 500) return;
  failures.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
}
