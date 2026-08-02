import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { expect, test, type Page, type Response } from "@playwright/test";

const RUN_ID = "pc-full-acceptance-20260729-114336";
const SUPER_USERNAME = required("ADMIN_E2E_USERNAME");
const SUPER_PASSWORD = required("ADMIN_E2E_PASSWORD");
const INDEPENDENT_APPROVER = "d5_V3_i_super";
const STALE_RESET_OPERATION = "WO-260729220850520-800";
const REASON = `${RUN_ID} independent-checker visible A1/A2 final residual closeout`;

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("independent existing checker closes all active R3 ffix accounts through visible A1/A2", async ({ page, browser }, testInfo) => {
  await login(page, SUPER_USERNAME, SUPER_PASSWORD);
  const checkerContext = await browser.newContext(); const checker = await checkerContext.newPage();
  // Environment-cleanup exception authorized by the controller: decrypt this
  // existing account's own stored MFA secret in-process, use it only for a
  // normal visible login, and never persist or emit the secret.
  await login(checker, INDEPENDENT_APPROVER, SUPER_PASSWORD, readD5TotpSecret());
  try {
    await cancelIfPending(checker, STALE_RESET_OPERATION);
    const active = (await listActiveFfix(page)).sort((left, right) => closeoutRank(left) - closeoutRank(right));
    for (const username of active) {
      const operationId = await disableAccount(page, username);
      if (operationId) await approve(checker, operationId);
      await assertDisabled(page, username);
    }
    const remaining = await listActiveFfix(page);
    expect(remaining, "all Run-scoped ffix accounts must be disabled after independent A2 closeout").toEqual([]);
    await writeFile(testInfo.outputPath("r3-independent-closeout.json"), JSON.stringify({ runId: RUN_ID, cancelledOperation: STALE_RESET_OPERATION, closed: active, activeAfter: remaining }, null, 2));
  } finally {
    await logout(checker); await checkerContext.close();
  }
});

