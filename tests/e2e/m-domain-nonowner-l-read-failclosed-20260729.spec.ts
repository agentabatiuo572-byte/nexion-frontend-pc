import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "Admin@123456";
const FIXTURE_PATH = process.env.M_REVIEW_L_FIXTURE_PATH ?? process.env.M_PERMISSION_FIXTURE_PATH;
const fixtureValue = FIXTURE_PATH
  ? JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
      account?: FixtureAccount;
      checker?: FixtureAccount;
      accounts?: { checker?: FixtureAccount; m_checker?: FixtureAccount; maker?: FixtureAccount };
      finalAccounts?: { m_checker?: FixtureAccount };
    }
  : null;
const REVIEW_ACCOUNT = fixtureValue?.account
  ?? fixtureValue?.checker
  ?? fixtureValue?.accounts?.checker
  ?? fixtureValue?.accounts?.m_checker
  ?? fixtureValue?.finalAccounts?.m_checker
  ?? fixtureValue?.accounts?.maker
  ?? null;
const EVIDENCE_DIR = process.env.M_REVIEW_L_READ_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/M-review-L/read-failclosed";
const PC_BUILD_ID = process.env.M_REVIEW_L_PC_BUILD_ID ?? "";
const PC_BUILD_ID_PATH = path.resolve(process.env.M_REVIEW_L_PC_BUILD_ID_PATH?.trim() || ".next/BUILD_ID");
const PC_PID = Number(process.env.M_REVIEW_L_PC_PID ?? "0");
const BACKEND_JAR_PATH = process.env.M_REVIEW_L_BACKEND_JAR_PATH ?? "";
const BACKEND_JAR_SHA = (process.env.M_REVIEW_L_BACKEND_JAR_SHA ?? "").toUpperCase();
const BACKEND_PID = Number(process.env.M_REVIEW_L_BACKEND_PID ?? "0");
type FixtureAccount = { username: string; password: string; totpSecret: string };
const EXACT_M_AUTHORITIES = [
  "platform_a2_read",
  "service_m1_read", "service_m1_write",
  "service_m2_read", "service_m2_write",
  "service_m3_read", "service_m3_write", "service_m3_timeout_manage",
  "service_m4_read", "service_m4_write",
  "service_m5_read", "service_m5_write",
].sort();
const EXACT_M_MENU_CODES = ["A2", "M1", "M2", "M3", "M4", "M5"];

const MODULES = [
  { id: "M1", href: "/service/overview", ready: "SLA 监控" },
  { id: "M2", href: "/service/tickets", ready: "工单台" },
  { id: "M3", href: "/service/sessions", ready: "会话收件箱" },
  { id: "M4", href: "/service/kb-sla", ready: "Help/FAQ 内容管理" },
  { id: "M5", href: "/service/scripts", ready: "客服岗位与专属客服" },
] as const;

const businessMutations: string[] = [];
const pageErrors: string[] = [];
const checks: string[] = [];

test.describe.configure({ mode: "serial", timeout: 360_000 });

