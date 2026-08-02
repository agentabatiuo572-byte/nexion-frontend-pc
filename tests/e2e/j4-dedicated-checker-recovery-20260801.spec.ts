import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Locator, type Page, type Response } from "@playwright/test";

type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type Account = { username: string; password: string; totpSecret: string };

const runId = "pc-full-acceptance-20260729-114336-J-D-child";
const baseUrl = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3303";
const fixturePath = "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/domain-permission-fixtures/J.json";
const evidenceDir = "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/J/child-j234-D-handoff/runtime/bypass-bootstrap/recovery";
const username = "acc_j4_checker_114336_0801";
const roleCode = "ACC_J4_CK_114336_0801";
const permissions = ["platform_a2_read", "platform_a2_operation_approve", "emergency_j4_read", "emergency_j4_playbook_execute"];
const preexistingChecker = (JSON.parse(readFileSync(fixturePath, "utf8")) as { checker: Account }).checker;

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("J4 dedicated checker: final controlled recovery and normal-MFA manifest", async ({ browser }) => {
  expect(process.env.J4_BYPASS_BOOTSTRAP_TOKEN).toBeTruthy();
  mkdirSync(evidenceDir, { recursive: true });
  const superContext = await browser.newContext({ baseURL: baseUrl });
  const approverContext = await browser.newContext({ baseURL: baseUrl });
  const checkerContext = await browser.newContext({ baseURL: baseUrl });
  const superadmin = await superContext.newPage();
  const approver = await approverContext.newPage();
  const checker = await checkerContext.newPage();
  superadmin.on("response", (response) => { if (response.request().method() === "POST" && pathOf(response.url()).includes("/accounts/")) console.log("J4_RECOVERY_POST", response.status(), pathOf(response.url())); });
  try {
    await loginSuperadminBypass(superadmin);
    await loginMfa(approver, preexistingChecker, "j4-bootstrap-independent-a2-checker");
    await nav(superadmin, "运营账号 & RBAC A1", /\/platform\/rbac$/);
    await superadmin.locator("select.pager-size").selectOption("50");
    const nextPage = superadmin.locator(".pager-btn").last();
    for (let pageNo = 0; pageNo < 20 && !await nextPage.isDisabled(); pageNo += 1) await nextPage.click();
    const row = superadmin.locator("tbody tr").filter({ hasText: username }).first();
    await expect(row).toBeVisible();
    await resetMfa(superadmin, row, approver);
    await nav(superadmin, "运营账号 & RBAC A1", /\/platform\/rbac$/);
    await superadmin.locator("select.pager-size").selectOption("50");
    const lastAgain = superadmin.locator(".pager-btn").last();
    for (let pageNo = 0; pageNo < 20 && !await lastAgain.isDisabled(); pageNo += 1) await lastAgain.click();
    const temporaryPassword = await resetPassword(superadmin, superadmin.locator("tbody tr").filter({ hasText: username }).first(), approver);
    const password = `Nx!J4Ck${randomBytes(16).toString("base64url")}Aa9`;
    const totpSecret = await enroll(checker, username, temporaryPassword, password);

    // Write only inside restricted evidence before the bypass window is closed.
    persistManifest({ username, password, totpSecret });

    await logout(checker);
    await loginMfa(checker, { username, password, totpSecret }, "j4-dedicated-1");
    const first = await session(checker);
    assertScope(first);
    await expect(checker.locator('a[href="/emergency/sop"]')).toBeVisible();
    await logout(checker);
    await loginMfa(checker, { username, password, totpSecret }, "j4-dedicated-2");
    const second = await session(checker);
    assertScope(second);
    await checker.screenshot({ path: path.join(evidenceDir, "dedicated-checker-normal-mfa-2of2.png"), fullPage: true });
    writeFileSync(path.join(evidenceDir, "recovery-summary.json"), `${JSON.stringify({ runId, username, roleCode, normalMfaCycles: 2, permissions, effectiveMenusContain: ["A2", "J4"], fixturePreparationOnly: true, containsSecrets: false, status: "passed" }, null, 2)}\n`);
  } finally { await superContext.close(); await approverContext.close(); await checkerContext.close(); }
});