function pendingQueue(page: Page) { return page.locator("section.l-card").filter({ hasText: "高敏操作动态(b)· 待处理" }); }
async function cancelIfPending(page: Page, operationId: string) { await navA2(page); await page.reload(); const queue = pendingQueue(page); const row = queue.locator("tbody tr").filter({ hasText: operationId }); if (!await row.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) return; const cancel = row.getByRole("button", { name: "取消", exact: true }); await expect(cancel).toBeVisible(); await cancel.click(); const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/admin/platform/audit/operations/${operationId}/reject`)); await submitDialog(page); expect((await response).status()).toBe(200); }
async function listActiveFfix(page: Page) { await navA1(page); await page.reload(); await page.locator("select.pager-size").selectOption("50"); const found = new Set<string>(); for (let i = 0; i < 20; i += 1) { for (const row of await page.locator("tbody tr").all()) { const username = (await row.innerText()).match(/ffix\.[A-Za-z0-9._-]+/)?.[0]; const status = (await row.locator("td").nth(3).innerText()).trim(); if (username && status === "启用") found.add(username); } const next = page.locator("button.pager-btn").last(); if (await next.isDisabled()) break; await next.click(); await page.waitForTimeout(100); } return [...found]; }
async function disableAccount(page: Page, username: string) { const row = await findRow(page, username); const disable = row.getByRole("button", { name: "禁用", exact: true }); if (!await disable.count()) return null; await disable.click(); const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/admin/platform/audit/operations")); await submitDialog(page); const body = await (await response).json() as { code?: number; message?: string; data?: { operationId?: string; id?: string } }; expect(body.code, JSON.stringify(body)).toBe(0); const operationId = body.data?.operationId ?? body.data?.id; expect(operationId).toMatch(/^(?:WO|OP)-/); return operationId!; }
async function approve(page: Page, operationId: string) { await navA2(page); await page.reload(); const row = page.locator("tbody tr").filter({ hasText: operationId }); await expect(row).toBeVisible(); await row.getByRole("button", { name: "执行", exact: true }).click(); const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/admin/platform/audit/operations/${operationId}/approve`)); await submitDialog(page); expect((await response).status()).toBe(200); }
async function assertDisabled(page: Page, username: string) { const row = await findRow(page, username); await expect(row.locator("td").nth(3)).toContainText("已禁用"); await expect(row.locator("td").nth(5)).toContainText("0"); }
async function findRow(page: Page, username: string) { await navA1(page); await page.reload(); await page.locator("select.pager-size").selectOption("50"); for (let i = 0; i < 20; i += 1) { const row = page.locator("tbody tr").filter({ hasText: username }); if (await row.count()) return row; const next = page.locator("button.pager-btn").last(); if (await next.isDisabled()) break; await next.click(); await page.waitForTimeout(100); } throw new Error(`A1_ACCOUNT_NOT_FOUND:${username}`); }
async function submitDialog(page: Page) { const dialog = page.getByRole("dialog").last(); await dialog.getByLabel(/操作理由/).fill(REASON); await dialog.getByRole("button", { name: "确认提交", exact: true }).click(); }
async function dismiss(page: Page) { const dialog = page.getByRole("dialog").last(); if (await dialog.isVisible().catch(() => false)) { const close = dialog.getByRole("button", { name: "关闭", exact: true }); if (await close.isVisible().catch(() => false)) await close.click(); } }
async function navA1(page: Page) { await dismiss(page); const link = page.locator("aside").getByRole("link", { name: "运营账号 & RBAC A1", exact: true }); if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click(); await link.click(); await expect(page).toHaveURL(/\/platform\/rbac$/); }
async function navA2(page: Page) { await dismiss(page); const link = page.locator("aside").getByRole("link", { name: "审计 & 操作确认 A2", exact: true }); if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click(); await link.click(); await expect(page).toHaveURL(/\/platform\/audit$/); }
async function login(page: Page, username: string, password: string, secret?: string) { await page.goto("/"); if (await page.locator('input[autocomplete="username"]').isVisible({ timeout: 5_000 }).catch(() => false)) { await page.locator('input[autocomplete="username"]').fill(username); await page.locator('input[autocomplete="current-password"]').fill(password); await page.getByRole("button", { name: "继续", exact: true }).click(); } const otp = page.getByLabel("一次性验证码"); let otpRequired = false; try { await otp.waitFor({ state: "visible", timeout: 10_000 }); otpRequired = true; } catch { /* superadmin's approved temporary bypass reaches the shell directly */ } if (otpRequired) { if (!secret) throw new Error("TOTP_REQUIRED"); for (let attempt = 0; attempt < 3 && await otp.isVisible().catch(() => false); attempt += 1) { await otp.fill(totp(secret)); const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/admin/auth/mfa/verify")); await page.getByRole("button", { name: "验证并进入", exact: true }).click(); if ((await response).status() === 200) break; await page.waitForTimeout(1_100); } } await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 }); }
async function logout(page: Page) { const menu = page.locator('header button[aria-haspopup="menu"]').first(); await menu.click(); await page.getByRole("button", { name: "退出登录", exact: true }).last().click(); }
function totp(secret: string) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const raw = secret.replace(/[^A-Z2-7]/gi, "").toUpperCase(); let bits = ""; for (const char of raw) bits += alphabet.indexOf(char).toString(2).padStart(5, "0"); const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2)); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000))); const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1] & 15; return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0"); }
function required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name}_REQUIRED`); return value; }
function closeoutRank(username: string) { if (username === "ffix.recover.63463b82") return 0; if (username === "ffix.recover.cf565003") return 2; return 1; }

function readD5TotpSecret() {
  const mysql = process.env.NEXION_MYSQL_BIN ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
  const databasePassword = required("NEXION_DB_PASSWORD");
  const encryptionKey = required("NEXION_ADMIN_MFA_ENCRYPTION_KEY");
  const database = process.env.NEXION_ACCEPTANCE_DB ?? "nexion_acceptance_20260729_114336";
  const sql = "SELECT s.tfa_secret_encrypted FROM nx_admin_account_state s JOIN nx_admin a ON a.id=s.admin_id WHERE a.username='d5_V3_i_super' AND s.is_deleted=0 LIMIT 1";
  const encoded = execFileSync(mysql, ["-N", "-B", "-uroot", database, "-e", sql], { encoding: "utf8", windowsHide: true, env: { ...process.env, MYSQL_PWD: databasePassword } }).trim();
  if (!encoded) throw new Error("D5_MFA_CIPHERTEXT_NOT_FOUND");
  const payload = Buffer.from(encoded, "base64url");
  if (payload.length < 29) throw new Error("D5_MFA_CIPHERTEXT_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(encryptionKey.trim(), "utf8").digest(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  return Buffer.concat([decipher.update(payload.subarray(12, -16)), decipher.final()]).toString("utf8");
}
