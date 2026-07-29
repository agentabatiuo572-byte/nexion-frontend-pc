import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_PATH = process.env.B_PERMISSION_FIXTURE_PATH;
if (!FIXTURE_PATH) throw new Error("B_PERMISSION_FIXTURE_PATH is required");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
  runId: string;
  accounts: Record<"b_readonly" | "b_no_write" | "b_no_menu", {
    username: string;
    password: string;
    totpSecret: string;
  }>;
};

const MODULES = [
  {
    id: "B1",
    path: "/overview/dual-ledger",
    title: "双账本总览",
    readPath: "/api/admin/treasury/b-domain",
    writePath: "/api/admin/treasury/b-domain/alerts/coverage-redline/ack",
    writeMethod: "POST",
    writeBody: { reason: "B 域权限探针不得执行", operator: "permission-probe" },
    actions: /阈值配置|登记储备注入|标记已处置/,
  },
  {
    id: "B2",
    path: "/overview/liquidity",
    title: "资金池水位",
    readPath: "/api/admin/treasury/reserve",
    writePath: "/api/admin/treasury/forecast-config",
    writeMethod: "PUT",
    writeBody: { reason: "B 域权限探针不得执行", operator: "permission-probe", expectedVersion: -1 },
    actions: /调整预测配置|导出负债 CSV/,
  },
  {
    id: "B3",
    path: "/overview/funnel",
    title: "转化漏斗",
    readPath: "/api/admin/funnel",
    writePath: "/api/admin/funnel/view",
    writeMethod: "POST",
    writeBody: { name: "permission-probe", cohort: "ALL", phase: "ALL", ref: "ALL" },
    actions: /保存为视图|导出 cohort/,
  },
  {
    id: "B4",
    path: "/overview/rhythm",
    title: "节奏状态",
    readPath: "/api/admin/phase/overview",
    writePath: "/api/admin/phase/jump?dial=permission-probe",
    writeMethod: "GET",
    writeBody: {},
    actions: /导出 Phase 分布|在 H1 调整/,
  },
  {
    id: "B5",
    path: "/overview/risk-radar",
    title: "风险雷达",
    readPath: "/api/admin/risk/radar",
    writePath: "/api/admin/risk/radar/triage",
    writeMethod: "POST",
    writeBody: {
      dimension: "coverage",
      target: "/overview/dual-ledger",
      operator: "permission-probe",
    },
    actions: /阈值配置|处置 →|核验 →|保存订阅/,
  },
] as const;

test.describe.configure({ mode: "serial", timeout: 300_000 });

for (const key of ["b_readonly", "b_no_write"] as const) {
  test(`${key}：B1-B5 菜单/路由/数据可读，按钮与接口写入拒绝`, async ({ page }) => {
    const errors = monitorErrors(page);
    await login(page, fixture.accounts[key]);
    await assertSession(page, true);
    await assertVisibleMenus(page);

    for (const module of MODULES) {
      await openVisible(page, module);
      await expect(page.getByRole("heading", { name: module.title })).toBeVisible({ timeout: 20_000 });
      const read = await browserApi(page, "GET", module.readPath);
      expect(read.status, `${key} ${module.id} read`).toBe(200);
      expect(read.hasData, `${key} ${module.id} data`).toBe(true);
      const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
      expect(write.status, `${key} ${module.id} write`).toBe(403);
      expect(await enabledActionCount(page, module.actions), `${key} ${module.id} buttons`).toBe(0);
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "风险雷达" })).toBeVisible();
    await logout(page);
    await login(page, fixture.accounts[key]);
    await assertVisibleMenus(page);
    expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(200);
    expect((await browserApi(
      page, MODULES[0].writeMethod, MODULES[0].writePath, MODULES[0].writeBody,
    )).status).toBe(403);
    expect(errors).toEqual([]);
    await logout(page);
  });
}

