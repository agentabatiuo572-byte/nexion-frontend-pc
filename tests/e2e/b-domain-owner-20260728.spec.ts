import fs from "node:fs";
import path from "node:path";
import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const EVIDENCE_ROOT =
  process.env.B_OWNER_EVIDENCE_DIR
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/B/owner";

const MODULES = [
  { id: "B1", path: "/overview/dual-ledger", title: "双账本总览", response: "/api/admin/treasury/b-domain" },
  { id: "B2", path: "/overview/liquidity", title: "资金池水位", response: "/api/admin/treasury/reserve" },
  { id: "B3", path: "/overview/funnel", title: "转化漏斗", response: "/api/admin/funnel" },
  { id: "B4", path: "/overview/rhythm", title: "节奏状态", response: "/api/admin/phase/overview" },
  { id: "B5", path: "/overview/risk-radar", title: "风险雷达", response: "/api/admin/risk/radar" },
] as const;

const UNHEALTHY =
  /Cannot read properties|ReferenceError|TypeError|NaN|Infinity|mock 数据|localStorage|Handler dispatch failed|NoSuchMethodError|SQLSyntaxErrorException/i;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
});

test("B1-B5 从登录页和可见侧栏完成首轮、刷新、返回、退出重登", async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  let current = "登录";

  page.on("pageerror", (error) => pageErrors.push(`${current}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      consoleErrors.push(`${current}: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/admin/") && response.status() >= 500) {
      serverErrors.push(`${current}: ${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
    }
  });

  await login(page);
  for (const module of MODULES) {
    current = module.id;
    await openFromSidebar(page, module);
    await assertModuleHealthy(page, module);
    await page.screenshot({ path: path.join(EVIDENCE_ROOT, `${module.id}-visible-entry.png`), fullPage: true });
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertModuleHealthy(page, module);
  }

  current = "B5→B1 返回";
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/overview\/rhythm$/);
  await expect(page.getByRole("heading", { name: "节奏状态" })).toBeVisible();

  current = "退出重登";
  await logout(page);
  await login(page);
  for (const module of MODULES) {
    current = `${module.id} 重登`;
    await openFromSidebar(page, module);
    await assertModuleHealthy(page, module);
  }

  expect(pageErrors, "B1-B5 不应产生未处理页面异常").toEqual([]);
  expect(consoleErrors, "B1-B5 不应产生未处理控制台异常").toEqual([]);
  expect(serverErrors, "B1-B5 主流程不应返回 5xx").toEqual([]);
});

test("B1/B2/B5 资金事实及 B4/H1、B5/J1 跨域快照同源", async ({ page }) => {
  await login(page);
  const [b1, reserve, liabilities, b5, b4, h1, j1] = await Promise.all([
    apiJson(page, "/api/admin/treasury/b-domain"),
    apiJson(page, "/api/admin/treasury/reserve"),
    apiJson(page, "/api/admin/treasury/liabilities?breakdown=true"),
    apiJson(page, "/api/admin/risk/radar"),
    apiJson(page, "/api/admin/phase/overview?granularity=PHASE"),
    apiJson(page, "/api/admin/growth/phases"),
    apiJson(page, "/api/admin/emergency/kill-switches"),
  ]);

  const ledger = object(object(b1.data).dualLedger).snapshot as Record<string, unknown>;
  const reserveData = object(reserve.data);
  const liabilitiesData = object(liabilities.data);
  const radar = object(b5.data);
  const coverage = object(radar.coverage);
  expect(number(ledger.reserveUsd)).toBe(number(reserveData.reserveTotalUsdt));
  expect(number(ledger.liabilitiesUsd)).toBe(number(liabilitiesData.totalUsdt));
  expect(number(ledger.coverageRatio)).toBe(number(coverage.ratio));
  expect(number(coverage.reserveUsdt)).toBe(number(reserveData.reserveTotalUsdt));
  expect(number(coverage.liabilitiesUsdt)).toBe(number(liabilitiesData.totalUsdt));

  const b4Data = object(b4.data);
  const h1Data = object(h1.data);
  const b4Dials = array(b4Data.dials);
  const h1Current = array(h1Data.monthlyDials)
    .map(object)
    .find((row) => row.current === true)
    ?? array(h1Data.monthlyDials).map(object).find(
      (row) => Number(row.month) === Number(object(h1Data.rhythm).currentMonth),
    )
    ?? {};
  const h1Dials = Object.entries(object(h1Current.dials)).map(([key, value]) => ({ key, value }));
  // FEAT-WD02:withdrawPenaltyFeeRate 旋钮已随惩罚费模型下线 → 矩阵 8 → 7 项。
  expect(b4Dials).toHaveLength(7);
  expect(h1Dials.length).toBeGreaterThanOrEqual(7);
  expect(b4Dials.map((dial) => String(object(dial).key))).not.toContain("withdrawPenaltyFeeRate");
  for (const dial of b4Dials) {
    const row = object(dial);
    const canonical = h1Dials.map(object).find((candidate) => String(candidate.key) === String(row.key));
    expect(canonical, `H1 应包含 B4 dial ${String(row.key)}`).toBeTruthy();
    expect(normalizeDialValue(row.currentValue)).toBe(normalizeDialValue(canonical!.value));
  }

  const gates = array(radar.killSwitches).map(object);
  const j1Gates = array(object(j1.data).activeGates).map(object);
  expect(gates).toHaveLength(5);
  for (const gate of gates) {
    const canonical = j1Gates.find((candidate) => String(candidate.key) === String(gate.key));
    expect(canonical, `J1 应包含 B5 gate ${String(gate.key)}`).toBeTruthy();
    expect(Boolean(gate.enabled)).toBe(Boolean(canonical!.enabled));
  }

  fs.writeFileSync(
    path.join(EVIDENCE_ROOT, "cross-domain-authoritative-check.json"),
    JSON.stringify({
      reserveUsd: number(ledger.reserveUsd),
      liabilitiesUsd: number(ledger.liabilitiesUsd),
      coverageRatio: number(ledger.coverageRatio),
      b4DialCount: b4Dials.length,
      h1DialCount: h1Dials.length,
      b5GateCount: gates.length,
      j1GateCount: j1Gates.length,
    }, null, 2),
  );
});

test("B1-B5 匿名读取拒绝，非法路由和非法参数安全失败", async ({ baseURL, page }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL: baseURL || "http://127.0.0.1:3002" });
  for (const endpoint of [
    "/api/admin/treasury/b-domain",
    "/api/admin/treasury/reserve",
    "/api/admin/funnel",
    "/api/admin/phase/overview",
    "/api/admin/risk/radar",
  ]) {
    expect((await anonymous.get(endpoint)).status(), endpoint).toBe(401);
  }
  expect((await anonymous.get("/api/admin/funnel/not-allowed")).status()).toBe(404);
  expect((await anonymous.get("/api/admin/phase/not-allowed")).status()).toBe(404);
  await anonymous.dispose();

  await login(page);
  expect([400, 422]).toContain((await page.request.get("/api/admin/treasury/net-exposure?window=bad")).status());
  expect([400, 422]).toContain((await page.request.get("/api/admin/treasury/maturity-forecast?window=bad")).status());
  expect((await page.request.get("/api/admin/funnel?phase=P99")).status()).toBe(422);
  expect((await page.request.get("/api/admin/funnel?stage=future")).status()).toBe(404);
  expect([400, 422]).toContain((await page.request.get("/api/admin/phase/overview?granularity=DAY")).status());
  expect((await page.request.post("/api/admin/risk/bankrun-thresholds/preview", {
    data: { yellowPct: 40, redPct: 20, expectedVersion: 0 },
  })).status()).toBe(400);
});

test("B1-B5 对畸形 200、500 与网络超时全部失败关闭", async ({ page }) => {
  await login(page);
  const cases = [
    { path: "/overview/dual-ledger", route: "**/api/admin/treasury/b-domain", title: "B1 双账本" },
    { path: "/overview/liquidity", route: "**/api/admin/treasury/reserve", title: "服务端响应异常" },
    { path: "/overview/funnel", route: "**/api/admin/funnel?*", title: "B3 转化漏斗" },
    { path: "/overview/rhythm", route: "**/api/admin/phase/overview?*", title: "B4 节奏状态加载失败" },
    { path: "/overview/risk-radar", route: "**/api/admin/risk/radar", title: "B5 风险雷达" },
  ] as const;

  for (const scenario of cases) {
    await page.route(scenario.route, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, message: "success", data: { malformed: true } }),
    }));
    await page.goto(scenario.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(scenario.title, { exact: false }).first(), `${scenario.path} 畸形 200 应失败关闭`).toBeVisible();
    await expect(page.locator("body")).not.toContainText(UNHEALTHY);
    await page.unroute(scenario.route);
  }

  await page.route("**/api/admin/treasury/reserve", (route) => route.abort("timedout"));
  await page.goto("/overview/liquidity", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("服务端响应异常", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/真实可动用储备/)).toHaveCount(0);
  await page.unroute("**/api/admin/treasury/reserve");

  await page.route("**/api/admin/risk/radar", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ code: 500, message: "B5_INJECTED_FAILURE", data: null }),
  }));
  await page.goto("/overview/risk-radar", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("B5 风险雷达加载失败", { exact: false })).toBeVisible();
  await expect(page.getByText("挤兑预警", { exact: true })).toHaveCount(0);
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
  const response = page.waitForResponse(
    (candidate) => candidate.url().endsWith("/api/admin/auth/login") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await response).status()).toBe(200);
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page) {
  const direct = page.getByRole("button", { name: /^(退出登录|登出)$/ }).first();
  if (await direct.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await direct.click();
  } else {
    const account = page.locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]').first();
    if (await account.isVisible({ timeout: 3_000 }).catch(() => false)) await account.click();
    await page.getByText(/退出登录|登出/, { exact: true }).first().click();
  }
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

async function openFromSidebar(page: Page, module: typeof MODULES[number]) {
  const link = page.locator(`aside a[href="${module.path}"]`).first();
  if (!(await link.isVisible({ timeout: 1_000 }).catch(() => false))) {
    await page.getByRole("button", { name: /总览驾驶舱/ }).click();
  }
  await expect(link, `${module.id} 侧栏入口必须可见`).toBeVisible();
  const response = page.waitForResponse(
    (candidate) => new URL(candidate.url()).pathname === module.response && candidate.request().method() === "GET",
  );
  await link.click();
  expect((await response).status(), `${module.id} 权威读取`).toBe(200);
  await expect(page).toHaveURL(new RegExp(`${module.path}$`));
}

async function assertModuleHealthy(page: Page, module: typeof MODULES[number]) {
  await expect(page.getByRole("heading", { name: module.title })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("body")).not.toContainText(UNHEALTHY);
}

async function apiJson(page: Page, endpoint: string) {
  const response = await page.request.get(endpoint);
  expect(response.status(), endpoint).toBe(200);
  const payload = await response.json() as Record<string, unknown>;
  expect(payload.code, endpoint).toBe(0);
  expect(payload.data, endpoint).toBeTruthy();
  return payload;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function number(value: unknown): number {
  const parsed = Number(value);
  expect(Number.isFinite(parsed), `应为有限数值：${String(value)}`).toBeTruthy();
  return parsed;
}

function normalizeDialValue(value: unknown): string {
  if (value === true || ["true", "是", "开", "开启"].includes(String(value).toLowerCase())) return "true";
  if (value === false || ["false", "否", "关", "关闭"].includes(String(value).toLowerCase())) return "false";
  return String(value);
}
