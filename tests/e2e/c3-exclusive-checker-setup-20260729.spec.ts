import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

const RUN_ID = process.env.C3_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const FIXTURE_PATH = process.env.C3_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/domain-permission-fixtures/C.json`;
const GLOBAL_CHECKER_PATH = process.env.C3_GLOBAL_CHECKER_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures/permission-fixtures.json`;
const EVIDENCE_DIR = process.env.C3_SETUP_EVIDENCE_DIR;
const ROLE_CODE = `ACC_C3_REVIEW_${RUN_ID.slice(-6)}`.toUpperCase();
const PERMISSIONS = ["user_c3_read", "user_c3_adjust_approve", "user_c3_adjust_reverse"];
const MENU_CODES = ["C", "C3"];

type Account = { accountId: string; username: string; password: string; totpSecret: string; role?: string; authorities?: string[]; effectiveMenus?: string[] };
type Envelope<T> = { code?: number; message?: string; data?: T };

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("C3 创建最小独立复核员并原子更新 C manifest", async ({ page, browser }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  const manifest = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, any>;
  expect(manifest.runId).toBe(RUN_ID);
  const genericChecker = (JSON.parse(readFileSync(GLOBAL_CHECKER_PATH, "utf8")) as { checker?: Account }).checker;
  expect(genericChecker?.username && genericChecker.password && genericChecker.totpSecret, "same-run global checker").toBeTruthy();

  await loginRoot(page);
  const menuOverview = await ok<{ tree: unknown[] }>(await page.request.get("/api/admin/platform/menus/overview"));
  const menuMap = flatten(menuOverview.tree).reduce<Record<string, number>>((result, row) => {
    if (typeof row.menuCode === "string" && typeof row.id === "number") result[row.menuCode] = row.id;
    return result;
  }, {});
  const menuIds = MENU_CODES.map((code) => {
    expect(menuMap[code], `missing ${code} menu`).toBeGreaterThan(0);
    return menuMap[code];
  });
  const roles = await ok<{ roles: Array<{ id: number; roleCode: string; roleName?: string; remark?: string }> }>(
    await page.request.get("/api/admin/platform/roles/overview"),
  );
  const role = roles.roles.find((item) => item.roleCode === ROLE_CODE)
    ?? await ok<{ id: number; roleCode: string }>(await page.request.post("/api/admin/platform/roles", {
      headers: keyed(`${RUN_ID}:c3-review-role:create`),
      data: {
        roleCode: ROLE_CODE,
        roleName: `${RUN_ID} C3 独立冲正复核员`,
        remark: `${RUN_ID} C3-only, no create/maker or cross-domain authorities`,
        status: 1,
        reason: `${RUN_ID} create C3 exclusive checker role`,
        operator: ROOT_USERNAME,
      },
    }));
  const detail = await ok<{ permissionCodes?: string[]; menuIds?: number[] }>(
    await page.request.get(`/api/admin/platform/roles/${role.id}`),
  );
  let ticket = "";
  if (!sameSet(detail.permissionCodes ?? [], PERMISSIONS) || !sameSet((detail.menuIds ?? []).map(String), menuIds.map(String))) {
    const proposed = await ok<Record<string, unknown>>(await page.request.put(`/api/admin/platform/roles/${role.id}/grants`, {
      headers: keyed(`${RUN_ID}:c3-review-role:${role.id}:grant`),
      data: { permissionCodes: PERMISSIONS, menuIds, reason: `${RUN_ID} exact C3 checker grants`, operator: ROOT_USERNAME },
    }));
    ticket = String(proposed.operationId ?? proposed.id ?? "");
    expect(ticket).toMatch(/^(?:WO|OP)-/);
  }
  await logout(page);
  if (ticket) await approve(browser, genericChecker!, ticket);

  await loginRoot(page);
  const username = `acc_c3rv_${randomBytes(5).toString("hex")}`.slice(0, 32);
  const created = await ok<{ id: string | number; temporaryPassword?: string }>(await page.request.post("/api/admin/platform/accounts", {
    headers: keyed(`${RUN_ID}:c3-reviewer:${username}:create`),
    data: {
      username,
      displayName: `${RUN_ID} C3 exclusive checker`,
      email: `${username}@nexion.invalid`,
      role: ROLE_CODE.toLowerCase(),
      reason: `${RUN_ID} C3 isolated checker with reverse/approve only`,
      operator: ROOT_USERNAME,
    },
  }));
  expect(created.temporaryPassword).toBeTruthy();
  await logout(page);

  const checker: Account = {
    accountId: String(created.id), username,
    password: `Nx!9C3Rv${randomBytes(18).toString("base64url")}Aa`, totpSecret: "", role: ROLE_CODE.toLowerCase(),
  };
  checker.totpSecret = await activate(page, checker.username, created.temporaryPassword!, checker.password);
  const session = await ok<{ session?: { authorities?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> } }>(
    await page.request.get("/api/admin/auth/session"),
  );
  checker.authorities = session.session?.authorities ?? [];
  checker.effectiveMenus = (session.session?.effectiveMenus ?? []).map((item) => typeof item === "string" ? item : item.menuCode ?? "").filter(Boolean);
  expect(sameSet(checker.authorities, PERMISSIONS), "checker exact authority set").toBe(true);
  expect(sameSet(checker.effectiveMenus, MENU_CODES), "checker exact menu set").toBe(true);

  const noCreate = await page.request.post(`/api/admin/users/profiles/${process.env.C3_TARGET_ID}/asset-adjustments`, {
    headers: keyed(`${RUN_ID}:c3-checker:no-create`),
    data: { asset: "USDT", direction: "CREDIT", amount: "0.01", reasonCode: "SYSTEM_CORRECTION", reason: "must be rejected before validation", evidenceRef: RUN_ID },
  });
  expect(noCreate.status()).toBe(403);
  await logout(page);

  const accounts = manifest.accounts as Record<string, Account>;
  expect(accounts.maker, "C maker fixture is required").toBeTruthy();
  expect((accounts.maker.authorities ?? []).includes("user_c3_adjust_approve"), "maker must not self-approve").toBe(false);
  expect((accounts.maker.authorities ?? []).includes("user_c3_adjust_create"), "maker must create").toBe(true);
  manifest.checker = checker;
  manifest.c3ExclusiveChecker = { roleId: role.id, roleCode: ROLE_CODE, permissions: PERMISSIONS, menuIds, createdAt: new Date().toISOString() };
  manifest.cleanup = [...(Array.isArray(manifest.cleanup) ? manifest.cleanup : []), {
    accountId: checker.accountId, roleId: role.id, roleCode: ROLE_CODE,
    action: "retain until all C consumers finish; then revoke sessions, reset MFA, unassign/disable account, and delete role through independent A6 approval",
  }];
  atomicJson(FIXTURE_PATH, manifest);
  if (EVIDENCE_DIR) atomicJson(path.join(EVIDENCE_DIR, "c3-exclusive-checker-safe.json"), {
    runId: RUN_ID, roleId: role.id, roleCode: ROLE_CODE, permissions: PERMISSIONS, menuCodes: MENU_CODES,
    checkerAccountId: checker.accountId, noCreateStatus: noCreate.status(), makerSelfApproveAuthority: false,
  });
});

