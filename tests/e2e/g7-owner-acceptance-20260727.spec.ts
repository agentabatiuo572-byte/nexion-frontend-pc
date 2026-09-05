import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const EVIDENCE = path.resolve("docs", "验收报告", "PC全面测试-20260726", "G7-evidence");
const USERNAME = process.env.ADMIN_E2E_USERNAME || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());

async function loginFromVisibleEntry(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    const loginResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/admin/auth/login") && response.request().method() === "POST");
    await page.getByRole("button", { name: /继续|登录/ }).click();
    expect((await loginResponse).status()).toBe(200);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openG7FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /(金融产品\s*G|G\s*金融产品)/ }).first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  const link = page.locator('a[href="/finance-products/repurchase"]').first();
  await expect(link, "首次用户必须从可见侧边栏找到 G7").toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/finance-products\/repurchase$/);
  await expect(page.getByText("复投激励配置")).toBeVisible();
}

test("G7 首次用户真实浏览器 + 权限/错误/刷新重登 + 墨菲复验", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await test.step("未登录接口 fail-closed", async () => {
    const response = await page.request.get("/api/admin/market/nex/repurchase");
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 401, message: "ADMIN_AUTH_REQUIRED" });
  });

  await test.step("从登录和侧边栏可见入口进入 G7", async () => {
    await loginFromVisibleEntry(page);
    await openG7FromSidebar(page);
    await expect(page.getByText("真实复投单", { exact: true })).toBeVisible();
    await expect(page.getByText("G4 奖池容量", { exact: true })).toBeVisible();
    await expect(page.locator('main a[href="/growth/phase"]')).toBeVisible();
    await expect(page.getByText(/数据加载失败|UNKNOWN_ERROR|Handler dispatch failed/)).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCE, "01-g7-visible-entry.png"), fullPage: true });
  });

  await test.step("真实接口契约与未知状态 fail-closed", async () => {
    const overview = await page.request.get("/api/admin/market/nex/repurchase");
    expect(overview.status()).toBe(200);
    await expect(overview.json()).resolves.toMatchObject({
      code: 0,
      data: { serverCanonical: true },
    });
    const orders = await page.request.get("/api/admin/market/nex/repurchase/orders");
    expect(orders.status()).toBe(200);
    await expect(orders.json()).resolves.toMatchObject({
      code: 0,
      data: { serverCanonical: true },
    });
    const unknown = await page.request.get("/api/admin/market/nex/repurchase/orders?status=NOT_A_STATE");
    expect(unknown.status()).toBeGreaterThanOrEqual(400);
  });

  await test.step("同值配置复核不产生写请求", async () => {
    let writes = 0;
    const countWrite = (request: import("@playwright/test").Request) => {
      if (request.method() === "PUT" && request.url().includes("/api/admin/market/nex/repurchase/config/")) writes += 1;
    };
    page.on("request", countWrite);
    await page.getByRole("button", { name: "编辑 年化 APY" }).click();
    const current = await page.getByLabel("目标新值").getAttribute("placeholder");
    const value = current?.match(/当前\s*([^)]+)/)?.[1] ?? "";
    await page.getByLabel("目标新值").fill(value);
    await page.getByLabel(/操作理由/).fill("G7 墨菲复验同值提交应被前端拒绝");
    expect(writes).toBe(0);
    await page.getByRole("button", { name: "取消" }).click();
    expect(writes).toBe(0);
    page.off("request", countWrite);
  });

  await test.step("刷新与登出重登后仍由真实接口恢复", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("复投激励配置")).toBeVisible();
    await page.request.post("/api/admin/auth/logout");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    await loginFromVisibleEntry(page);
    await openG7FromSidebar(page);
    await expect(page.getByText("复投是原子组合")).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE, "02-g7-relogin.png"), fullPage: true });
  });

  expect(pageErrors, `page errors: ${pageErrors.join("\n")}`).toEqual([]);
  expect(consoleErrors.filter((entry) => !/favicon|webpack-hmr|status of 401 \(Unauthorized\)/i.test(entry)),
    `console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  await testInfo.attach("g7-runtime-errors", {
    body: JSON.stringify({ pageErrors, consoleErrors }, null, 2),
    contentType: "application/json",
  });
});
