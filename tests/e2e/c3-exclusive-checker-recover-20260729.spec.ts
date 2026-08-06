import { createHmac } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const RUN_ID = process.env.C3_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const FIXTURE_PATH = process.env.C3_FIXTURE_PATH!;
const TEMPORARY_PASSWORD = process.env.C3_CHECKER_TEMPORARY_PASSWORD ?? "";
const TARGET_ID = process.env.C3_TARGET_ID!;
const ACCOUNT_ID = process.env.C3_CHECKER_ACCOUNT_ID ?? "99619";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const ROLE_CODE = "ACC_C3_REVIEW_114336";
const PERMISSIONS = ["user_c3_read", "user_c3_adjust_approve", "user_c3_adjust_reverse"];
const MENU_CODES = ["C", "C3"];
const EVIDENCE_DIR = process.env.C3_SETUP_EVIDENCE_DIR;

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("C3 中断后的专属复核员安全激活、最小权限验证并更新 manifest", async ({ page }) => {
  expect(FIXTURE_PATH).toBeTruthy(); expect(TARGET_ID).toBeTruthy();
  const manifest = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, any>;
  expect(manifest.runId).toBe(RUN_ID);
  const username = "acc_c3rv_0b8bfe4888";
  const password = process.env.C3_CHECKER_FINAL_PASSWORD!;
  expect(password).toBeTruthy();
  const checker = { accountId: ACCOUNT_ID, username, password, totpSecret: "", role: ROLE_CODE.toLowerCase(), authorities: [] as string[], effectiveMenus: [] as string[] };
  let temporaryPassword = TEMPORARY_PASSWORD;
  if (!temporaryPassword) {
    expect(ROOT_PASSWORD, "root password is required for safe recovery").not.toBe("");
    await loginRoot(page);
    const overview = await ok<{ operators: Array<{ id: string | number; version: string | number }> }>(await page.request.get("/api/admin/platform/accounts/overview"));
    const current = overview.operators.find((item) => String(item.id) === ACCOUNT_ID);
    expect(current, "interrupted checker account exists").toBeTruthy();
    const reset = await ok<{ temporaryPassword?: string }>(await page.request.post(`/api/admin/platform/accounts/${ACCOUNT_ID}/password/reset`, {
      headers: keyed(`${RUN_ID}:c3-checker:${ACCOUNT_ID}:recover-password:v${current!.version}`),
      data: { operator: ROOT_USERNAME, reason: `${RUN_ID} recover interrupted C3 checker activation`, expectedVersion: String(current!.version) },
    }));
    temporaryPassword = reset.temporaryPassword ?? "";
    expect(temporaryPassword, "recovery reset temporary password").not.toBe("");
    await logout(page);
  }
  checker.totpSecret = await activate(page, username, temporaryPassword, password);
  const session = await ok<{ session?: { authorities?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> } }>(await page.request.get("/api/admin/auth/session"));
  checker.authorities = session.session?.authorities ?? [];
  checker.effectiveMenus = (session.session?.effectiveMenus ?? []).map((item) => typeof item === "string" ? item : item.menuCode ?? "").filter(Boolean);
  expect(sameSet(checker.authorities, PERMISSIONS), "exact checker authorities").toBe(true);
  expect(sameSet(checker.effectiveMenus, MENU_CODES), "exact checker menus").toBe(true);
  const forbiddenCreate = await page.request.post(`/api/admin/users/profiles/${TARGET_ID}/asset-adjustments`, {
    headers: keyed(`${RUN_ID}:c3-checker:no-create`),
    data: { asset: "USDT", direction: "CREDIT", amount: "0.01", reasonCode: "SYSTEM_CORRECTION", reason: "permission proof only", evidenceRef: RUN_ID },
  });
  expect(forbiddenCreate.status()).toBe(403);
  const makerAuthorities = manifest.accounts?.maker?.authorities ?? [];
  expect(makerAuthorities).toContain("user_c3_adjust_create");
  expect(makerAuthorities).not.toContain("user_c3_adjust_approve");
  manifest.checker = checker;
  manifest.c3ExclusiveChecker = { accountId: ACCOUNT_ID, roleCode: ROLE_CODE, permissions: PERMISSIONS, menuCodes: MENU_CODES, activatedAt: new Date().toISOString() };
  manifest.cleanup = [...(Array.isArray(manifest.cleanup) ? manifest.cleanup : []), { accountId: ACCOUNT_ID, roleCode: ROLE_CODE, action: "retain until C consumers complete; then independently revoke/reset/unassign/disable and delete role" }];
  atomicJson(FIXTURE_PATH, manifest);
  if (EVIDENCE_DIR) atomicJson(path.join(EVIDENCE_DIR, "c3-exclusive-checker-safe.json"), { runId: RUN_ID, accountId: ACCOUNT_ID, roleCode: ROLE_CODE, permissions: PERMISSIONS, menuCodes: MENU_CODES, forbiddenCreateStatus: forbiddenCreate.status(), makerSelfApproveAuthority: false });
});