async function loginSuperadminBypass(page: Page) { await page.goto("/", { waitUntil: "domcontentloaded" }); await page.getByLabel("账号", { exact: true }).fill("superadmin"); await page.getByLabel("密码", { exact: true }).fill("Admin@123456"); await page.getByRole("button", { name: /继续|登录/ }).click(); await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 }); }
async function nav(page: Page, name: string, url: RegExp) { const link = page.locator("aside").getByRole("link", { name, exact: true }).first(); if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).first().click(); await link.click(); await expect(page).toHaveURL(url); }
async function resetMfa(page: Page, row: Locator, approver: Page) { await row.getByRole("button", { name: "重置 2FA", exact: true }).click(); const operation = await submitIdentity(page); if (operation) await approveFixtureProposal(approver, operation); else await approveLatestFixtureProposal(approver, "重置双因子"); }
async function resetPassword(page: Page, row: Locator, approver: Page) { await row.getByRole("button", { name: "重置密码", exact: true }).click(); const operation = await submitIdentity(page); if (operation) await approveFixtureProposal(approver, operation); else await approveLatestFixtureProposal(approver, "重置密码"); const dialog = page.getByRole("dialog").last(); await expect(dialog.getByText("临时密码", { exact: true })).toBeVisible(); const value = (await dialog.locator(".mono").last().textContent())?.trim() ?? ""; expect(value).not.toBe(""); await dialog.getByText("关闭", { exact: true }).click(); return value; }
async function submitIdentity(page: Page): Promise<string | null> { const dialog = page.getByRole("dialog").filter({ has: page.locator('[data-business-form="identity-verify"]') }).last(); await dialog.getByLabel("核验时间 verified at", { exact: true }).fill("2026-08-01T17:30"); await dialog.getByLabel("来源工单号 ticket", { exact: true }).fill("FIXTURE-J4-RECOVERY-0801"); await dialog.locator('[data-proof="identity-ack"]').check(); await dialog.getByLabel(/操作理由/).fill(`${runId} controlled fixture recovery`); const submit = dialog.getByRole("button", { name: "确认提交", exact: true }); expect(await submit.isDisabled()).toBe(false); const pending = page.waitForResponse((r) => r.request().method() === "POST" && pathOf(r.url()) === "/api/admin/platform/audit/operations"); await submit.click(); const response = await pending; const payload = await response.json() as Envelope<{ operationId?: string; id?: string }> ; if (response.status() === 409 && payload.message === "OBJECT_ALREADY_PENDING") return null; expect(response.status(), JSON.stringify(payload)).toBe(200); expect(payload.code, JSON.stringify(payload)).toBe(0); const operation = String(payload.data?.operationId ?? payload.data?.id ?? ""); expect(operation).toMatch(/^(?:WO|OP)-/); return operation; }
async function approveFixtureProposal(page: Page, operation: string) { await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/); await page.reload({ waitUntil: "domcontentloaded" }); const row = page.locator("tbody tr").filter({ hasText: operation }).first(); await expect(row).toBeVisible({ timeout: 30_000 }); await row.getByRole("button", { name: "执行", exact: true }).click(); const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) }).last(); await dialog.getByLabel(/操作理由/).fill(`${runId} approve controlled fixture recovery`); const pending = page.waitForResponse((r) => r.request().method() === "POST" && pathOf(r.url()) === `/api/admin/platform/audit/operations/${operation}/approve`); await dialog.getByRole("button", { name: "确认提交", exact: true }).click(); await ok(await pending); }
async function approveLatestFixtureProposal(page: Page, action: string) { await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/); await page.reload({ waitUntil: "domcontentloaded" }); const row = page.locator("tbody tr").filter({ hasText: action }).filter({ hasText: "99645" }).first(); await expect(row).toBeVisible({ timeout: 30_000 }); const operation = (await row.innerText()).match(/(?:WO|OP)-[A-Z0-9-]+/)?.[0] ?? ""; expect(operation).toMatch(/^(?:WO|OP)-/); await row.getByRole("button", { name: "执行", exact: true }).click(); const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) }).last(); await dialog.getByLabel(/操作理由/).fill(`${runId} approve recovered pending fixture action`); const pending = page.waitForResponse((r) => r.request().method() === "POST" && pathOf(r.url()) === `/api/admin/platform/audit/operations/${operation}/approve`); await dialog.getByRole("button", { name: "确认提交", exact: true }).click(); await ok(await pending); }
async function enroll(page: Page, user: string, temporary: string, password: string) { await page.goto("/", { waitUntil: "domcontentloaded" }); await page.getByLabel("账号", { exact: true }).fill(user); await page.getByLabel("密码", { exact: true }).fill(temporary); await page.getByRole("button", { name: /继续|登录/ }).click(); const otp = page.getByLabel("一次性验证码", { exact: true }); await expect(otp).toBeVisible({ timeout: 20_000 }); const secret = (await page.locator("code").first().textContent())?.trim() ?? ""; expect(secret).not.toBe(""); await otp.fill(await freshTotp("j4-enroll", secret)); await page.getByRole("button", { name: "验证并进入", exact: true }).click(); await expect(page.getByRole("heading", { name: "首次登录修改密码" })).toBeVisible({ timeout: 20_000 }); await page.getByLabel("新密码", { exact: true }).fill(password); await page.getByLabel("确认新密码", { exact: true }).fill(password); await page.getByRole("button", { name: "确认修改并进入", exact: true }).click(); await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 }); return secret; }
async function loginMfa(page: Page, account: Account, key: string) { for (let attempt = 0; attempt < 3; attempt += 1) { await page.context().clearCookies(); await page.goto("/", { waitUntil: "domcontentloaded" }); await page.getByLabel("账号", { exact: true }).fill(account.username); await page.getByLabel("密码", { exact: true }).fill(account.password); await page.getByRole("button", { name: /继续|登录/ }).click(); const otp = page.getByLabel("一次性验证码", { exact: true }); await expect(otp).toBeVisible({ timeout: 20_000 }); await otp.fill(await freshTotp(key, account.totpSecret)); const pending = page.waitForResponse((r) => pathOf(r.url()) === "/api/admin/auth/mfa/verify"); await page.getByRole("button", { name: "验证并进入", exact: true }).click(); if ((await pending).status() === 200) { await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 }); return; } await wait(30_500 - Date.now() % 30_000); } throw new Error(`MFA login failed: ${key}`); }
async function session(page: Page) { return ok<{ session?: { authorities?: string[]; effectiveMenus?: Array<string | { code?: string }> } }>(await page.request.get("/api/admin/auth/session")); }
function assertScope(value: { session?: { authorities?: string[]; effectiveMenus?: Array<string | { code?: string }> } }) { expect([...(value.session?.authorities ?? [])].sort()).toEqual([...permissions].sort()); expect((value.session?.effectiveMenus ?? []).map((x) => typeof x === "string" ? x : x.code)).toEqual(expect.arrayContaining(["A2", "J4"])); }
function persistManifest(account: Account) { const current = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>; current.checker = { ...account, username, roleCode, authorities: permissions, effectiveMenusMustContain: ["A2", "J4"], normalMfaVerified: true, fixturePreparationOnly: true }; current.cleanup = [...(Array.isArray(current.cleanup) ? current.cleanup : []), { username, roleCode, action: "visible A1 disable/reset-2FA during final cleanup" }]; writeFileSync(fixturePath, `${JSON.stringify(current, null, 2)}\n`, "utf8"); }
async function logout(page: Page) { await page.request.post("/api/admin/auth/logout").catch(() => undefined); await page.context().clearCookies(); }
async function ok<T>(response: Response | APIResponse) { const payload = await response.json() as Envelope<T>; expect(response.status(), JSON.stringify(payload)).toBe(200); expect(payload.code, JSON.stringify(payload)).toBe(0); return payload.data as T; }
const lastStep = new Map<string, number>();
async function freshTotp(key: string, secret: string) { let step = Math.floor(Date.now() / 30_000); if (step <= (lastStep.get(key) ?? -1) || 30_000 - Date.now() % 30_000 < 3_000) await wait(30_500 - Date.now() % 30_000); step = Math.floor(Date.now() / 30_000); lastStep.set(key, step); return totp(secret); }
function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function totp(secret: string) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const bits = secret.replace(/=+$/, " ").replace(/\s+/g, "").toUpperCase().split("").map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join(""); const bytes = Buffer.alloc(Math.floor(bits.length / 8)); for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000))); const digest = createHmac("sha1", bytes).update(counter).digest(); const offset = digest[digest.length - 1] & 15; const value = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255); return String(value % 1_000_000).padStart(6, "0"); }
function pathOf(url: string) { return new URL(url).pathname; }