test.beforeAll(() => {
  expect(["localhost", "127.0.0.1", "::1"]).toContain(new URL(BASE_URL).hostname);
  expect(new URL(BASE_URL).port || "80").toBe("3002");
  expect(process.env.M_REVIEW_L_MFA_BYPASS).toBe("false");
  expect(REVIEW_ACCOUNT, "M_REVIEW_L_FIXTURE_PATH is required").toBeTruthy();
  expect(PC_BUILD_ID, "M_REVIEW_L_PC_BUILD_ID is required").not.toBe("");
  expect(PC_PID, "M_REVIEW_L_PC_PID must be positive").toBeGreaterThan(0);
  expect(() => process.kill(PC_PID, 0), "locked final2 PC process must be alive").not.toThrow();
  expect(BACKEND_JAR_PATH, "M_REVIEW_L_BACKEND_JAR_PATH is required").not.toBe("");
  expect(BACKEND_JAR_SHA, "M_REVIEW_L_BACKEND_JAR_SHA must be SHA-256").toMatch(/^[0-9A-F]{64}$/);
  expect(BACKEND_PID, "M_REVIEW_L_BACKEND_PID must be positive").toBeGreaterThan(0);
  expect(() => process.kill(BACKEND_PID, 0), "locked final2 backend process must be alive").not.toThrow();
  expect(readFileSync(PC_BUILD_ID_PATH, "utf8").trim()).toBe(PC_BUILD_ID);
  expect(sha256File(BACKEND_JAR_PATH)).toBe(BACKEND_JAR_SHA);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/admin/content/") && request.method() !== "GET") {
      businessMutations.push(`${request.method()} ${pathname}`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
});

test("M1-M5 全新 Chromium 从可见侧栏完成只读、返回、刷新与退出重登", async ({ page }) => {
  await login(page);
  await assertMOwnerSession(page);
  const observedReads = new Set<string>();
  page.on("response", (response) => {
    const request = response.request();
    const pathname = new URL(response.url()).pathname;
    if (request.method() === "GET" && pathname.startsWith("/api/admin/content/") && response.status() < 400) {
      observedReads.add(pathname);
    }
  });

  for (const module of MODULES) {
    await openVisibleModule(page, module.href);
    await expect(page.getByText(module.ready, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".mdom")).toBeVisible();
    await expect(page.getByText(/mock|localStorage/i)).toHaveCount(0);
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, `read-${module.id.toLowerCase()}.png`),
      fullPage: true,
    });
    checks.push(`${module.id}-visible-entry`);
  }

  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/service\/kb-sla(?:\?.*)?$/);
  await expect(page.getByText("Help/FAQ 内容管理", { exact: true })).toBeVisible({ timeout: 30_000 });
  checks.push("browser-back-preserves-module");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Help/FAQ 内容管理", { exact: true })).toBeVisible({ timeout: 30_000 });
  checks.push("refresh-authoritative-read");

  await logout(page);
  await login(page);
  await assertMOwnerSession(page);
  for (const module of MODULES) {
    await openVisibleModule(page, module.href);
    await expect(page.getByText(module.ready, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  }
  checks.push("logout-relogin-all-five");

  expect([...observedReads]).toEqual(expect.arrayContaining([
    "/api/admin/content/tickets",
    "/api/admin/content/tickets/load-config",
    "/api/admin/content/conversations",
    "/api/admin/content/support-agents",
    "/api/admin/content/knowledge/overview",
    "/api/admin/content/session-templates/overview",
  ]));
  expect(businessMutations).toEqual([]);
  expect(pageErrors).toEqual([]);
  await logout(page);
});

test("M1-M5 对 401/403/404/409/422/500、超时、畸形 200 与读取结果未知全部失败关闭并恢复", async ({ page }) => {
  await login(page);
  await assertMOwnerSession(page);

  await openVisibleModule(page, "/service/overview");
  await faultAndRecover(page, {
    pattern: "**/api/admin/content/tickets/load-config",
    targetPath: "/api/admin/content/tickets/load-config",
    moduleHref: "/service/overview",
    fault: { kind: "status", status: 500 },
    failClosed: async () => {
      await expect(page.getByRole("button", { name: "调整负载", exact: true })).toBeDisabled();
      await expect(page.getByText(/负载策略暂不可用/).first()).toBeVisible();
    },
    recoveredText: "坐席负载",
    label: "M1-500",
  });

  for (const status of [401, 403, 404, 409, 422] as const) {
    await faultAndRecover(page, {
      pattern: "**/api/admin/content/tickets?*",
      targetPath: "/api/admin/content/tickets",
      moduleHref: "/service/tickets",
      fault: { kind: "status", status },
      failClosed: async () => {
        await expect(page.getByText(/工单数据暂时无法同步/)).toBeVisible();
        await expect(page.locator('[data-proof="support-ticket-create"]')).toHaveCount(0);
      },
      recoveredText: "工单台",
      label: `M2-${status}`,
    });
  }

  await faultAndRecover(page, {
    pattern: "**/api/admin/content/conversations?*",
    targetPath: "/api/admin/content/conversations",
    moduleHref: "/service/sessions",
    fault: { kind: "status", status: 500 },
    failClosed: async () => {
      await expect(page.getByText(/会话数据暂时无法同步/)).toBeVisible();
      await expect(page.locator('[data-proof="session-initiate"]')).toHaveCount(0);
    },
    recoveredText: "会话收件箱",
    label: "M3-500",
  });

  await faultAndRecover(page, {
    pattern: "**/api/admin/content/conversations?*",
    targetPath: "/api/admin/content/conversations",
    moduleHref: "/service/sessions",
    fault: { kind: "malformed" },
    failClosed: async () => {
      await expect(page.getByText(/会话数据暂时无法同步/)).toBeVisible();
      await expect(page.locator('[data-proof="session-initiate"]')).toHaveCount(0);
    },
    recoveredText: "会话收件箱",
    label: "M3-malformed-200",
  });

  await timeoutAndRecover(page);

  await faultAndRecover(page, {
    pattern: "**/api/admin/content/knowledge/overview",
    targetPath: "/api/admin/content/knowledge/overview",
    moduleHref: "/service/kb-sla",
    fault: { kind: "malformed" },
    failClosed: async () => {
      await expect(page.getByText(/知识库后端当前不可用/)).toBeVisible();
      await expect(page.getByRole("button", { name: "新增文章", exact: true })).toHaveCount(0);
    },
    recoveredText: "Help/FAQ 内容管理",
    label: "M4-malformed-200",
  });

  await faultAndRecover(page, {
    pattern: "**/api/admin/content/session-templates/overview",
    targetPath: "/api/admin/content/session-templates/overview",
    moduleHref: "/service/scripts",
    fault: { kind: "status", status: 500 },
    failClosed: async () => {
      await expect(page.getByText(/话术与模板后端当前不可用/)).toBeVisible();
      await expect(page.locator('[data-proof="session-script-new"]')).toHaveCount(0);
      await expect(page.locator('[data-proof="session-tpl-new"]')).toHaveCount(0);
    },
    recoveredText: "客服岗位与专属客服",
    label: "M5-500",
  });

  await readOutcomeUnknownAndRecover(page);
  expect(businessMutations).toEqual([]);
  await logout(page);
  writeFileSync(path.join(EVIDENCE_DIR, "runtime-result.json"), JSON.stringify({
    candidate: {
      pcBuildId: PC_BUILD_ID,
      pcPid: PC_PID,
      jarSha256: BACKEND_JAR_SHA,
      backendPid: BACKEND_PID,
    },
    checks,
    businessMutations,
    pageErrors,
  }, null, 2));
});

