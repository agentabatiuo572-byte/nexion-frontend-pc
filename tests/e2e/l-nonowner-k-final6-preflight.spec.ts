import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string; authorities?: string[]; effectiveMenus?: string[] };
type LFixture = {
  runId: string;
  accounts: { maker: Account; readonly: Account; nowrite: Account; nomenu: Account };
};
type CheckerFixture = {
  runId: string;
  accounts: { checkerA: Account; checkerB: Account };
  authorities: string[];
  menuCodes: string[];
};

const L_FIXTURE_PATH = process.env.L_PERMISSION_FIXTURE_PATH;
const CHECKER_FIXTURE_PATH = process.env.L_CHECKER_PAIR_PATH;
if (!L_FIXTURE_PATH || !CHECKER_FIXTURE_PATH) {
  throw new Error("L_PERMISSION_FIXTURE_PATH and L_CHECKER_PAIR_PATH are required");
}
const lFixture = JSON.parse(readFileSync(L_FIXTURE_PATH, "utf8")) as LFixture;
const checkerFixture = JSON.parse(readFileSync(CHECKER_FIXTURE_PATH, "utf8")) as CheckerFixture;

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("Final6 L fixtures complete real MFA and remain minimally authorized", async ({ page }) => {
  expect(lFixture.runId).toBe("pc-full-acceptance-20260729-114336");
  expect(checkerFixture.runId).toBe(lFixture.runId);
  expect(checkerFixture.accounts.checkerA.username).not.toBe(checkerFixture.accounts.checkerB.username);
  expect(checkerFixture.accounts.checkerA.username).not.toBe(lFixture.accounts.maker.username);

  await login(page, lFixture.accounts.maker);
  const maker = await session(page);
  expect(maker.authorities).toEqual([...(lFixture.accounts.maker.authorities ?? [])].sort());
  expect(maker.menuCodes).toEqual([...(lFixture.accounts.maker.effectiveMenus ?? [])].sort());
  expect(maker.authorities).not.toContain("bi_l5_task_approve");
  expect(maker.authorities).not.toContain("bi_l5_decrypt_export");
  await expectVisibleLeaves(page, ["/analytics/kpi", "/analytics/funnel-cohort", "/analytics/financial", "/analytics/operations", "/analytics/export", "/analytics/behavior-heatmap"]);
  await logout(page);

  for (const account of [lFixture.accounts.readonly, lFixture.accounts.nowrite]) {
    await login(page, account);
    const current = await session(page);
    for (let index = 1; index <= 6; index += 1) expect(current.authorities).toContain(`bi_l${index}_read`);
    expect(current.authorities.some((permission) => /^bi_l[1-6]_/.test(permission) && !permission.endsWith("_read"))).toBe(false);
    await expectVisibleLeaves(page, ["/analytics/kpi", "/analytics/funnel-cohort", "/analytics/financial", "/analytics/operations", "/analytics/export", "/analytics/behavior-heatmap"]);
    await logout(page);
  }

  await login(page, lFixture.accounts.nomenu);
  const nomenu = await session(page);
  expect(nomenu.authorities.some((permission) => /^bi_l[1-6]_/.test(permission))).toBe(false);
  expect(nomenu.menuCodes.some((code) => /^L[1-6]$/.test(code))).toBe(false);
  await expect(page.locator('aside a[href^="/analytics/"]')).toHaveCount(0);
  await logout(page);

  for (const account of [checkerFixture.accounts.checkerA, checkerFixture.accounts.checkerB]) {
    await login(page, account);
    const current = await session(page);
    expect(current.authorities).toEqual([...checkerFixture.authorities].sort());
    expect(current.menuCodes).toEqual([...checkerFixture.menuCodes].sort());
    await expectVisibleLeaves(page, ["/platform/audit", "/analytics/financial"]);
    await logout(page);
  }
});

async function login(page: Page, account: Account) {
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
  await page.locator('header button[aria-haspopup="menu"]').last().click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function session(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const body = await response.json() as { data?: { session?: { authorities?: string[]; menuCodes?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> } } };
  const value = body.data?.session;
  return {
    authorities: [...(value?.authorities ?? [])].sort(),
    menuCodes: [...(value?.menuCodes ?? value?.effectiveMenus?.map((item) => typeof item === "string" ? item : item.menuCode ?? "") ?? [])].filter(Boolean).sort(),
  };
}

async function expectVisibleLeaves(page: Page, expected: string[]) {
  for (const group of [page.getByRole("button", { name: /平台基础/ }).first(), page.getByRole("button", { name: /数据与分析 BI/ }).first()]) {
    if (await group.isVisible().catch(() => false) && await group.getAttribute("aria-expanded") !== "true") await group.click();
  }
  const leaves = await page.locator('aside a[href^="/"]').evaluateAll((items) => [...new Set(items.map((item) => item.getAttribute("href") ?? "").filter((href) => href.startsWith("/analytics/") || href === "/platform/audit"))].sort());
  expect(leaves).toEqual([...expected].sort());
}

let previousStep = -1;
async function freshTotp(secret: string) {
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  let step = Math.floor(Date.now() / 30_000);
  if (step <= previousStep) {
    await new Promise((resolve) => setTimeout(resolve, ((previousStep + 1) * 30_000) - Date.now() + 500));
    step = Math.floor(Date.now() / 30_000);
  }
  previousStep = step;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