async function approve(browser: Browser, checker: Account, ticket: string) {
  const context = await browser.newContext({ baseURL: BASE_URL }); const page = await context.newPage();
  try { await loginMfa(page, checker); await ok(await page.request.post(`/api/admin/platform/audit/operations/${ticket}/approve`, {
    headers: keyed(`${RUN_ID}:c3-review-role:${ticket}:approve`), data: { reason: `${RUN_ID} independent approval of exact C3 checker grant` },
  })); } finally { await context.close(); }
}
async function loginRoot(page: Page) { await page.goto(BASE_URL, { waitUntil: "domcontentloaded" }); if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return; await page.locator('input[autocomplete="username"]').fill(ROOT_USERNAME); await page.locator('input[autocomplete="current-password"]').fill(ROOT_PASSWORD); await page.getByRole("button", { name: /登录|继续/ }).click(); await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 }); }
async function loginMfa(page: Page, account: Account) { await page.goto(BASE_URL, { waitUntil: "domcontentloaded" }); await page.locator('input[autocomplete="username"]').fill(account.username); await page.locator('input[autocomplete="current-password"]').fill(account.password); await page.getByRole("button", { name: /登录|继续/ }).click(); const otp = page.getByLabel("一次性验证码"); await expect(otp).toBeVisible({ timeout: 15_000 }); await otp.fill(await freshTotp(account.totpSecret)); await page.getByRole("button", { name: "验证并进入", exact: true }).click(); await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 }); }
async function activate(page: Page, username: string, temporaryPassword: string, password: string) { await page.goto(BASE_URL, { waitUntil: "domcontentloaded" }); await page.locator('input[autocomplete="username"]').fill(username); await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword); const response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/api/admin/auth/login"); await page.getByRole("button", { name: /登录|继续/ }).click(); const payload = await (await response).json() as { data?: { mfa?: { manualKey?: string } } }; const secret = payload.data?.mfa?.manualKey?.trim() ?? ""; expect(secret, "new checker TOTP secret").not.toBe(""); await expect(page.getByRole("heading", { name: "首次登录修改密码" })).toBeVisible({ timeout: 15_000 }); await page.getByLabel("新密码", { exact: true }).fill(password); await page.getByLabel("确认新密码", { exact: true }).fill(password); await page.getByRole("button", { name: "确认修改并进入", exact: true }).click(); const otp = page.getByLabel("一次性验证码"); await expect(otp).toBeVisible({ timeout: 15_000 }); await otp.fill(await freshTotp(secret)); await page.getByRole("button", { name: "验证并进入", exact: true }).click(); await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 }); return secret; }
async function logout(page: Page) { const account = page.locator('header button[aria-haspopup="menu"]').last(); await account.click(); await page.getByRole("button", { name: "退出登录", exact: true }).click(); await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 }); }
function keyed(key: string) { return { "Content-Type": "application/json", "Idempotency-Key": key }; }
function flatten(value: unknown): Array<Record<string, unknown>> { if (!Array.isArray(value)) return []; return value.flatMap((entry) => { if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []; const wrapper = entry as Record<string, unknown>; const node = wrapper.node && typeof wrapper.node === "object" && !Array.isArray(wrapper.node) ? wrapper.node as Record<string, unknown> : wrapper; return [node, ...flatten(wrapper.children ?? node.children)]; }); }
function sameSet(left: string[], right: string[]) { const a = [...new Set(left)].sort(); const b = [...new Set(right)].sort(); return a.length === b.length && a.every((value, index) => value === b[index]); }
function atomicJson(file: string, value: unknown) { const temporary = `${file}.${process.pid}.tmp`; writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); renameSync(temporary, file); }
async function ok<T>(response: { status(): number; text(): Promise<string> }) { const raw = await response.text(); expect(response.status(), raw).toBeLessThan(400); const payload = JSON.parse(raw) as Envelope<T>; expect(payload.code ?? 0, raw).toBe(0); return payload.data as T; }
let lastStep = -1;
async function freshTotp(secret: string) { let step = Math.floor(Date.now() / 30_000); if (step <= lastStep) await new Promise((resolve) => setTimeout(resolve, ((lastStep + 1) * 30_000) - Date.now() + 500)); const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30); if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000)); step = Math.floor(Date.now() / 30_000); lastStep = step; const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase(); let bits = ""; for (const character of normalized) { const index = alphabet.indexOf(character); if (index < 0) throw new Error("Invalid base32 TOTP secret"); bits += index.toString(2).padStart(5, "0"); } const bytes = Buffer.alloc(Math.floor(bits.length / 8)); for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2); const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(step)); const digest = createHmac("sha1", bytes).update(message).digest(); const offset = digest[digest.length - 1] & 0x0f; const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff); return String(binary % 1_000_000).padStart(6, "0"); }
