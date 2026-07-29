import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "Admin@123456";
const EVIDENCE_DIR = process.env.M_REVIEW_L_READ_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/M-review-L/read-failclosed";

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
      await expect(page.locator('[data-proof="session-script-new"]')).toBeDisabled();
      await expect(page.locator('[data-proof="session-tpl-new"]')).toBeDisabled();
    },
    recoveredText: "客服岗位与专属客服",
    label: "M5-500",
  });

  await readOutcomeUnknownAndRecover(page);
  expect(businessMutations).toEqual([]);
  await logout(page);
  writeFileSync(path.join(EVIDENCE_DIR, "runtime-result.json"), JSON.stringify({
    candidate: {
      pcBuildId: "q2cNmpfQ_JFRzTMXb2oiR",
      pcPid: 15084,
      jarSha256: "199B656A05B43CF43D0252C9E9DC93CF94D4C7F605609345B0B738C4AFB97F9D",
      backendPid: 2672,
    },
    checks,
    businessMutations,
    pageErrors,
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
    await expect(page.locator('[data-proof="session-script-new"]')).toBeDisabled();
    checks.push("M5-read-result-unknown-fails-closed");
  } finally {
    await page.unroute(pattern, handler);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("客服岗位与专属客服", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-proof="session-script-new"]')).toBeEnabled();
  checks.push("M5-read-result-unknown-recovered");
}

async function login(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 1_500 }).catch(() => false)) await logout(page);
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
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
