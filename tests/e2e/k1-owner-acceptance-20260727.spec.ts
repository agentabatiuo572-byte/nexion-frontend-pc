import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const EVIDENCE_DIR = process.env.K1_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/pc-full-acceptance-20260727/K1/final";
const USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const OVERVIEW_API = "**/api/admin/risk/multi-account/overview*";

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("K1 首次用户可见入口、失败关闭、刷新与重登完整复验", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error"
      && !/favicon|webpack-hmr|status of (401 \(Unauthorized\)|503 \(Service Unavailable\))/i.test(message.text())) {
      runtimeErrors.push(message.text());
    }
  });

  await test.step("未登录读写都失败关闭", async () => {
    const read = await page.request.get("/api/admin/risk/multi-account/overview");
    expect(read.status()).toBe(401);
    await expect(read.json()).resolves.toMatchObject({ code: 401, message: "ADMIN_AUTH_REQUIRED" });

    const write = await page.request.patch("/api/admin/risk/multi-account/clusters/UNKNOWN/status", {
      headers: { "Idempotency-Key": `k1-anonymous-${Date.now()}` },
      data: {
        status: "flagged",
        expectedVersion: 0,
        reason: "K1 未登录写入必须被拒绝",
        operator: "anonymous",
      },
    });
    expect(write.status()).toBe(401);
    await expect(write.json()).resolves.toMatchObject({ code: 401, message: "ADMIN_AUTH_REQUIRED" });
  });

  await test.step("首次用户从登录和侧栏进入 K1", async () => {
    await loginFromVisibleEntry(page);
    await openK1FromVisibleSidebar(page);
    await expect(page.getByText("监控中账户簇", { exact: true })).toBeVisible();
    await expect(page.getByText("三层去重命中列表", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "IP", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "设备指纹", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "支付工具", exact: true })).toBeVisible();
    await expect(page.getByText(/K1 参数单源保存/)).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "01-visible-login-sidebar-three-authoritative-layers.png"),
      fullPage: true,
    });
  });

  await test.step("503 时清空旧数据与写入口并可恢复", async () => {
    await page.route(OVERVIEW_API, (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: 503, message: "RISK_SERVICE_UNAVAILABLE", data: null }),
    }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("K1 数据加载失败", { exact: true })).toBeVisible();
    await expect(page.getByText(/已隐藏旧数据与写操作/)).toBeVisible();
    await expect(page.getByRole("button", { name: "调整", exact: true })).toHaveCount(0);
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "02-overview-503-fail-closed.png"),
      fullPage: true,
    });

    await page.unroute(OVERVIEW_API);
    await page.getByRole("button", { name: "仅重试 K1", exact: true }).click();
    await expect(page.getByText("监控中账户簇", { exact: true })).toBeVisible();
    await expect(page.getByText("K1 数据加载失败", { exact: true })).toHaveCount(0);
  });

  await test.step("刷新和重登仍从服务端重新读取", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("三层去重命中列表", { exact: true })).toBeVisible();
    await logout(page);
    await loginFromVisibleEntry(page);
    await openK1FromVisibleSidebar(page);
    await expect(page.getByText("三层去重命中列表", { exact: true })).toBeVisible();
    await expect(page.getByText(/数据加载失败|UNKNOWN_ERROR|Handler dispatch failed/)).toHaveCount(0);
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "03-refresh-relogin-server-state.png"),
      fullPage: true,
    });
  });

  expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
});

async function loginFromVisibleEntry(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  await expect(username).toBeVisible({ timeout: 15_000 });
  await username.fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  const response = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/admin/auth/login") && candidate.request().method() === "POST");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openK1FromVisibleSidebar(page: Page) {
  const group = page.getByRole("button", { name: /风控.*K|K.*风控/ }).first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  const link = page.locator('a[href="/risk/multi-account"]').first();
  await expect(link, "首次用户必须从可见侧栏找到 K1").toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/risk\/multi-account$/);
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}
