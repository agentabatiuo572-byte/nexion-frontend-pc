import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "";
const TOTP_SECRET = process.env.ADMIN_E2E_TOTP_SECRET?.trim() || "";

type ModuleCase = {
  id: string;
  path: string;
  endpoint: string;
  marker: RegExp;
  error: RegExp;
  retry: RegExp;
  mutation: RegExp;
};

const MODULES: ModuleCase[] = [
  {
    id: "K1",
    path: "/risk/multi-account",
    endpoint: "/api/admin/risk/multi-account/overview",
    marker: /三层去重命中列表/,
    error: /K1 数据加载失败/,
    retry: /仅重试 K1/,
    mutation: /调整|添加白名单|移除|标可疑|批量冻结|解除误判|判正常|保存复审/,
  },
  {
    id: "K2",
    path: "/risk/abuse",
    endpoint: "/api/admin/risk/arbitrage/overview",
    marker: /检测阈值/,
    error: /K2 数据加载失败/,
    retry: /仅重试 K2/,
    mutation: /调整|联动 K1 冻结|标记套利|拦截新人礼|标记刷榜/,
  },
  {
    id: "K3",
    path: "/risk/withdrawal-rules",
    endpoint: "/api/admin/risk/withdraw-rules/overview",
    marker: /四道关 · 规则配置/,
    error: /K3 数据加载失败/,
    retry: /仅重试 K3/,
    mutation: /调整|新建规则|沙盒模拟|启用|停用|归档|编辑/,
  },
  {
    id: "K4",
    path: "/risk/scoring",
    endpoint: "/api/admin/risk/scoring/overview",
    marker: /K4 评分模型/,
    error: /K4 读取失败/,
    retry: /仅重试 K4/,
    mutation: /保存模型草稿|发布模型草稿|恢复为草稿|人工覆盖评分|重算回模型分|全部重算/,
  },
  {
    id: "K6",
    path: "/risk/janus-c2",
    endpoint: "/api/admin/janus/dashboard",
    marker: /十二态服务端分布/,
    error: /看板读取失败/,
    retry: /^重试$/,
    mutation: /新建策略|编辑|发布|暂停|归档|回滚|复制|下发|启用|禁用|新增目标|停用目标/,
  },
];

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("K1-K6 从登录页和可见侧栏首轮、刷新、退出重登均读取真实服务端事实", async ({ page }) => {
  const failures = monitorUnexpectedFailures(page);
  await login(page);
  for (const module of MODULES) {
    await openVisibleModule(page, module);
    await expect(page.getByText(module.marker).first(), module.id).toBeVisible({ timeout: 30_000 });
    const response = await page.request.get(module.endpoint);
    expect(response.status(), `${module.id} overview`).toBe(200);
    const payload = await response.json() as { code?: number; data?: unknown };
    expect(payload.code ?? 0, `${module.id} envelope`).toBe(0);
    expect(payload.data, `${module.id} authoritative data`).not.toBeUndefined();
    assertCanonicalIdentity(module.id, payload.data);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(module.marker).first(), `${module.id} refresh`).toBeVisible({ timeout: 30_000 });
  }
  await logout(page);
  await login(page);
  await openVisibleModule(page, MODULES[0]);
  await expect(page.getByText(MODULES[0].marker).first()).toBeVisible({ timeout: 30_000 });
  expect(failures).toEqual([]);
});

for (const module of MODULES) {
  test(`${module.id} 畸形 200 与 HTTP 500 均失败关闭，解除注入后只重试真实来源恢复`, async ({ page }) => {
    const failures = monitorUnexpectedFailures(page);
    await login(page);
    await openVisibleModule(page, module);
    await expect(page.getByText(module.marker).first()).toBeVisible({ timeout: 30_000 });

    await page.route(`**${module.endpoint}**`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, message: "OK", data: { malformed: true } }),
    }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(module.error).first(), `${module.id} malformed`).toBeVisible({ timeout: 30_000 });
    expect(await enabledMutationCount(page, module.mutation), `${module.id} malformed writes`).toBe(0);
    await page.unroute(`**${module.endpoint}**`);
    await page.getByRole("button", { name: module.retry }).first().click();
    await expect(page.getByText(module.marker).first(), `${module.id} malformed recovery`).toBeVisible({ timeout: 30_000 });

    await page.route(`**${module.endpoint}**`, (route) => route.fulfill({
      status: 500,
      contentType: "application/json",
      headers: { "X-NonOwner-Fault-Injection": "1" },
      body: JSON.stringify({ code: 500, message: "NONOWNER_J_INJECTED_500", data: null }),
    }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(module.error).first(), `${module.id} 500`).toBeVisible({ timeout: 30_000 });
    expect(await enabledMutationCount(page, module.mutation), `${module.id} 500 writes`).toBe(0);
    await page.unroute(`**${module.endpoint}**`);
    await page.getByRole("button", { name: module.retry }).first().click();
    await expect(page.getByText(module.marker).first(), `${module.id} 500 recovery`).toBeVisible({ timeout: 30_000 });
    expect(failures).toEqual([]);
  });
}

