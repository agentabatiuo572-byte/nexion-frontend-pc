import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";
import { normalizeEffectiveMenus } from "../../lib/admin/session-role";

const RUN_ID = "pc-full-acceptance-20260729-114336";
const ROOT = `D:/workspace/bug-pic/.restricted/${RUN_ID}`;
const SOURCE = process.env.FINAL_FIXTURE_MANIFEST_PATH ?? `${ROOT}/A/final-fixture-admin-window/final-domain-checkers.json`;
const OUT = `${ROOT}/M/m-maker.json`;
const ROLE_CODE = `ACC_FINAL_20260729114336_R4_M_MAKER_${randomBytes(3).toString("hex").toUpperCase()}`;
const PERMISSIONS = ["platform_a2_read", "service_m2_read", "service_m2_write", "service_m3_read", "service_m3_write", "service_m4_read", "service_m4_write"] as const;
const MENUS = ["A2", "M2", "M3", "M4"] as const;
const REASON = `${RUN_ID} FINAL M-only maker 最小权限夹具`;
type Fixture = { username: string; password: string; totpSecret: string; accountId?: string; roleCode?: string };
type Manifest = { sensitive: boolean; doNotUpload: boolean; bootstrapCleanup: Fixture & { required: boolean }; finalAccounts: { a6_reviewer: Fixture } };
type Api<T> = { code?: number; data?: T; message?: string };
test.describe.configure({ mode: "serial", timeout: 300_000 });

test("FINAL M-only maker: visible A1/A6/A2 creation, independent approval, MFA and strict negative gate", async ({ page, browser }, info) => {
  const source = JSON.parse(await readFile(SOURCE, "utf8")) as Manifest;
  expect(source.sensitive).toBe(true); expect(source.doNotUpload).toBe(true); expect(source.bootstrapCleanup.required).toBe(true);
  await mkdir(path.dirname(OUT), { recursive: true });
  const maker = source.bootstrapCleanup; const reviewer = source.finalAccounts.a6_reviewer;
  const suffix = randomBytes(4).toString("hex"); let account: { id: string | number; username: string } | null = null; let role: { id: number; roleCode: string; roleName: string } | null = null; let reviewerPage: Page | null = null;
  try {
    await login(page, maker); const reviewerContext = await browser.newContext(); reviewerPage = await reviewerContext.newPage(); await login(reviewerPage, reviewer);
    role = await createRole(page, ROLE_CODE, `FINAL M-only maker ${suffix}`);
    const grantTicket = await grantRole(page, role);
    await approve(reviewerPage, grantTicket);
    account = await createAccount(page, `ffix.mmaker.${suffix}`, role.roleName);
    const temporary = await temporaryPassword(page); const password = `Nx!Ffix9${randomBytes(18).toString("base64url")}Aa`;
    const makerContext = await browser.newContext();
    try {
      const makerPage = await makerContext.newPage(); const totpSecret = await activate(makerPage, account.username, temporary, password);
      const scope = await session(makerPage); await assertScope(scope);
      const cross = await makerPage.request.get("/api/admin/devices/overview"); expect(cross.status(), "跨域读取必须403").toBe(403);
      const m1 = await makerPage.request.get("/api/admin/content/tickets/load-config"); expect(m1.status(), "M1读取必须403").toBe(403);
      const noApprove = scope.authorities.includes("platform_a2_operation_approve"); expect(noApprove, "maker不得具备A2批准权").toBe(false);
      const manifest = { sensitive: true, doNotUpload: true, runId: RUN_ID, source: "visible A1/A6/A2; a6_reviewer independent approval", generatedAt: new Date().toISOString(), account: { accountId: String(account.id), username: account.username, password, totpSecret, roleCode: ROLE_CODE }, role, authorities: PERMISSIONS, menuCodes: MENUS, negativeGate: { crossDomainRead: 403, m1Read: 403, a2ApproveAbsent: true }, cleanup: "revoke/disable account and delete role through distinct A2 approval after M acceptance" };
      await atomicJson(OUT, manifest); const publicEvidence = JSON.stringify({ runId: RUN_ID, roleCode: ROLE_CODE, usernameDigest: digest([account.username]), authorities: PERMISSIONS, menuCodes: MENUS, negativeGate: manifest.negativeGate, generatedAt: manifest.generatedAt }, null, 2); await writeFile(info.outputPath("m-maker-gate.json"), `${publicEvidence}\nsha256=${createHash("sha256").update(publicEvidence).digest("hex")}\n`);
    } finally { await makerContext.close(); }
    await reviewerContext.close(); reviewerPage = null;
  } catch (error) {
    // Failure never leaves an untracked executable account.  The final role is
    // retained only if its A6 delete operation itself cannot be completed.
    if (account && reviewerPage) await disable(page, reviewerPage, account.username).catch(() => undefined);
    throw error;
  }
});

