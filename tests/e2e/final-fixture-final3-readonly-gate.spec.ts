import { createHash, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { normalizeEffectiveMenus } from "../../lib/admin/session-role";

const RUN_ID = "pc-full-acceptance-20260729-114336";
const MANIFEST = process.env.FINAL_FIXTURE_MANIFEST_PATH ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/final-fixture-admin-window/final-domain-checkers.json`;
const EXPECTED: Record<string, { menus: string[]; permissions: string[] }> = {
  a6_reviewer: { menus: ["A2", "A6"], permissions: ["platform_a2_read", "platform_a2_operation_approve", "platform_a6_read", "platform_a6_write", "platform_a6_role_grants_update"] },
  e3e6_checker: { menus: ["A2", "E3", "E6"], permissions: ["platform_a2_read", "platform_a2_operation_approve", "device_e3_read", "device_e3_write", "device_e6_read", "device_e6_write"] },
  f1_checker: { menus: ["A2", "F1"], permissions: ["platform_a2_read", "platform_a2_operation_approve", "network_f1_read", "network_f1_write"] },
  f25_checker: { menus: ["A2", "F2", "F3", "F4", "F5"], permissions: ["platform_a2_read", "platform_a2_operation_approve", "network_f2_read", "network_f3_read", "network_f4_read", "network_f5_read", "network_f2_policy_amplify", "network_f2_royalty_rate", "network_f2_write", "network_f3_engine_pause", "network_f3_match_rate", "network_f3_write", "network_f4_leaderboard_control", "network_f4_pool_fund", "network_f4_write", "network_f5_commission_dispose", "network_f5_commission_reject", "network_f5_write"] },
  m_checker: { menus: ["A2", "M1", "M2", "M3", "M4", "M5"], permissions: ["platform_a2_read", "service_m1_read", "service_m1_write", "service_m2_read", "service_m2_write", "service_m3_read", "service_m3_write", "service_m3_timeout_manage", "service_m4_read", "service_m4_write", "service_m5_read", "service_m5_write"] },
  l3_checker_primary: { menus: ["A2", "L3"], permissions: ["platform_a2_read", "bi_l3_read", "bi_l5_task_approve"] },
  l3_checker_secondary: { menus: ["A2", "L3"], permissions: ["platform_a2_read", "bi_l3_read", "bi_l5_task_approve"] },
};
type Fixture = { username: string; password: string; totpSecret: string; roleCode: string };
type Manifest = { sensitive: boolean; doNotUpload: boolean; finalAccounts: Record<string, Fixture>; final75SessionMenuCodes: string[] };

test.describe.configure({ mode: "serial", timeout: 600_000 });

test("FINAL3 read-only gate: every final fixture account authenticates, refreshes, relogs, and retains its exact scope", async ({ browser }, testInfo) => {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8")) as Manifest;
  expect(manifest.sensitive).toBe(true); expect(manifest.doNotUpload).toBe(true);
  const keys = [...Object.keys(EXPECTED), "final75_readonly", "m_supervisor"];
  const evidence: Array<Record<string, string | number>> = [];
  const used = new Map<string, string>();
  for (const key of keys) {
    const fixture = manifest.finalAccounts[key];
    expect(fixture, `missing restricted final fixture ${key}`).toBeTruthy();
    const context = await browser.newContext(); const page = await context.newPage();
    try {
      await login(page, fixture, used);
      const first = await session(page);
      assertScope(key, first, manifest.final75SessionMenuCodes);
      await page.reload(); await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
      const refreshed = await session(page); expect(refreshed.menuHash).toBe(first.menuHash); expect(refreshed.authorityHash).toBe(first.authorityHash);
      await logout(page);
      await login(page, fixture, used);
      const relogged = await session(page); expect(relogged.menuHash).toBe(first.menuHash); expect(relogged.authorityHash).toBe(first.authorityHash);
      evidence.push({ key, role: relogged.role, menuCount: relogged.menus.length, authorityCount: relogged.authorities.length, menuHash: relogged.menuHash, authorityHash: relogged.authorityHash });
    } finally { await context.close(); }
  }
  const payload = JSON.stringify({ runId: RUN_ID, build: "B9Ondo82Dj7NKNNE6ZcgB", jarSha256: "54B25D49CC36BAB02E1E36627CE5D9296AE92717FBACEFD5F222EE04528E59E4", evidence }, null, 2);
  await writeFile(testInfo.outputPath("final3-readonly-gate.json"), `${payload}\nsha256=${createHash("sha256").update(payload).digest("hex")}\n`);
});

async function session(page: Page) {
  const response = await page.request.get("/api/admin/auth/session"); expect(response.status()).toBe(200);
  const body = await response.json() as { code?: number; data?: { session?: { role?: string; authorities?: string[]; menuCodes?: string[]; effectiveMenus?: unknown[] } } };
  expect(body.code).toBe(0); const value = body.data?.session; expect(value).toBeTruthy();
  const menus = normalizeEffectiveMenus({ menuCodes: value?.menuCodes, effectiveMenus: value?.effectiveMenus }) ?? [];
  const authorities = value?.authorities ?? [];
  return { role: value?.role ?? "", menus: [...menus].sort(), authorities: [...authorities].sort(), menuHash: digest(menus), authorityHash: digest(authorities) };
}
function assertScope(key: string, value: Awaited<ReturnType<typeof session>>, final75Menus: string[]) {
  if (EXPECTED[key]) { expect(new Set(value.menus)).toEqual(new Set(EXPECTED[key].menus)); expect(new Set(value.authorities)).toEqual(new Set(EXPECTED[key].permissions)); return; }
  if (key === "final75_readonly") { expect(new Set(value.menus)).toEqual(new Set(final75Menus)); expect(value.authorities.length).toBeGreaterThan(0); expect(value.authorities.every((permission) => permission.endsWith("_read"))).toBe(true); return; }
  expect(value.role.toUpperCase()).toBe("SUPPORT");
  for (const required of ["service_m1_read", "service_m1_write", "service_m5_read", "service_m5_write"]) expect(value.authorities).toContain(required);
  for (const forbidden of ["service_m2_write", "service_m3_write", "service_m4_write"]) expect(value.authorities, `SUPPORT final fixture不得具备${forbidden}`).not.toContain(forbidden);
  expect(value.authorities.some((permission) => /^(?!service_m)[a-z]+_.*_write$/.test(permission)), "SUPPORT final fixture不得具备跨域写权").toBe(false);
}
async function login(page: Page, fixture: Fixture, used: Map<string, string>) {
  await page.goto("/"); await page.locator('input[autocomplete="username"]').fill(fixture.username); await page.locator('input[autocomplete="current-password"]').fill(fixture.password); await page.getByRole("button", { name: "继续", exact: true }).click();
  const otp = page.getByLabel("一次性验证码"); await otp.waitFor({ state: "visible", timeout: 15_000 }); let prior = used.get(fixture.totpSecret) ?? "";
  for (let attempt = 0; attempt < 2; attempt += 1) { let code = totp(fixture.totpSecret); while (code === prior) { await page.waitForTimeout(1_100); code = totp(fixture.totpSecret); } prior = code; await otp.fill(code); const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/admin/auth/mfa/verify")); await page.getByRole("button", { name: "验证并进入", exact: true }).click(); if ((await response).status() === 200) { used.set(fixture.totpSecret, code); await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 }); return; } await otp.waitFor({ state: "visible", timeout: 10_000 }); }
  throw new Error("FINAL3_MFA_VERIFY_FAILED_AFTER_NEXT_WINDOW");
}
async function logout(page: Page) { const menu = page.locator('header button[aria-haspopup="menu"]').first(); await menu.click(); await page.getByRole("button", { name: "退出登录", exact: true }).last().click(); await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 }); }
function totp(secret: string) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const char of secret.replace(/[^A-Z2-7]/gi, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0"); const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2)); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000))); const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1] & 15; return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0"); }
function digest(values: string[]) { return createHash("sha256").update(JSON.stringify([...values].sort())).digest("hex"); }
