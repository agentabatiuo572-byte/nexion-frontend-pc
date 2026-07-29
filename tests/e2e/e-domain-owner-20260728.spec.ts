import { expect, request, test, type Page, type Response } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  parseE4OrderPage,
  parseE5DatacenterRows,
  parseE5DevicePage,
  parseE5Overview,
  parseE6ComputeConfig,
} from "../../lib/admin/e456-overview-contract";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const EVIDENCE_DIR =
  process.env.E_OWNER_EVIDENCE_DIR
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/E/owner";

const MODULES = [
  { id: "E1", path: "/devices/pricing", title: "商品目录 & 上架门" },
  { id: "E4", path: "/devices/orders", title: "订单状态机" },
  { id: "E5", path: "/devices/ops", title: "设备运维" },
  { id: "E6", path: "/devices/compute-config", title: "算力与设备配置" },
] as const;

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("E1/E4/E5/E6 首次用户从可见侧栏完成权威读取、空态、刷新和重登", async ({ page }) => {
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

  await openModule(page, "E1", "/devices/pricing");
  await expectE1Healthy(page);
  const skuSearch = page.getByRole("textbox", { name: "搜索 SKU" });
  await skuSearch.fill(`owner-no-result-${Date.now()}`);
  await expect(page.getByText("没有符合筛选条件的 SKU，请清除筛选或换一个关键词。")).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page.getByText(/显示 \d+ \/ \d+ 个 SKU/)).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-e1-canonical-and-empty.png`, fullPage: true });

  await openModule(page, "E4", "/devices/orders");
  await expectE4Healthy(page);
  const orderSearch = page.getByRole("textbox", { name: "搜索订单" });
  await orderSearch.fill(`owner-no-order-${Date.now()}`);
  await expect(page.getByText(/后端暂无订单记录|当前状态无匹配订单/)).toBeVisible();
  await orderSearch.fill("");
  await expectE4Healthy(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-e4-canonical-and-empty.png`, fullPage: true });

  await openModule(page, "E5", "/devices/ops");
  await expectE5Healthy(page);
  const deviceSearch = page.getByRole("textbox", { name: "搜索用户设备" });
  await deviceSearch.fill(`owner-no-device-${Date.now()}`);
  await expect(page.getByText("当前筛选无设备数据", { exact: true })).toBeVisible();
  await deviceSearch.fill("");
  await expectE5Healthy(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/03-e5-canonical-and-empty.png`, fullPage: true });

  await openModule(page, "E6", "/devices/compute-config");
  await expectE6Healthy(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/04-e6-canonical.png`, fullPage: true });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectE6Healthy(page);
  await logoutFromVisibleControl(page);
  await loginFromVisibleEntry(page);
  for (const module of MODULES) {
    await openModule(page, module.id, module.path);
    await expect(page.getByText(module.title, { exact: false }).first()).toBeVisible();
  }
  await page.screenshot({ path: `${EVIDENCE_DIR}/05-refresh-relogin-all-e.png`, fullPage: true });

  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});

test("E1 畸形 200 失败关闭、隐藏写入口，并可由真实请求恢复", async ({ page }) => {
  await loginFromVisibleEntry(page);

  await page.route(/\/api\/admin\/e1\/skus(?:\?|$)/, (route) => malformed(route));
  await openModule(page, "E1", "/devices/pricing");
  await expect(page.locator('div[role="alert"]').filter({ hasText: "E1 后端数据读取失败" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新加载 E1 数据" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 新增 SKU" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ 新增阶段" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ 新增上架门" })).toHaveCount(0);
  await page.unroute(/\/api\/admin\/e1\/skus(?:\?|$)/);
  await page.getByRole("button", { name: "重新加载 E1 数据" }).click();
  await expectE1Healthy(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/06-e1-malformed-recovered.png`, fullPage: true });
});

test("E4 畸形 200 失败关闭，并可由真实请求恢复", async ({ page }) => {
  await loginFromVisibleEntry(page);
  await page.route(/\/api\/admin\/devices\/orders(?:\?|$)/, (route) => malformed(route));
  await openModule(page, "E4", "/devices/orders");
  await expect(page.getByText(/E4 (同步失败|订单接口读取失败)/).first()).toBeVisible();
  await page.unroute(/\/api\/admin\/devices\/orders(?:\?|$)/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectE4Healthy(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/07-e4-malformed-recovered.png`, fullPage: true });
});

test("E5 畸形 200 失败关闭，并可由真实请求恢复", async ({ page }) => {
  await loginFromVisibleEntry(page);
  await page.route("**/api/admin/devices/overview", (route) => malformed(route));
  await openModule(page, "E5", "/devices/ops");
  await expect(page.locator("body")).toContainText(/E5 .*失败|数据读取失败|设备库存读取异常|重新加载/);
  await page.unroute("**/api/admin/devices/overview");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectE5Healthy(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/08-e5-malformed-recovered.png`, fullPage: true });
});

test("E6 畸形 200 失败关闭，并可由真实请求恢复", async ({ page }) => {
  await loginFromVisibleEntry(page);
  await page.route("**/api/admin/devices/compute-config", (route) => malformed(route));
  await openModule(page, "E6", "/devices/compute-config");
  await expect(page.getByText(/E6 配置读取失败/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible();
  await page.unroute("**/api/admin/devices/compute-config");
  await page.getByRole("button", { name: "重新加载" }).click();
  await expectE6Healthy(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/09-e6-malformed-recovered.png`, fullPage: true });
});