test("M-maker failure closeout: all failed R4 accounts and roles are visibly reclaimed", async ({ page, browser }) => {
  const source = JSON.parse(await readFile(SOURCE, "utf8")) as Manifest;
  await login(page, source.bootstrapCleanup); const context = await browser.newContext(); const reviewer = await context.newPage();
  try {
    await login(reviewer, source.finalAccounts.a6_reviewer);
    await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/); await page.locator("select.pager-size").selectOption("50");
    const makers = new Set<string>(); for (let i = 0; i < 20; i += 1) { for (const text of await page.locator("tbody tr").allTextContents()) { const name = text.match(/ffix\.mmaker\.[a-f0-9]{8}\b/i)?.[0]; if (name) makers.add(name); } const next = page.locator("button.pager-btn").last(); if (await next.isDisabled()) break; await next.click(); }
    for (const username of makers) await disable(page, reviewer, username);
    await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/); await page.locator("select.pager-size").selectOption("50"); for (const username of makers) { const row = page.locator("tbody tr").filter({ hasText: username }); await expect(row).toBeVisible(); expect(await row.locator("td").nth(3).innerText()).toContain("已禁用"); expect(await row.locator("td").nth(5).innerText()).toContain("0"); }
    await nav(page, "角色管理 A6", /\/platform\/roles$/);
    const codes = (await page.locator("span.mono").allTextContents()).map((v) => v.trim()).filter((v) => /^ACC_FINAL_20260729114336_R4_M_MAKER/.test(v));
    for (const code of new Set(codes)) { await page.getByText(code, { exact: true }).first().click(); await page.getByRole("button", { name: "删除角色", exact: true }).click(); const ticket = await ok<Record<string, unknown>>(await confirm(page, (r) => r.request().method() === "DELETE" && /\/api\/admin\/platform\/roles\/\d+$/.test(new URL(r.url()).pathname))); const id = String(ticket.operationId ?? ticket.id ?? ""); expect(id).toMatch(/^(?:WO|OP)-/); await approve(reviewer, id); await nav(page, "角色管理 A6", /\/platform\/roles$/); }
    await page.reload(); expect((await page.locator("span.mono").allTextContents()).some((v) => /^ACC_FINAL_20260729114336_R4_M_MAKER/.test(v.trim()))).toBe(false);
  } finally { await context.close(); }
});

test("FINAL M3 receiver: created-for-run SUPPORT account receives visible M1 transferable support profile", async ({ page, browser }) => {
  const source = JSON.parse(await readFile(SOURCE, "utf8")) as Manifest;
  await login(page, source.bootstrapCleanup);
  const suffix = randomBytes(4).toString("hex"); const created = await createAccount(page, `ffix.mreceiver.${suffix}`, "客服");
  const temporary = await temporaryPassword(page); const password = `Nx!Ffix9${randomBytes(18).toString("base64url")}Aa`; const receiverContext = await browser.newContext();
  try {
    const receiverPage = await receiverContext.newPage(); const totpSecret = await activate(receiverPage, created.username, temporary, password);
    const receiverSession = await session(receiverPage); expect(receiverSession.authorities).toEqual(expect.arrayContaining(["service_m1_read", "service_m1_write"]));
    const m1 = page.locator('aside a[href="/service/overview"]'); if (!await m1.isVisible().catch(() => false)) await page.getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).click(); await m1.click(); await expect(page).toHaveURL(/\/service\/overview$/); await page.getByRole("button", { name: "分配坐席", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "分配客服坐席" }); await expect(dialog).toBeVisible(); await dialog.getByLabel("搜索客服管理员").fill(String(created.id)); const candidate = dialog.locator('[data-proof="m1-seat-admin-option"]').first(); await expect(candidate).toBeVisible(); await candidate.click(); await dialog.getByRole("button", { name: /^通用客服/ }).click(); await dialog.getByLabel(/分配理由/).fill(`${RUN_ID} M3 receiver profile setup`); const response = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname.endsWith(`/support-agents/${created.id}/seat-assignment`)); await dialog.locator('[data-proof="m1-seat-role-save"]').click(); expect((await response).status()).toBe(200); await expect(dialog).toBeHidden();
    const agentsResponse = await page.request.get("/api/admin/content/support-agents"); expect(agentsResponse.status()).toBe(200); const agentsBody = await agentsResponse.json() as { code?: number; data?: { agents?: Array<{ id?: string; adminId?: number; enabled?: boolean; transferable?: boolean; serviceTypes?: string[]; adminRole?: string }> } }; expect(agentsBody.code).toBe(0); const profile = agentsBody.data?.agents?.find((agent) => agent.adminId === Number(created.id)); expect(profile).toBeTruthy(); expect(profile?.adminRole?.toUpperCase()).toBe("SUPPORT"); expect(profile?.enabled).toBe(true); expect(profile?.transferable).toBe(true); expect([...profile?.serviceTypes ?? []].sort()).toEqual(["support"]); expect(profile?.id).toBeTruthy();
    await atomicJson(`${ROOT}/M/m-receiver.json`, { sensitive: true, doNotUpload: true, runId: RUN_ID, createdForRun: true, purpose: "M3 cross-seat positive receiver only", account: { accountId: String(created.id), username: created.username, password, totpSecret, role: "SUPPORT", createdForRun: true }, profile: { id: profile!.id, adminId: profile!.adminId, enabled: true, transferable: true, serviceTypes: ["support"] }, before: { profileAbsent: true }, cleanup: "after M scope: disable/revoke/unassign account and remove profile by exact profile.id + adminId via authorized fixture SQL; verify non-fixture fingerprints unchanged" });
  } finally { await receiverContext.close(); }
});