test("M-only reviewer 即使具备 M1/M5 write authority 也必须被客服主管业务门拒绝", async ({ page }) => {
  await login(page);
  await assertMOwnerSession(page);
  const prefix = `NONOWNER-L-M-${Date.now()}`;

  await openVisibleModule(page, "/service/scripts");
  for (const proof of ["session-script-new", "session-tpl-new", "session-policy-enabled", "session-policy-delay", "session-policy-cooldown", "session-policy-max", "session-policy-audience"]) {
    await expect(page.locator(`[data-proof="${proof}"]`)).toHaveCount(0);
  }
  await expect(page.locator('[data-proof^="session-cat-toggle-"]')).toHaveCount(0);
  await expect(page.locator('[data-proof^="session-script-publish-"]')).toHaveCount(0);
  await expect(page.locator('[data-proof^="session-tpl-publish-"]')).toHaveCount(0);

  const loadBeforeResponse = await page.request.get("/api/admin/content/tickets/load-config");
  expect(loadBeforeResponse.status()).toBe(200);
  const loadBefore = await okData<{
    loadConfig?: Record<string, unknown> & { version?: number };
    agentState?: Record<string, unknown>;
  }>(loadBeforeResponse);
  expect(loadBefore.loadConfig).toBeTruthy();
  const m1Denied = await page.request.patch("/api/admin/content/tickets/load-config", {
    headers: { "Idempotency-Key": `${prefix}-M1-BUSINESS-GATE` },
    data: {
      ...loadBefore.loadConfig,
      agentState: loadBefore.agentState ?? {},
      expectedVersion: loadBefore.loadConfig!.version,
      reason: `${prefix} 非客服主管不得调整 M1 负载`,
    },
  });
  expect(m1Denied.status()).toBe(403);
  expect((await m1Denied.json() as { message?: string }).message).toBe("SUPPORT_LOAD_MANAGEMENT_FORBIDDEN");
  const loadAfter = await okData<{
    loadConfig?: Record<string, unknown>;
    agentState?: Record<string, unknown>;
  }>(await page.request.get("/api/admin/content/tickets/load-config"));
  expect(loadAfter.loadConfig).toEqual(loadBefore.loadConfig);

  const templatesBeforeResponse = await page.request.get("/api/admin/content/session-templates/overview");
  expect(templatesBeforeResponse.status()).toBe(200);
  const templatesBefore = await okData<{
    categories?: Array<{ type?: string; enabled?: boolean }>;
  }>(templatesBeforeResponse);
  const advisor = templatesBefore.categories?.find((category) => category.type === "advisor");
  expect(advisor).toBeTruthy();
  const m5Denied = await page.request.patch("/api/admin/content/session-templates/categories/advisor", {
    headers: { "Idempotency-Key": `${prefix}-M5-BUSINESS-GATE` },
    data: {
      enabled: advisor!.enabled,
      expectedEnabled: advisor!.enabled,
      reason: `${prefix} 非客服主管不得调整 M5 会话类别`,
    },
  });
  expect(m5Denied.status()).toBe(403);
  expect((await m5Denied.json() as { message?: string }).message).toBe("M5_CONFIGURATION_MANAGEMENT_FORBIDDEN");
  const templatesAfter = await okData<{
    categories?: Array<{ type?: string; enabled?: boolean }>;
  }>(await page.request.get("/api/admin/content/session-templates/overview"));
  const advisorAfter = templatesAfter.categories?.find((category) => category.type === "advisor");
  expect(advisorAfter).toEqual(advisor);
  await logout(page);

  writeFileSync(path.join(EVIDENCE_DIR, "business-gate-result.json"), JSON.stringify({
    prefix,
    candidate: {
      pcBuildId: PC_BUILD_ID,
      pcPid: PC_PID,
      jarSha256: BACKEND_JAR_SHA,
      backendPid: BACKEND_PID,
    },
    reviewer: REVIEW_ACCOUNT?.username,
    m1: {
      status: m1Denied.status(),
      beforeSha256: sha256Json(loadBefore.loadConfig),
      afterSha256: sha256Json(loadAfter.loadConfig),
    },
    m5: {
      status: m5Denied.status(),
      beforeSha256: sha256Json(advisor),
      afterSha256: sha256Json(advisorAfter),
    },
    successfulBusinessWrites: 0,
    immutableRejectedAuditExpected: true,
  }, null, 2));
});