test("E1/E4/E5/E6 接口来源、匿名边界及无副作用拒绝分支", async ({ page, baseURL }) => {
  await loginFromVisibleEntry(page);

  const e1 = await apiJson(page, "/api/admin/e1/skus?pageNum=1&pageSize=100");
  expect(e1.data.records).toBeInstanceOf(Array);
  expect(e1.data.records.length).toBeGreaterThan(0);
  const e1Gates = await apiJson(page, "/api/admin/e1/generation-gates");
  expect(e1Gates.data.sources).toEqual(expect.arrayContaining([
    expect.stringContaining("nx_admin_device_generation_gate"),
  ]));

  const e4 = await apiJson(page, "/api/admin/devices/orders?pageNum=1&pageSize=10");
  parseE4OrderPage(e4.data);
  expect(e4.data.records).toBeInstanceOf(Array);

  const e5Devices = await apiJson(page, "/api/admin/devices?pageNum=1&pageSize=10");
  parseE5DevicePage(e5Devices.data);
  const e5 = await apiJson(page, "/api/admin/devices/overview");
  parseE5Overview(e5.data);
  expect(e5.data).toEqual(expect.objectContaining({
    totalDevices: expect.any(Number),
    datacenters: expect.any(Array),
  }));
  const e5Datacenters = await apiJson(page, "/api/admin/devices/datacenters");
  parseE5DatacenterRows(e5Datacenters.data);
  expect(e5Datacenters.data).toBeInstanceOf(Array);

  const e6 = await apiJson(page, "/api/admin/devices/compute-config");
  parseE6ComputeConfig(e6.data);
  expect(e6.data.sources).toEqual(expect.arrayContaining([
    expect.stringContaining("nx_config_item"),
  ]));
  expect(e6.data.gpuTiers).toHaveLength(6);

  const missingIdempotency = await page.request.patch("/api/admin/devices/compute-config/params/E.compute.h5BaseFactor", {
    data: { value: "0.6", reason: "E域验收缺少幂等键必须零副作用拒绝", operator: USERNAME },
  });
  expect([409, 422]).toContain(missingIdempotency.status());

  const invalidE3Key = await page.request.patch("/api/admin/devices/e3/config", {
    headers: { "Idempotency-Key": `e-owner-invalid-${Date.now()}` },
    data: {
      key: "E.tradein.ownerInvalid",
      value: "1",
      reason: "E域验收非法参数必须零副作用拒绝",
      operator: USERNAME,
    },
  });
  expect([400, 422]).toContain(invalidE3Key.status());

  const anonymous = await request.newContext({ baseURL });
  for (const path of [
    "/api/admin/e1/skus?pageNum=1&pageSize=1",
    "/api/admin/config/task-pricing",
    "/api/admin/devices/e3/overview",
    "/api/admin/devices/orders?pageNum=1&pageSize=1",
    "/api/admin/devices/overview",
    "/api/admin/devices/compute-config",
  ]) {
    expect((await anonymous.get(path)).status(), `${path} 匿名读取必须拒绝`).toBe(401);
  }
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
  await username.fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openModule(page: Page, id: string, path: string) {
  const group = page.getByRole("button", { name: /设备与商城\s+E|E\s+设备与商城/ }).first();
  if (
    await group.isVisible({ timeout: 5_000 }).catch(() => false)
    && await group.getAttribute("aria-expanded") !== "true"
  ) {
    await group.click();
  }
  const link = page.locator(`a[href="${path}"]`).first();
  await expect(link, `${id} 必须从可见侧栏进入`).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(path)}$`));
}

async function expectE1Healthy(page: Page) {
  await expect(page.getByText("阶段配置", { exact: true })).toBeVisible();
  await expect(page.getByText("分批上架发布时点", { exact: true })).toBeVisible();
  await expect(page.getByText(/显示 \d+ \/ \d+ 个 SKU/)).toBeVisible();
  await expect(page.locator('div[role="alert"]').filter({ hasText: "E1 后端数据读取失败" })).toHaveCount(0);
}

async function expectE4Healthy(page: Page) {
  await expect(page.getByText("订单状态机 · 流转图")).toBeVisible();
  await expect(page.getByText("订单队列", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/E4 (同步失败|订单接口读取失败)/);
}

async function expectE5Healthy(page: Page) {
  await expect(page.getByText("设备库存 & 激活")).toBeVisible();
  await expect(page.getByText("数据中心", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/E5 .*失败|BACKEND_UNAVAILABLE/);
}

async function expectE6Healthy(page: Page) {
  await expect(page.getByText("电脑显卡映射表", { exact: true })).toBeVisible();
  await expect(page.getByText("客户端下载配置", { exact: true })).toBeVisible();
  await expect(page.getByText("版本记录与回滚", { exact: true })).toBeVisible();
  await expect(page.getByText(/E6 配置读取失败/)).toHaveCount(0);
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

async function apiJson(page: Page, path: string) {
  const response = await page.request.get(path);
  expect(response.status(), path).toBe(200);
  const body = await response.json();
  expect(body.code, path).toBe(0);
  return body;
}

function malformed(route: Parameters<Parameters<Page["route"]>[1]>[0]) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: {} }),
  });
}

function collectServerError(response: Response, failures: string[]) {
  if (!response.url().includes("/api/admin/") || response.status() < 500) return;
  failures.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