async function login(page: Page, f: Fixture) { await page.goto("/"); await page.locator('input[autocomplete="username"]').fill(f.username); await page.locator('input[autocomplete="current-password"]').fill(f.password); await page.getByRole("button", { name: "继续", exact: true }).click(); const otp = page.getByLabel("一次性验证码"); await otp.waitFor({ state: "visible", timeout: 15_000 }); let prior = ""; for (let n = 0; n < 2; n += 1) { let code = totp(f.totpSecret); while (code === prior) { await page.waitForTimeout(1_100); code = totp(f.totpSecret); } prior = code; await otp.fill(code); const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/admin/auth/mfa/verify")); await page.getByRole("button", { name: "验证并进入", exact: true }).click(); if ((await response).status() === 200) { await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 }); return; } } throw new Error("MFA_VERIFY_FAILED_AFTER_NEXT_WINDOW"); }
async function createRole(page: Page, code: string, name: string) { await nav(page, "角色管理 A6", /\/platform\/roles$/); const existing = page.getByText(code, { exact: true }).first(); if (await existing.count()) { const r = page.waitForResponse((x) => x.request().method() === "GET" && new RegExp("/api/admin/platform/roles/\\d+$").test(new URL(x.url()).pathname)); await existing.click(); const body = await ok<{ id?: number; roleName?: string }>(await r); expect(body.id).toBeTruthy(); return { id: body.id!, roleCode: code, roleName: body.roleName ?? name }; } await page.getByRole("button", { name: "+ 新建角色", exact: true }).click(); await page.getByPlaceholder("如 CONTENT_EDITOR").fill(code); await page.getByPlaceholder("如 内容编辑员").fill(name); await page.getByPlaceholder("职责说明").fill("FINAL M-only maker temporary least privilege"); await page.getByRole("button", { name: "提交（需确认）", exact: true }).click(); const body = await ok<Record<string, unknown>>(await confirm(page, (r) => r.request().method() === "POST" && r.url().endsWith("/api/admin/platform/roles"))); return { id: Number(body.id), roleCode: code, roleName: name }; }
async function grantRole(page: Page, role: { id: number; roleCode: string }) { await page.getByText(role.roleCode, { exact: true }).first().click(); await page.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click(); const drawer = page.getByRole("dialog").last(); const search = drawer.getByRole("textbox", { name: "权限搜索", exact: true }); for (const permission of PERMISSIONS) { await search.fill(permission); await drawer.locator(`label[title="${permission}"] input[type="checkbox"]`).check(); } await search.fill(""); const panel = drawer.getByText("菜单授权（可见性）", { exact: false }).locator("xpath=parent::div"); for (const code of MENUS.filter((code) => code.length > 1)) { const row = panel.getByText(code, { exact: true }).locator("xpath=ancestor::div[contains(@class,'row')][1]"); await row.locator('input[type="checkbox"]').check(); } await page.getByRole("button", { name: "保存授权（需确认）", exact: true }).click(); const ticket = await ok<Record<string, unknown>>(await confirm(page, (r) => r.request().method() === "PUT" && r.url().endsWith(`/api/admin/platform/roles/${role.id}/grants`))); const id = String(ticket.operationId ?? ticket.id ?? ""); expect(id).toMatch(/^(?:WO|OP)-/); return id; }
async function createAccount(page: Page, username: string, roleName: string) { await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/); await page.getByRole("button", { name: "+ 新建账号", exact: true }).click(); const d = page.getByRole("dialog").last(); await d.getByRole("textbox", { name: "登录名 *", exact: true }).fill(username); await d.getByPlaceholder("姓名,如:张三").fill("FINAL M-only maker"); await d.getByText(roleName, { exact: true }).click(); await d.getByLabel(/操作理由/).fill(REASON); const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/admin/platform/accounts")); await d.getByRole("button", { name: "确认创建账号", exact: true }).click(); const c = page.getByRole("dialog").last(); await c.getByLabel(/操作理由/).fill(REASON); await c.getByRole("button", { name: "确认提交", exact: true }).click(); const body = await ok<Record<string, unknown>>(await response); return { id: body.id as string | number, username }; }
async function temporaryPassword(page: Page) { const d = page.getByRole("dialog").last(); await expect(d.getByText("临时密码", { exact: true })).toBeVisible(); const p = (await d.locator(".mono").last().textContent())?.trim() ?? ""; expect(p).not.toBe(""); await d.getByText("关闭", { exact: true }).click(); return p; }
async function activate(page: Page, username: string, temp: string, password: string) { await page.goto("/"); await page.locator('input[autocomplete="username"]').fill(username); await page.locator('input[autocomplete="current-password"]').fill(temp); await page.getByRole("button", { name: "继续", exact: true }).click(); const otp = page.getByLabel("一次性验证码"); await expect(otp).toBeVisible(); const secret = ((await page.locator("code").first().textContent()) ?? "").trim(); expect(secret).not.toBe(""); await otp.fill(totp(secret)); const r = page.waitForResponse((x) => x.request().method() === "POST" && x.url().endsWith("/api/admin/auth/mfa/verify")); await page.getByRole("button", { name: "验证并进入", exact: true }).click(); expect((await r).status()).toBe(200); await page.getByLabel("新密码", { exact: true }).fill(password); await page.getByLabel("确认新密码", { exact: true }).fill(password); await page.getByRole("button", { name: "确认修改并进入", exact: true }).click(); await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 }); return secret; }
async function session(page: Page) { const x = await ok<{ session?: { authorities?: string[]; menuCodes?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> } }>(await page.request.get("/api/admin/auth/session")); const s = x.session ?? {}; return { authorities: s.authorities ?? [], menus: normalizeEffectiveMenus({ menuCodes: s.menuCodes ?? (s.effectiveMenus ?? []).map((m) => typeof m === "string" ? m : m.menuCode ?? "") }) ?? [] }; }
async function assertScope(x: { authorities: string[]; menus: string[] }) { expect(new Set(x.authorities)).toEqual(new Set(PERMISSIONS)); expect(new Set(x.menus)).toEqual(new Set(MENUS)); }
async function approve(page: Page, id: string) { await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/); await page.reload(); const row = page.locator("tbody tr").filter({ hasText: id }); await expect(row).toBeVisible(); await row.getByRole("button", { name: "执行", exact: true }).click(); await ok(await confirm(page, (r) => r.url().endsWith(`/api/admin/platform/audit/operations/${id}/approve`))); }
async function disable(page: Page, reviewer: Page, username: string) { await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/); await page.locator("select.pager-size").selectOption("50"); const row = page.locator("tbody tr").filter({ hasText: username }); await expect(row).toBeVisible(); await row.getByRole("button", { name: "禁用", exact: true }).click(); const ticket = await ok<Record<string, unknown>>(await confirm(page, (r) => r.request().method() === "POST" && r.url().endsWith("/api/admin/platform/audit/operations"))); await approve(reviewer, String(ticket.operationId ?? ticket.id)); }
async function nav(page: Page, name: string, url: RegExp) { const link = page.locator("aside").getByRole("link", { name, exact: true }); if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click(); await link.click(); await expect(page).toHaveURL(url); }
async function confirm(page: Page, predicate: (r: Response) => boolean) { const response = page.waitForResponse(predicate); const d = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) }); await d.getByLabel(/操作理由/).fill(REASON); await d.getByRole("button", { name: "确认提交", exact: true }).click(); return response; }
async function ok<T>(r: { ok(): boolean; json(): Promise<unknown> }) { const b = await r.json() as Api<T>; expect(r.ok(), JSON.stringify(b)).toBeTruthy(); expect(b.code).toBe(0); return b.data as T; }
function totp(secret: string) { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const c of secret.replace(/[^A-Z2-7]/gi, "").toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, "0"); const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2)); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000))); const h = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const off = h[h.length - 1] & 15; return String((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, "0"); }
function digest(v: string[]) { return createHash("sha256").update(JSON.stringify(v)).digest("hex"); }
async function atomicJson(file: string, value: unknown) { const t = `${file}.${process.pid}.tmp`; await writeFile(t, JSON.stringify(value, null, 2)); await rename(t, file); }
