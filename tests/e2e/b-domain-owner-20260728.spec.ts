import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const TOTP_SECRET = process.env.ADMIN_E2E_TOTP_SECRET?.trim();
const TOTP_COUNTER_OFFSET = Number(process.env.B_TOTP_COUNTER_OFFSET ?? "-1");
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

if (!Number.isInteger(TOTP_COUNTER_OFFSET) || TOTP_COUNTER_OFFSET < -2 || TOTP_COUNTER_OFFSET > 2) {
  throw new Error("B_TOTP_COUNTER_OFFSET_MUST_BE_AN_INTEGER_BETWEEN_-2_AND_2");
}

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

test("B5 SSE 首次进入、刷新、重登及断线降级均保留权威边界", async ({ page }) => {
  test.setTimeout(240_000);
  const streamPath = "/api/admin/risk/radar/stream";
  const streamStatuses: Array<{ phase: string; status: number }> = [];
  const waitForStream = (phase: string) => page.waitForResponse(
    (candidate) => new URL(candidate.url()).pathname === streamPath
      && candidate.request().method() === "GET",
  ).then((response) => {
    streamStatuses.push({ phase, status: response.status() });
    return response;
  });

  await login(page);
  let stream = waitForStream("visible-entry");
  await openFromSidebar(page, MODULES[4]);
  expect((await stream).status()).toBe(200);
  await expect(page.getByText("挤兑预警", { exact: true })).toBeVisible();

  stream = waitForStream("refresh");
  await page.reload({ waitUntil: "domcontentloaded" });
  expect((await stream).status()).toBe(200);
  await expect(page.getByText("挤兑预警", { exact: true })).toBeVisible();

  await logout(page);
  await login(page);
  stream = waitForStream("relogin");
  await openFromSidebar(page, MODULES[4]);
  expect((await stream).status()).toBe(200);
  await expect(page.getByText("挤兑预警", { exact: true })).toBeVisible();

  const context = page.context();
  await context.route("**/api/admin/risk/radar/stream", (route) => route.abort("connectionfailed"));
  const failedStream = page.waitForEvent(
    "requestfailed",
    (request) => new URL(request.url()).pathname === streamPath,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const failedRequest = await failedStream;
  await expect(page.getByRole("status")).toContainText("实时通道正在重连");
  await expect(page.getByText("挤兑预警", { exact: true })).toBeVisible();
  await context.unroute("**/api/admin/risk/radar/stream");

  fs.writeFileSync(
    path.join(EVIDENCE_ROOT, "B5-sse-authority-boundary.json"),
    `${JSON.stringify({
      streamStatuses,
      disconnect: {
        url: failedRequest.url(),
        failure: failedRequest.failure()?.errorText || "requestfailed",
        fallback: "authoritative GET snapshot retained with visible reconnect warning",
      },
    }, null, 2)}\n`,
  );
});

test("B5 SSE 无菜单角色的快照与流接口都严格 403", async ({ page }) => {
  test.skip(
    process.env.B_EXPECT_B5_STREAM_FORBIDDEN !== "1",
    "This boundary carrier runs only with the isolated no-menu account.",
  );
  await login(page);
  const snapshot = await page.request.get("/api/admin/risk/radar");
  const stream = await page.request.get("/api/admin/risk/radar/stream");
  expect(snapshot.status()).toBe(403);
  expect(stream.status()).toBe(403);
  fs.writeFileSync(
    path.join(EVIDENCE_ROOT, "B5-sse-forbidden-boundary.json"),
    `${JSON.stringify({
      role: "isolated no-menu/no-authority acceptance account",
      snapshotStatus: snapshot.status(),
      streamStatus: stream.status(),
    }, null, 2)}\n`,
  );
});

test("B1 在真实 0% 覆盖率基线显示红线告警且仅给出失败关闭建议", async ({ page }) => {
  await login(page);
  await openFromSidebar(page, MODULES[0]);
  const payload = await apiJson(page, "/api/admin/treasury/b-domain");
  const snapshot = object(object(payload.data).dualLedger).snapshot as Record<string, unknown>;

  expect(number(snapshot.reserveUsd)).toBe(0);
  expect(number(snapshot.liabilitiesUsd)).toBeGreaterThan(0);
  expect(number(snapshot.coverageRatio)).toBe(0);
  await expect(page.getByText("已跌破红线", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("立即冻结放大流出", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("不自动执行", { exact: false }).first()).toBeVisible();

  fs.writeFileSync(path.join(EVIDENCE_ROOT, "b1-zero-coverage-fail-closed.json"), JSON.stringify({
    reserveUsd: number(snapshot.reserveUsd),
    liabilitiesUsd: number(snapshot.liabilitiesUsd),
    coverageRatio: number(snapshot.coverageRatio),
    ui: "已跌破红线；仅显示建议，未触发任何共享闸或资金写入",
  }, null, 2));
});

test("B1/B2/B5 资金事实及 B4/H1、B5/J1 跨域快照同源", async ({ page }) => {
  test.skip(
    process.env.B_EXPECT_CROSS_DOMAIN_CHECKER !== "1",
    "This contract carrier runs only with the isolated B/H1/J1 cross-domain checker.",
  );
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
    "/api/admin/risk/radar/stream",
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
  const session = await page.request.get("/api/admin/auth/session");
  expect(session.status()).toBe(200);
  const sessionBody = await session.json() as { data?: { session?: { authorities?: unknown } } };
  const authorities = Array.isArray(sessionBody.data?.session?.authorities)
    ? sessionBody.data.session.authorities.map(String)
    : [];
  const canWriteB5Threshold = authorities.includes("overview_b5_threshold_write");
  const invalidThreshold = await page.request.post("/api/admin/risk/bankrun-thresholds/preview", {
    data: { yellowPct: 40, redPct: 20, expectedVersion: 0 },
  });
  // 无写权限身份必须先被 RBAC 拒绝；拥有 B5 阈值写权限的 maker 才进入载荷校验。
  if (canWriteB5Threshold) expect([400, 422]).toContain(invalidThreshold.status());
  else expect(invalidThreshold.status()).toBe(403);
});

test("B1-B5 对畸形 200、500 与网络超时全部失败关闭", async ({ page }) => {
  await login(page);
  const cases = [
    { path: "/overview/dual-ledger", route: "**/api/admin/treasury/b-domain", title: "B1 双账本" },
    { path: "/overview/liquidity", route: "**/api/admin/treasury/reserve", title: "服务端响应异常" },
    { path: "/overview/funnel", route: "**/api/admin/funnel?*", title: "B3 转化漏斗" },
    { path: "/overview/rhythm", route: "**/api/admin/phase/overview?*", title: "B4 节奏状态加载失败" },
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

  const context = page.context();
  await context.route("**/api/admin/risk/radar/stream", (route) => route.abort("connectionfailed"));
  await context.route("**/api/admin/risk/radar", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, message: "success", data: { malformed: true } }),
  }));
  await page.goto("/overview/risk-radar", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("B5 风险雷达加载失败", { exact: false })).toBeVisible();
  await expect(page.getByText("挤兑预警", { exact: true })).toHaveCount(0);
  await context.unroute("**/api/admin/risk/radar");

  await context.route("**/api/admin/risk/radar", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ code: 500, message: "B5_INJECTED_FAILURE", data: null }),
  }));
  await page.goto("/overview/risk-radar", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("B5 风险雷达加载失败", { exact: false })).toBeVisible();
  await expect(page.getByText("挤兑预警", { exact: true })).toHaveCount(0);
  await context.unroute("**/api/admin/risk/radar");
  await context.unroute("**/api/admin/risk/radar/stream");
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" }).catch((error: unknown) => {
    if (!(error instanceof Error) || !error.message.includes("is interrupted by another navigation")) throw error;
  });
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
  if (!(await shell.isVisible({ timeout: 1_000 }).catch(() => false))) {
    if (!TOTP_SECRET) throw new Error("ADMIN_E2E_TOTP_SECRET is required when the selected acceptance fixture requires MFA");
    const otp = page.getByLabel("一次性验证码");
    await expect(otp).toBeVisible({ timeout: 15_000 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await otp.fill(await freshTotp(TOTP_SECRET));
      const verification = page.waitForResponse(
        (candidate) => candidate.url().endsWith("/api/admin/auth/mfa/verify") && candidate.request().method() === "POST",
      );
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
      if ((await verification).status() === 200) break;
      if (attempt === 1) throw new Error("MFA verification did not enter the console");
    }
  }
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + TOTP_COUNTER_OFFSET));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  const currentStep = Math.floor(Date.now() / 30_000);
  const millisecondsRemaining = 30_000 - (Date.now() % 30_000);
  if (lastTotpStep < 0 || currentStep <= lastTotpStep || millisecondsRemaining <= 5_000) {
    await new Promise<void>((resolve) => setTimeout(resolve, millisecondsRemaining + 250));
  }
  lastTotpStep = Math.floor(Date.now() / 30_000);
  return currentTotp(secret);
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
