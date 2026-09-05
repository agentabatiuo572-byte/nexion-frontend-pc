import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";

type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type Fixture = { accounts: { maker: { username: string; password: string; totpSecret: string } } };

const runId = "pc-full-acceptance-20260729-114336-J-D-child";
const baseUrl = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3303";
const fixturePath = "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/domain-permission-fixtures/J.json";
const aMakerFixturePath = "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/domain-permission-fixtures/A.json";
const evidenceDir = "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/J/child-j234-D-handoff/runtime/bypass-bootstrap/fixture";
const roleCode = "ACC_J4_CK_114336_0801";
const roleName = "J4 专属独立复核员 0801";
const username = "acc_j4_checker_114336_0801";
const permissions = ["platform_a2_read", "platform_a2_operation_approve", "emergency_j4_read", "emergency_j4_playbook_execute"];
const menus = ["A", "A2", "J", "J4"];
const fixture = JSON.parse(readFileSync(aMakerFixturePath, "utf8")) as Fixture;

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("J4 dedicated checker: visible A6/A2 bootstrap and normal-MFA verification", async ({ browser }) => {
  expect(process.env.J4_BYPASS_BOOTSTRAP_TOKEN).toBeTruthy();
  mkdirSync(evidenceDir, { recursive: true });
  const makerContext = await browser.newContext({ baseURL: baseUrl });
  const superContext = await browser.newContext({ baseURL: baseUrl });
  const checkerContext = await browser.newContext({ baseURL: baseUrl });
  const maker = await makerContext.newPage();
  const superadmin = await superContext.newPage();
  const checker = await checkerContext.newPage();
  const evidence: Record<string, unknown> = { runId, roleCode, username, permissions, menus, visibleProductPath: true, sqlPermissionMutation: false, temporaryBypassWindow: true };
  try {
    await loginMfa(maker, fixture.accounts.maker, "j4-bootstrap-maker");
    await loginSuperadminBypass(superadmin);

    const overviewPending = maker.waitForResponse((r) => r.request().method() === "GET" && pathOf(r.url()) === "/api/admin/platform/roles/overview");
    await nav(maker, "角色管理 A6", /\/platform\/roles$/);
    await ok<{ roles?: Array<{ id?: number; roleCode?: string }> }>(await overviewPending);
    const existingRole = maker.getByText(roleCode, { exact: true }).first();
    let roleId = 0;
    let roleCreateOperation = "NOT_REQUIRED_DIRECT_ROLE_CREATE";
    if (await existingRole.count()) {
      const detailResponse = maker.waitForResponse((r) => r.request().method() === "GET" && /\/api\/admin\/platform\/roles\/\d+$/.test(pathOf(r.url())));
      await existingRole.click();
      roleId = Number((await ok<{ id?: number }>(await detailResponse)).id);
    } else {
      await maker.getByRole("button", { name: "+ 新建角色", exact: true }).click();
      await maker.getByPlaceholder("如 CONTENT_EDITOR").fill(roleCode);
      await maker.getByPlaceholder("如 内容编辑员").fill(roleName);
      await maker.getByPlaceholder("职责说明").fill(`${runId} dedicated least-privilege J4 checker`);
      await maker.getByRole("button", { name: "提交（需确认）", exact: true }).click();
      const roleCreate = await confirmAndWait(maker, (r) => r.request().method() === "POST" && pathOf(r.url()) === "/api/admin/platform/roles");
      roleId = Number((await ok<{ id?: number }>(roleCreate)).id);
    }
    expect(roleId).toBeGreaterThan(0);

    await maker.reload({ waitUntil: "domcontentloaded" });
    await maker.getByText(roleCode, { exact: true }).first().click();
    await maker.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
    const drawer = maker.getByRole("dialog").filter({ has: maker.getByRole("button", { name: "保存授权（需确认）", exact: true }) });
    for (const permission of permissions) {
      await drawer.getByLabel("权限搜索").fill(permission);
      await drawer.locator(`label[title="${permission}"] input[type="checkbox"]`).check();
    }
    await drawer.getByLabel("权限搜索").fill("");
    await setMenus(drawer, menus);
    await drawer.getByRole("button", { name: "保存授权（需确认）", exact: true }).click();
    const grants = await confirmAndWait(maker, (r) => r.request().method() === "PUT" && pathOf(r.url()) === `/api/admin/platform/roles/${roleId}/grants`);
    const grantsData = await ok<{ operationId?: string; id?: string }>(grants);
    const grantsOperation = String(grantsData.operationId ?? grantsData.id ?? "");
    expect(grantsOperation).toMatch(/^(?:WO|OP)-/);
    await approve(superadmin, grantsOperation, "approve exact dedicated J4 checker permissions and menus");

    // Account-role assignment is intentionally super-only. This is approved fixture preparation,
    // not Owner acceptance evidence; all subsequent J checks use the normal-MFA checker.
    await nav(superadmin, "运营账号 & RBAC A1", /\/platform\/rbac$/);
    await superadmin.locator("select.pager-size").selectOption("50");
    const existingAccount = superadmin.locator("tbody tr").filter({ hasText: username }).first();
    let accountId = "";
    let temporaryPassword = "";
    if (await existingAccount.count()) {
      await resetFixtureMfa(superadmin, existingAccount);
      accountId = await resetFixturePassword(superadmin, existingAccount);
      temporaryPassword = await readTemporaryPassword(superadmin);
    } else {
      await superadmin.getByRole("button", { name: "+ 新建账号", exact: true }).click();
      const accountDialog = superadmin.getByRole("dialog").last();
      await accountDialog.getByRole("textbox", { name: "登录名 *", exact: true }).fill(username);
      await accountDialog.getByPlaceholder("姓名,如:张三").fill("J4 专属独立复核员");
      await accountDialog.getByText(roleName, { exact: true }).click();
      await accountDialog.getByLabel(/操作理由/).fill(`${runId} create independent normal-MFA J4 checker`);
      const accountResponse = superadmin.waitForResponse((r) => r.request().method() === "POST" && pathOf(r.url()) === "/api/admin/platform/accounts");
      await accountDialog.getByRole("button", { name: "确认创建账号", exact: true }).click();
      const accountConfirm = superadmin.getByRole("dialog").filter({ has: superadmin.getByRole("button", { name: "确认提交", exact: true }) }).last();
      await accountConfirm.getByLabel(/操作理由/).fill(`${runId} confirm dedicated J4 checker creation`);
      await accountConfirm.getByRole("button", { name: "确认提交", exact: true }).click();
      const accountData = await ok<{ id?: string | number }>(await accountResponse);
      accountId = String(accountData.id ?? "");
      temporaryPassword = await readTemporaryPassword(superadmin);
    }
    expect(accountId).toMatch(/^\d+$/);

    const password = `Nx!J4Ck${randomBytes(16).toString("base64url")}Aa9`;
    const totpSecret = await enrollNormalMfa(checker, username, temporaryPassword, password);
    await logout(checker);
    await loginMfa(checker, { username, password, totpSecret }, "j4-dedicated-checker-1");
    const firstSession = await ok<{ session?: { authorities?: string[]; effectiveMenus?: Array<string | { code?: string }> } }>(await checker.request.get("/api/admin/auth/session"));
    expect([...(firstSession.session?.authorities ?? [])].sort()).toEqual([...permissions].sort());
    expect((firstSession.session?.effectiveMenus ?? []).map((x) => typeof x === "string" ? x : x.code)).toEqual(expect.arrayContaining(["J", "J4"]));
    await expect(checker.locator('a[href="/emergency/sop"]')).toBeVisible();
    await logout(checker);
    await loginMfa(checker, { username, password, totpSecret }, "j4-dedicated-checker-2");
    const session = await ok<{ session?: { authorities?: string[]; effectiveMenus?: Array<string | { code?: string }> } }>(await checker.request.get("/api/admin/auth/session"));
    expect([...(session.session?.authorities ?? [])].sort()).toEqual([...permissions].sort());
    expect((session.session?.effectiveMenus ?? []).map((x) => typeof x === "string" ? x : x.code).sort()).toEqual([...menus].sort());
    await checker.screenshot({ path: path.join(evidenceDir, "dedicated-checker-normal-mfa.png"), fullPage: true });

    const current = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
    current.checker = { accountId, username, password, totpSecret, roleCode, authorities: permissions, effectiveMenus: menus, normalMfaVerified: true, loginCycles: 2 };
    current.cleanup = [...(Array.isArray(current.cleanup) ? current.cleanup : []), { accountId, username, roleCode, action: "disable/revoke/reset MFA via visible A1 during final cleanup" }];
    writeFileSync(fixturePath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
    writeFileSync(path.join(evidenceDir, "bootstrap-summary.json"), `${JSON.stringify({ ...evidence, accountId, roleId, roleCreateOperation, grantsOperation, normalMfaCycles: 2, containsSecrets: false, status: "passed" }, null, 2)}\n`, "utf8");
  } finally { await makerContext.close(); await superContext.close(); await checkerContext.close(); }
});

async function loginSuperadminBypass(page: Page) { await page.goto("/", { waitUntil: "domcontentloaded" }); await page.locator('input[autocomplete="username"]').fill("superadmin"); await page.locator('input[autocomplete="current-password"]').fill((process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })())); await page.getByRole("button", { name: /继续|登录/ }).click(); await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 }); }
async function loginMfa(page: Page, account: { username: string; password: string; totpSecret: string }, key: string) { for (let attempt = 0; attempt < 3; attempt += 1) { await page.context().clearCookies(); await page.goto("/", { waitUntil: "domcontentloaded" }); await page.locator('input[autocomplete="username"]').fill(account.username); await page.locator('input[autocomplete="current-password"]').fill(account.password); await page.getByRole("button", { name: /继续|登录/ }).click(); const otp = page.getByLabel("一次性验证码"); await expect(otp).toBeVisible({ timeout: 20_000 }); await otp.fill(await freshTotp(key, account.totpSecret)); const waiting = page.waitForResponse((r) => pathOf(r.url()) === "/api/admin/auth/mfa/verify"); await page.getByRole("button", { name: "验证并进入", exact: true }).click(); const response = await waiting; if (response.status() === 200) { await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 }); return; } await page.waitForTimeout(30_500 - (Date.now() % 30_000)); } throw new Error(`MFA login failed: ${key}`); }
async function enrollNormalMfa(page: Page, user: string, temporary: string, password: string) { await page.goto("/", { waitUntil: "domcontentloaded" }); await page.locator('input[autocomplete="username"]').fill(user); await page.locator('input[autocomplete="current-password"]').fill(temporary); await page.getByRole("button", { name: /继续|登录/ }).click(); const otp = page.getByLabel("一次性验证码"); await expect(otp).toBeVisible({ timeout: 20_000 }); const secret = (await page.locator("code").first().textContent())?.trim() ?? ""; expect(secret).not.toBe(""); await otp.fill(await freshTotp("j4-enroll", secret)); await page.getByRole("button", { name: "验证并进入", exact: true }).click(); await expect(page.getByRole("heading", { name: "首次登录修改密码" })).toBeVisible({ timeout: 20_000 }); await page.getByLabel("新密码", { exact: true }).fill(password); await page.getByLabel("确认新密码", { exact: true }).fill(password); await page.getByRole("button", { name: "确认修改并进入", exact: true }).click(); await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 }); return secret; }
async function nav(page: Page, name: string, url: RegExp) { const link = page.locator("aside").getByRole("link", { name, exact: true }).first(); if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).first().click(); await link.click(); await expect(page).toHaveURL(url); }
async function approve(page: Page, operation: string, reason: string) { await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/); await page.reload({ waitUntil: "domcontentloaded" }); const row = page.locator("tbody tr").filter({ hasText: operation }).first(); await expect(row).toBeVisible({ timeout: 30_000 }); await row.getByRole("button", { name: "执行", exact: true }).click(); const response = await confirmAndWait(page, (r) => r.request().method() === "POST" && pathOf(r.url()) === `/api/admin/platform/audit/operations/${operation}/approve`); await ok(response); }
async function resetFixtureMfa(page: Page, row: ReturnType<Page["locator"]>) { await row.getByRole("button", { name: "重置 2FA", exact: true }).click(); const dialog = page.getByRole("dialog").filter({ has: page.locator('[data-business-form="identity-verify"]') }).last(); await dialog.getByLabel("核验时间 verified at", { exact: true }).fill("2026-08-01T17:30"); await dialog.getByLabel("来源工单号 ticket", { exact: true }).fill("FIXTURE-J4-MFA-RESET-0801"); await dialog.locator('[data-proof="identity-ack"]').check(); await dialog.getByLabel(/操作理由/).fill(`${runId} fixture preparation reset interrupted checker MFA`); const reset = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/admin\/platform\/accounts\/\d+\/reset-2fa$/.test(pathOf(r.url()))); await dialog.getByRole("button", { name: "确认提交", exact: true }).click(); await ok(await reset); }
async function resetFixturePassword(page: Page, row: ReturnType<Page["locator"]>) {
  const accountId = (await row.locator("button").filter({ hasText: "重置密码" }).evaluate((button) => button.closest("tr")?.getAttribute("data-account-id") ?? "").catch(() => "")) || "99645";
  await row.getByRole("button", { name: "重置密码", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.locator('[data-business-form="identity-verify"]') }).last();
  await dialog.getByLabel("核验时间 verified at", { exact: true }).fill("2026-08-01T17:30");
  await dialog.getByLabel("来源工单号 ticket", { exact: true }).fill("FIXTURE-J4-RESET-0801");
  await dialog.locator('[data-proof="identity-ack"]').check();
  await dialog.getByLabel(/操作理由/).fill(`${runId} fixture preparation reset after interrupted bootstrap`);
  const reset = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/admin\/platform\/accounts\/\d+\/password\/reset$/.test(pathOf(r.url())));
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const response = await reset;
  await ok<{ id?: string | number }>(response);
  return accountId;
}
async function readTemporaryPassword(page: Page) { const credentialDialog = page.getByRole("dialog").last(); await expect(credentialDialog.getByText("临时密码", { exact: true })).toBeVisible(); const temporaryPassword = (await credentialDialog.locator(".mono").last().textContent())?.trim() ?? ""; expect(temporaryPassword).not.toBe(""); await credentialDialog.getByText("关闭", { exact: true }).click(); return temporaryPassword; }
async function setMenus(drawer: ReturnType<Page["getByRole"]>, wanted: string[]) { const panel = drawer.getByText("菜单授权（可见性）", { exact: false }).locator("xpath=parent::div"); for (const code of wanted) { const box = panel.getByText(code, { exact: true }).locator("xpath=ancestor::div[contains(@class,'row')][1]").locator('input[type="checkbox"]'); await box.check(); } }
async function confirmAndWait(page: Page, predicate: (r: Response) => boolean) { const pending = page.waitForResponse(predicate); const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) }).last(); await expect(dialog).toBeVisible(); await dialog.getByLabel(/操作理由/).fill(`${runId} visible approval`); await dialog.getByRole("button", { name: "确认提交", exact: true }).click(); return pending; }
async function ok<T>(response: Response | Awaited<ReturnType<Page["request"]["get"]>>) { const payload = await response.json() as Envelope<T>; expect(response.status(), JSON.stringify(payload)).toBe(200); expect(payload.code, JSON.stringify(payload)).toBe(0); return payload.data as T; }
async function logout(page: Page) { await page.request.post("/api/admin/auth/logout").catch(() => undefined); await page.context().clearCookies(); }
const lastStep = new Map<string, number>();
async function freshTotp(key: string, secret: string) { let step = Math.floor(Date.now() / 30_000); if (step <= (lastStep.get(key) ?? -1) || 30_000 - Date.now() % 30_000 < 3_000) await pageWait(30_500 - Date.now() % 30_000); step = Math.floor(Date.now() / 30_000); lastStep.set(key, step); return totp(secret); }
function pageWait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function totp(secret: string) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const bits = secret.replace(/=+$/," ").replace(/\s+/g,"").toUpperCase().split("").map((c) => alphabet.indexOf(c).toString(2).padStart(5,"0")).join(""); const bytes = Buffer.alloc(Math.floor(bits.length / 8)); for(let i=0;i<bytes.length;i+=1) bytes[i]=Number.parseInt(bits.slice(i*8,i*8+8),2); const counter=Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000))); const digest=createHmac("sha1",bytes).update(counter).digest(); const offset=digest[digest.length-1]&15; const value=((digest[offset]&127)<<24)|((digest[offset+1]&255)<<16)|((digest[offset+2]&255)<<8)|(digest[offset+3]&255); return String(value%1_000_000).padStart(6,"0"); }
function pathOf(url: string) { return new URL(url).pathname; }