type Fault = { kind: "status"; status: number } | { kind: "malformed" };

async function faultAndRecover(
  page: Page,
  input: {
    pattern: string;
    targetPath: string;
    moduleHref: string;
    fault: Fault;
    failClosed: () => Promise<void>;
    recoveredText: string;
    label: string;
  },
) {
  let injected = false;
  let markIntercepted!: () => void;
  const intercepted = new Promise<void>((resolve) => { markIntercepted = resolve; });
  const handler = async (route: Route) => {
    const request = route.request();
    if (request.method() !== "GET" || new URL(request.url()).pathname !== input.targetPath) {
      await route.continue();
      return;
    }
    if (!injected) {
      injected = true;
      markIntercepted();
    }
    if (input.fault.kind === "malformed") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, data: { malformed: true } }),
      });
      return;
    }
    await route.fulfill({
      status: input.fault.status,
      contentType: "application/json",
      body: JSON.stringify({ code: input.fault.status, message: `M_REVIEW_L_${input.fault.status}` }),
    });
  };
  await page.route(input.pattern, handler);
  try {
    if (new URL(page.url()).pathname === input.moduleHref) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(".mdom")).toBeVisible({ timeout: 30_000 });
    } else {
      await openVisibleModule(page, input.moduleHref);
    }
    await intercepted;
    expect(injected, `${input.label} must intercept the authoritative request`).toBe(true);
    await input.failClosed();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${input.label}.png`), fullPage: true });
    checks.push(`${input.label}-fails-closed`);
  } finally {
    await page.unroute(input.pattern, handler);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(input.recoveredText, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  checks.push(`${input.label}-recovered`);
}

async function timeoutAndRecover(page: Page) {
  let release!: () => void;
  let intercepted!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const seen = new Promise<void>((resolve) => { intercepted = resolve; });
  const handler = async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    intercepted();
    await held;
    await route.abort("timedout").catch(() => undefined);
  };
  await page.route("**/api/admin/content/conversations?*", handler);
  try {
    const navigation = page.reload({ waitUntil: "domcontentloaded" });
    await seen;
    await navigation;
    await expect(page.locator('[data-proof="session-initiate"]')).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "M3-timeout-fails-closed.png"), fullPage: true });
    checks.push("M3-timeout-fails-closed");
    release();
    await expect(page.getByText(/会话数据暂时无法同步/)).toBeVisible({ timeout: 30_000 });
  } finally {
    release?.();
    await page.unroute("**/api/admin/content/conversations?*", handler);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("会话收件箱", { exact: true })).toBeVisible({ timeout: 30_000 });
  checks.push("M3-timeout-recovered");
}

async function readOutcomeUnknownAndRecover(page: Page) {
  let injected = false;
  let markIntercepted!: () => void;
  const intercepted = new Promise<void>((resolve) => { markIntercepted = resolve; });
  const pattern = "**/api/admin/content/session-templates/overview";
  const handler = async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    if (!injected) {
      injected = true;
      markIntercepted();
    }
    const upstream = await route.fetch();
    expect(upstream.ok()).toBe(true);
    await route.abort("connectionfailed");
  };
  await page.route(pattern, handler);
  try {
    if (new URL(page.url()).pathname === "/service/scripts") {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(".mdom")).toBeVisible({ timeout: 30_000 });
    } else {
      await openVisibleModule(page, "/service/scripts");
    }
    await intercepted;
    expect(injected).toBe(true);
    await expect(page.getByText(/话术与模板后端当前不可用/)).toBeVisible();
    await expect(page.locator('[data-proof="session-script-new"]')).toHaveCount(0);
    checks.push("M5-read-result-unknown-fails-closed");
  } finally {
    await page.unroute(pattern, handler);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("客服岗位与专属客服", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-proof="session-script-new"]')).toHaveCount(0);
  checks.push("M5-read-result-unknown-recovered");
}

async function login(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 1_500 }).catch(() => false)) await logout(page);
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(REVIEW_ACCOUNT?.username ?? USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(REVIEW_ACCOUNT?.password ?? PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  if (REVIEW_ACCOUNT) {
    const otp = page.getByLabel("一次性验证码");
    await expect.poll(async () => (await otp.isVisible()) || (await page.locator("aside").isVisible()), {
      timeout: 10_000,
    }).toBe(true);
    if (await otp.isVisible()) {
      await otp.fill(await freshTotp(REVIEW_ACCOUNT.totpSecret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function assertMOwnerSession(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    data?: {
      session?: {
        authorities?: string[];
        menuCodes?: string[];
        effectiveMenus?: Array<string | { menuCode?: string }>;
      };
    };
  };
  const authorities = [...(payload.data?.session?.authorities ?? [])].sort();
  expect(authorities, "M 非 Owner 必须使用精确 M-only reviewer").toEqual(EXACT_M_AUTHORITIES);
  const effectiveMenus = payload.data?.session?.menuCodes ?? payload.data?.session?.effectiveMenus ?? [];
  const menuCodes = effectiveMenus
    .map((menu) => typeof menu === "string" ? menu : menu.menuCode ?? "")
    .filter(Boolean)
    .sort();
  expect(menuCodes, "M 非 Owner 只允许 A2/M1-M5 叶菜单").toEqual(EXACT_M_MENU_CODES);
  const a2Status = (await page.request.get("/api/admin/platform/audit/overview")).status();
  const a1Status = (await page.request.get("/api/admin/platform/accounts/overview")).status();
  const deviceStatus = (await page.request.get("/api/admin/devices/overview")).status();
  const buildAssetStatus = (await page.request.get(`/_next/static/${PC_BUILD_ID}/_buildManifest.js`)).status();
  expect(a2Status, "A2 read must be allowed").toBe(200);
  expect(a1Status, "A1 read must be denied").toBe(403);
  expect(deviceStatus, "cross-domain device read must be denied").toBe(403);
  expect(buildAssetStatus, "3002 must serve the locked final2 build asset").toBe(200);
  writeFileSync(path.join(EVIDENCE_DIR, "exact-session-profile.json"), JSON.stringify({
    reviewer: REVIEW_ACCOUNT?.username,
    authorities,
    menuCodes,
    directApiStatus: { a2: a2Status, a1: a1Status, devices: deviceStatus, buildAsset: buildAssetStatus },
    candidate: {
      pcBuildId: PC_BUILD_ID,
      pcPid: PC_PID,
      jarSha256: BACKEND_JAR_SHA,
      backendPid: BACKEND_PID,
    },
  }, null, 2));
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

async function openVisibleModule(page: Page, href: string) {
  const group = page.getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).first();
  const link = page.locator(`a[href="${href}"]`).first();
  if (!await link.isVisible().catch(() => false)) {
    await expect(group).toBeVisible({ timeout: 10_000 });
    await group.click();
  }
  await expect(link, `${href} must be visible in the sidebar`).toBeVisible({ timeout: 10_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(href)}(?:\\?.*)?$`), { timeout: 20_000 });
  await expect(page.locator(".mdom")).toBeVisible({ timeout: 30_000 });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  return currentTotp(secret);
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
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function sha256File(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
}

function sha256Json(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").toUpperCase();
}

async function okData<T>(response: { status(): number; text(): Promise<string> }) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as { code?: number; data?: T };
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}
