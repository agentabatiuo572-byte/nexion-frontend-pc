import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type PermissionFixture = {
  accounts: { l_owner: FixtureAccount };
};

const fixturePath = process.env.L_PERMISSION_FIXTURE_PATH;
if (!fixturePath) throw new Error("L_PERMISSION_FIXTURE_PATH is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PermissionFixture;
const MODULE_MARKERS: Record<string, RegExp> = {
  L1: /KPI 看板/,
  L2: /漏斗|留存/,
  L3: /财务报表/,
  L4: /历史运营报表/,
  L5: /导出.*监管报告|数据出境统一管控面/,
  L6: /用户行为热力图/,
};

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("L Owner 最终锁定：L1-L6 均从可见侧栏进入，刷新与退出重登后不漂移", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const admin5xx: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/admin/") && response.status() >= 500) {
      admin5xx.push(`${response.status()} ${url.pathname}`);
    }
  });

  await login(page, fixture.accounts.l_owner);
  await assertOwnerSession(page);
  const domain = CONSOLE_NAV.find((item) => item.code === "L");
  if (!domain) throw new Error("L domain missing from navigation source");
  for (const module of domain.l2) {
    await openVisibleModule(page, module.path);
    await expect(page.getByText(MODULE_MARKERS[module.id]).first(), module.id).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(module.path)}(?:\\?.*)?$`));
    await expect(page.getByText(MODULE_MARKERS[module.id]).first(), `${module.id} refresh`).toBeVisible({ timeout: 20_000 });
  }

  await logout(page);
  await login(page, fixture.accounts.l_owner);
  await openVisibleModule(page, "/analytics/kpi");
  await expect(page.getByText(MODULE_MARKERS.L1).first()).toBeVisible();
  await openVisibleModule(page, "/analytics/behavior-heatmap");
  await expect(page.getByText(MODULE_MARKERS.L6).first()).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !isBenignConsoleMessage(message))).toEqual([]);
  expect(admin5xx).toEqual([]);
});

async function login(page: Page, account: FixtureAccount) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 10_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function assertOwnerSession(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    data?: { session?: { authorities?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> } };
  };
  const authorities = payload.data?.session?.authorities ?? [];
  const menus = (payload.data?.session?.effectiveMenus ?? []).map((menu) =>
    typeof menu === "string" ? menu : menu.menuCode ?? "");
  for (let module = 1; module <= 6; module += 1) {
    expect(authorities).toContain(`bi_l${module}_read`);
    expect(menus).toContain(`L${module}`);
  }
  for (const permission of [
    "bi_l1_write",
    "bi_l2_write",
    "bi_l3_export_detail",
    "bi_l4_export_tree",
    "bi_l5_regulatory_generate",
    "bi_l6_export",
  ]) {
    expect(authorities).toContain(permission);
  }
  expect(authorities).not.toContain("bi_l5_task_approve");
  expect(authorities).not.toContain("bi_l5_decrypt_export");
}

async function openVisibleModule(page: Page, route: string) {
  const group = page.getByRole("button", { name: /数据与分析 BI/ }).first();
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  const link = page.locator(`aside a[href="${route}"]`).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(route)}(?:\\?.*)?$`));
}

function isBenignConsoleMessage(message: string) {
  return /Download the React DevTools|favicon\.ico/i.test(message)
    || /Failed to load resource: the server responded with a status of (?:401|403)\b/i.test(message);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