function assertCanonicalIdentity(moduleId: string, value: unknown) {
  if (moduleId !== "K1" && moduleId !== "K2") return;
  expect(value, `${moduleId} authoritative object`).toBeTruthy();
  expect(typeof value, `${moduleId} authoritative object type`).toBe("object");
  expect(Array.isArray(value), `${moduleId} authoritative object array`).toBe(false);
  const data = value as Record<string, unknown>;
  expect(data.serverCanonical, `${moduleId} canonical marker`).toBe(true);
  expect(data.domain, `${moduleId} domain marker`).toBe(moduleId);
  expect(Array.isArray(data.sources), `${moduleId} sources`).toBe(true);
  expect((data.sources as unknown[]).length, `${moduleId} source count`).toBeGreaterThanOrEqual(moduleId === "K1" ? 9 : 8);
  if (moduleId === "K2") {
    expect(Array.isArray(data.stats), "K2 stats").toBe(true);
    expect(data.stats, "K2 canonical stat count").toHaveLength(4);
    expect(Array.isArray(data.views), "K2 views").toBe(true);
    expect(data.views, "K2 canonical view count").toHaveLength(4);
  }
}

async function login(page: Page) {
  expect(PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
    await page.locator('input[autocomplete="username"]').fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    const response = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST"
      && new URL(candidate.url()).pathname === "/api/admin/auth/login");
    await page.getByRole("button", { name: /登录|继续/ }).click();
    expect((await response).status()).toBe(200);
    const otp = page.getByLabel("一次性验证码");
    if (!await otp.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
      return;
    }
    expect(TOTP_SECRET, "ADMIN_E2E_TOTP_SECRET is required for an MFA-bound K reviewer").not.toBe("");
    await waitForFreshTotp(page);
    await otp.fill(currentTotp(TOTP_SECRET));
    const verification = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST"
      && new URL(candidate.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const verified = await verification;
    const payload = await verified.json().catch(() => null) as { code?: number; message?: string } | null;
    const hasAuthenticatedCookie = (await page.context().cookies())
      .some((cookie) => cookie.name === "nexion_admin_token");
    if (verified.status() === 200 && (payload?.code === 0 || hasAuthenticatedCookie)) {
      await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
      return;
    }
    if (attempt === 0 && ["ADMIN_MFA_CODE_REPLAYED", "ADMIN_MFA_CODE_INVALID"].includes(payload?.message ?? "")) {
      await page.context().clearCookies();
      await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
      continue;
    }
    throw new Error(`K non-owner MFA failed: HTTP ${verified.status()} ${payload?.message ?? "unknown"}`);
  }
  throw new Error("K non-owner login did not reach the authenticated shell");
}

async function logout(page: Page) {
  await page.locator('header button[aria-haspopup="menu"]').last().click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function openVisibleModule(page: Page, module: ModuleCase) {
  const group = page.getByRole("button", { name: /风控与反作弊/ }).first();
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  const link = page.locator(`aside a[href="${module.path}"]`).first();
  await expect(link, `${module.id} visible sidebar link`).toBeVisible({ timeout: 20_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${module.path.replaceAll("/", "\\/")}(?:\\?.*)?$`));
}

async function enabledMutationCount(page: Page, pattern: RegExp) {
  return page.getByRole("button", { name: pattern }).evaluateAll((buttons) =>
    buttons.filter((button) => {
      const element = button as HTMLButtonElement;
      const style = window.getComputedStyle(element);
      return !element.disabled && style.visibility !== "hidden" && style.display !== "none";
    }).length);
}

function monitorUnexpectedFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror:${error.message}`));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/admin/")
      && response.status() >= 500
      && response.headers()["x-nonowner-fault-injection"] !== "1") {
      failures.push(`${response.request().method()} ${response.status()} ${url.pathname}`);
    }
  });
  return failures;
}

async function waitForFreshTotp(page: Page) {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 5_000) await page.waitForTimeout(remaining + 500);
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
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