async function activate(page: Page, username: string, temporaryPassword: string, password: string) { await page.goto(BASE_URL, { waitUntil: "domcontentloaded" }); await page.locator('input[autocomplete="username"]').fill(username); await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword); const response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/api/admin/auth/login"); await page.getByRole("button", { name: /登录|继续/ }).click(); const payload = await (await response).json() as { data?: { mfa?: { manualKey?: string } } }; const secret = payload.data?.mfa?.manualKey?.trim() ?? ""; expect(secret, "new checker TOTP secret").not.toBe(""); const shell = page.locator("aside"); const otp = page.getByLabel("一次性验证码"); const firstPassword = page.getByRole("heading", { name: "首次登录修改密码" }); let changed = false; for (let attempt = 0; attempt < 80; attempt += 1) { if (await shell.isVisible().catch(() => false)) break; if (await otp.isVisible().catch(() => false)) { await otp.fill(await freshTotp(secret)); await page.getByRole("button", { name: "验证并进入", exact: true }).click(); } if (!changed && await firstPassword.isVisible().catch(() => false)) { await page.getByLabel("新密码", { exact: true }).fill(password); await page.getByLabel("确认新密码", { exact: true }).fill(password); await page.getByRole("button", { name: "确认修改并进入", exact: true }).click(); changed = true; } await page.waitForTimeout(250); } await expect(shell).toBeVisible({ timeout: 20_000 }); expect(changed, "first login password changed").toBe(true); return secret; }
async function loginRoot(page: Page) { await page.goto(BASE_URL, { waitUntil: "domcontentloaded" }); if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return; const username = page.locator('input[autocomplete="username"]'); const password = page.locator('input[autocomplete="current-password"]'); await username.fill(ROOT_USERNAME); await password.fill(ROOT_PASSWORD); await expect(username).toHaveValue(ROOT_USERNAME); await expect(password).toHaveValue(ROOT_PASSWORD); const response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/api/admin/auth/login"); await page.getByRole("button", { name: /登录|继续/ }).click(); expect((await response).status()).toBe(200); await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 }); }
async function logout(page: Page) { const account = page.locator('header button[aria-haspopup="menu"]').last(); await account.click(); await page.getByRole("button", { name: "退出登录", exact: true }).click(); await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 }); }
function keyed(key: string) { return { "Content-Type": "application/json", "Idempotency-Key": key }; }
function sameSet(left: string[], right: string[]) { const a = [...new Set(left)].sort(); const b = [...new Set(right)].sort(); return a.length === b.length && a.every((item, index) => item === b[index]); }
function atomicJson(file: string, value: unknown) { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); renameSync(tmp, file); }
async function ok<T>(response: { status(): number; text(): Promise<string> }) { const raw = await response.text(); expect(response.status(), raw).toBeLessThan(400); const body = JSON.parse(raw) as { code?: number; data?: T }; expect(body.code ?? 0, raw).toBe(0); return body.data as T; }
let lastStep = -1;
async function freshTotp(secret: string) { let step = Math.floor(Date.now() / 30_000); if (step <= lastStep) await new Promise((resolve) => setTimeout(resolve, ((lastStep + 1) * 30_000) - Date.now() + 500)); const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30); if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000)); step = Math.floor(Date.now() / 30_000); lastStep = step; const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase(); let bits = ""; for (const char of normalized) { const index = alphabet.indexOf(char); if (index < 0) throw new Error("Invalid base32 TOTP secret"); bits += index.toString(2).padStart(5, "0"); } const bytes = Buffer.alloc(Math.floor(bits.length / 8)); for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2); const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(step)); const digest = createHmac("sha1", bytes).update(message).digest(); const offset = digest[digest.length - 1] & 0x0f; const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff); return String(binary % 1_000_000).padStart(6, "0"); }