test("b_no_menu：B 菜单、直接路由、读写接口均拒绝，刷新重登不恢复缓存", async ({ page }) => {
  const errors = monitorErrors(page);
  await login(page, fixture.accounts.b_no_menu);
  await assertSession(page, false);
  await expect(page.locator('aside a[href^="/overview/"]')).toHaveCount(0);

  await page.goto("/overview/dual-ledger", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/overview\/dual-ledger(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "双账本总览" })).toHaveCount(0);
  for (const module of MODULES) {
    expect((await browserApi(page, "GET", module.readPath)).status, `${module.id} read`).toBe(403);
    expect((await browserApi(page, module.writeMethod, module.writePath, module.writeBody)).status, `${module.id} write`).toBe(403);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('aside a[href^="/overview/"]')).toHaveCount(0);
  await logout(page);
  await login(page, fixture.accounts.b_no_menu);
  await expect(page.locator('aside a[href^="/overview/"]')).toHaveCount(0);
  expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(403);
  expect(errors).toEqual([]);
  await logout(page);
});

async function login(
  page: Page,
  account: { username: string; password: string; totpSecret: string },
) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 15_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function assertSession(page: Page, hasRead: boolean) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    data?: { session?: { authorities?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> } };
  };
  const authorities = payload.data?.session?.authorities ?? [];
  const menus = (payload.data?.session?.effectiveMenus ?? []).map((menu) =>
    typeof menu === "string" ? menu : menu.menuCode ?? "");
  for (const module of MODULES) {
    const permission = `overview_${module.id.toLowerCase()}_read`;
    if (hasRead) expect(authorities).toContain(permission);
    else expect(authorities).not.toContain(permission);
  }
  if (hasRead) {
    expect(authorities.some((permission) =>
      permission.startsWith("overview_b") && !permission.endsWith("_read"))).toBe(false);
    for (const code of ["B", "B1", "B2", "B3", "B4", "B5"]) expect(menus).toContain(code);
  } else {
    expect(authorities).toEqual([]);
    expect(menus).toEqual([]);
  }
}

async function assertVisibleMenus(page: Page) {
  const group = page.getByRole("button", { name: /总览驾驶舱/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  for (const module of MODULES) await expect(page.locator(`aside a[href="${module.path}"]`)).toBeVisible();
}

async function openVisible(page: Page, module: typeof MODULES[number]) {
  const link = page.locator(`aside a[href="${module.path}"]`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(module.path)}$`));
}

async function browserApi(
  page: Page,
  method: string,
  requestPath: string,
  body?: Record<string, unknown>,
) {
  return page.evaluate(async ({ requestMethod, apiPath, requestBody, runId }) => {
    const response = await fetch(apiPath, {
      method: requestMethod,
      credentials: "same-origin",
      headers: requestMethod === "GET" ? undefined : {
        "Content-Type": "application/json",
        "Idempotency-Key": `b-permission-${runId}-${crypto.randomUUID()}`,
      },
      body: requestMethod === "GET" ? undefined : JSON.stringify(requestBody ?? {}),
    });
    const payload = await response.json().catch(() => null) as { data?: unknown } | null;
    return { status: response.status, hasData: payload?.data !== undefined };
  }, { requestMethod: method, apiPath: requestPath, requestBody: body, runId: fixture.runId });
}

async function enabledActionCount(page: Page, name: RegExp) {
  const buttons = await page.getByRole("button", { name }).evaluateAll((elements) =>
    elements.filter((element) => {
      const button = element as HTMLButtonElement;
      const style = window.getComputedStyle(button);
      return !button.disabled && style.visibility !== "hidden" && style.display !== "none";
    }).length);
  const links = await page.getByRole("link", { name }).evaluateAll((elements) =>
    elements.filter((element) => {
      const style = window.getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none";
    }).length);
  return buttons + links;
}

function monitorErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
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

const lastTotpStep = new Map<string, number>();

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const lastStep = lastTotpStep.get(secret);
  const millisecondsRemaining = 30_000 - (Date.now() % 30_000);
  if ((lastStep !== undefined && step <= lastStep) || millisecondsRemaining < 3_000) {
    const waitMs = millisecondsRemaining + 250;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    step = Math.floor(Date.now() / 30_000);
  }
  lastTotpStep.set(secret, step);
  return currentTotp(secret);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
