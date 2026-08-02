import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Browser, type Page, type Response } from "@playwright/test";

const RUN_ID = "pc-full-acceptance-20260729-114336";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const ROOT_TOTP_SECRET = process.env.ADMIN_E2E_TOTP_SECRET ?? "";
const FIXTURE_DIR = process.env.ADMIN_PERMISSION_FIXTURE_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/domain-permission-fixtures`;
const I_FIXTURE_PATH = process.env.ADMIN_PERMISSION_FIXTURE
  ?? path.join(FIXTURE_DIR, "I.json");
const GLOBAL_FIXTURE_PATH = process.env.GLOBAL_PERMISSION_FIXTURE
  ?? path.join(FIXTURE_DIR, "A.json");
const SAFE_EVIDENCE_PATH = process.env.I6_CHECKER_SAFE_EVIDENCE
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/I/i6-checker-fixture/fixture-safe.json`;
const ROLE_CODE = "ACC_I6_CK_114336";
const USERNAME = "acc_i6_checker_114336";
const PERMISSIONS = ["content_i6_read", "content_i6_write"];
const MENU_CODES = ["I", "I6"];
const OTHER_I_PATHS = [
  "/content/copy-ab",
  "/content/nova",
  "/content/notifications",
  "/content/trust",
  "/content/disclosures",
];

type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type FixtureAccount = {
  id?: string | number;
  accountId?: string;
  username: string;
  password: string;
  totpSecret: string;
};
type Manifest = {
  sensitive: true;
  doNotUpload: true;
  runId: string;
  checker: FixtureAccount & Record<string, unknown>;
  accounts: Record<string, unknown>;
  roles?: Array<Record<string, unknown>>;
  cleanup?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};
type SessionShape = {
  username?: string;
  authorities?: string[];
  menuCodes?: string[];
  effectiveMenus?: Array<string | { menuCode?: string }>;
};

test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "serial", timeout: 600_000 });

test("创建并验证 RunID 专属 I6 最小 checker 角色", async ({ page, browser }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);

  const iManifest = readManifest(I_FIXTURE_PATH);
  const globalManifest = readManifest(GLOBAL_FIXTURE_PATH);
  expect(iManifest.runId).toBe(RUN_ID);
  expect(globalManifest.runId).toBe(RUN_ID);
  const approvalChecker = globalManifest.checker;
  expect(approvalChecker.username).not.toBe(USERNAME);

  await login(page, {
    username: ROOT_USERNAME,
    password: ROOT_PASSWORD,
    totpSecret: ROOT_TOTP_SECRET,
  });
  const approvalPage = await loginInIsolatedContext(browser, approvalChecker);

  const role = await ensureRole(page);
  const { menuIds, grantTicketId } = await ensureExactRoleGrant(
    page,
    approvalPage,
    role.id,
    approvalChecker.username,
  );
  const account = await ensureAccount(page);
  const credentials = await activateDedicatedAccount(page, account.id);
  const checkerPage = await loginInIsolatedContext(browser, credentials);

  await assertExactSession(checkerPage);
  await assertVisibleScope(checkerPage);
  await assertForbiddenScope(checkerPage);

  await checkerPage.reload({ waitUntil: "domcontentloaded" });
  await assertExactSession(checkerPage);
  await assertVisibleScope(checkerPage);

  await logout(checkerPage);
  await loginExistingPage(checkerPage, credentials);
  await assertExactSession(checkerPage);
  await assertVisibleScope(checkerPage);
  await assertForbiddenScope(checkerPage);

  const updated = updateIManifest(iManifest, {
    id: account.id,
    username: USERNAME,
    password: credentials.password,
    totpSecret: credentials.totpSecret,
    role: ROLE_CODE.toLowerCase(),
    authorities: PERMISSIONS,
    effectiveMenus: MENU_CODES,
    purpose: "I6 independent draft CAS editor only",
    status: "verified",
    verifiedAt: new Date().toISOString(),
  }, role.id, menuIds, grantTicketId, approvalChecker.username);
  atomicWriteJson(I_FIXTURE_PATH, updated);
  writeSafeEvidence({
    runId: RUN_ID,
    fixture: "I6 independent checker",
    accountIdHash: hash(account.id),
    usernameHash: hash(USERNAME),
    roleCode: ROLE_CODE,
    authorities: PERMISSIONS,
    effectiveMenus: MENU_CODES,
    denied: {
      otherIRead: 403,
      otherIWrite: 403,
      crossDomainRead: 403,
      approval: 403,
    },
    refreshReloginStable: true,
    grantTicketHash: hash(grantTicketId),
    approvedByHash: hash(approvalChecker.username),
    generatedAt: new Date().toISOString(),
  });

  await Promise.all([
    approvalPage.context().close(),
    checkerPage.context().close(),
  ]);
});

async function ensureRole(page: Page) {
  const overview = await ok<{ roles: Array<{ id: number; roleCode: string }> }>(
    await page.request.get("/api/admin/platform/roles/overview"),
    "roles overview",
  );
  const existing = overview.roles.find((role) => role.roleCode === ROLE_CODE);
  if (existing) return existing;
  return await ok<{ id: number; roleCode: string }>(
    await page.request.post("/api/admin/platform/roles", {
      headers: { "Idempotency-Key": `${RUN_ID}-i6-checker-role-create` },
      data: {
        roleCode: ROLE_CODE,
        roleName: `${RUN_ID} I6 独立编辑员`,
        remark: "仅用于 I6 同版本双运营员 CAS；无审批、解密和跨域权限",
        status: 1,
        reason: `${RUN_ID} 创建 I6 最小独立编辑角色`,
        operator: ROOT_USERNAME,
      },
    }),
    "create I6 checker role",
  );
}

async function ensureExactRoleGrant(
  operatorPage: Page,
  approvalPage: Page,
  roleId: number,
  approvalUsername: string,
) {
  const menus = await ok<{ tree: unknown[] }>(
    await operatorPage.request.get("/api/admin/platform/menus/overview"),
    "menus overview",
  );
  const menuByCode = flattenMenus(menus.tree).reduce<Record<string, number>>((result, row) => {
    if (typeof row.menuCode === "string" && typeof row.id === "number") {
      result[row.menuCode] = row.id;
    }
    return result;
  }, {});
  const menuIds = MENU_CODES.map((code) => {
    expect(menuByCode[code], `missing ${code} menu`).toBeGreaterThan(0);
    return menuByCode[code];
  });
  const detail = await ok<{ permissionCodes?: string[]; menuIds?: number[] }>(
    await operatorPage.request.get(`/api/admin/platform/roles/${roleId}`),
    "I6 checker role detail",
  );
  if (
    sameSet(detail.permissionCodes ?? [], PERMISSIONS)
    && sameSet((detail.menuIds ?? []).map(String), menuIds.map(String))
  ) {
    return { menuIds, grantTicketId: "PREVIOUSLY_APPROVED" };
  }

  const grant = await ok<Record<string, unknown>>(
    await operatorPage.request.put(`/api/admin/platform/roles/${roleId}/grants`, {
      headers: { "Idempotency-Key": `${RUN_ID}-i6-checker-exact-grant` },
      data: {
        permissionCodes: PERMISSIONS,
        menuIds,
        reason: `${RUN_ID} I6 checker 仅授 I6 读写和 I/I6 菜单`,
        operator: ROOT_USERNAME,
      },
    }),
    "propose exact I6 checker grant",
  );
  const grantTicketId = operationId(grant);
  await ok(
    await approvalPage.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(grantTicketId)}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-i6-checker-grant-approve` },
        data: { reason: `${RUN_ID} 独立复核 I6 checker 最小权限` },
      },
    ),
    "approve exact I6 checker grant",
  );
  const after = await ok<{ permissionCodes?: string[]; menuIds?: number[] }>(
    await operatorPage.request.get(`/api/admin/platform/roles/${roleId}`),
    "I6 checker role after approval",
  );
  expect(after.permissionCodes ?? []).toEqual(expect.arrayContaining(PERMISSIONS));
  expect(sameSet(after.permissionCodes ?? [], PERMISSIONS)).toBe(true);
  expect(sameSet((after.menuIds ?? []).map(String), menuIds.map(String))).toBe(true);
  expect(approvalUsername).not.toBe(USERNAME);
  return { menuIds, grantTicketId };
}

async function ensureAccount(page: Page) {
  const accounts = await accountsOverview(page);
  const existing = accounts.find((candidate) => candidate.username === USERNAME);
  const account = existing
    ? { id: String(existing.id) }
    : await ok<{ id: string }>(
        await page.request.post("/api/admin/platform/accounts", {
          headers: { "Idempotency-Key": `${RUN_ID}-i6-checker-account-create` },
          data: {
            username: USERNAME,
            displayName: `${RUN_ID} I6 独立编辑员`,
            email: "i6-checker.114336@nexion.invalid",
            role: ROLE_CODE.toLowerCase(),
            reason: `${RUN_ID} 创建 I6 双运营员 CAS 专属账号`,
            operator: ROOT_USERNAME,
          },
        }),
        "create I6 checker account",
      );
  let current = await accountById(page, account.id);
  if (current.tfa === true) {
    await mutateAccount(page, account.id, "POST", "reset-2fa", {
      reason: `${RUN_ID} 重签 I6 checker 独立 MFA`,
    });
  }
  current = await accountById(page, account.id);
  if (current.role !== ROLE_CODE.toLowerCase()) {
    await mutateAccount(page, account.id, "PATCH", "role", {
      role: ROLE_CODE.toLowerCase(),
      reason: `${RUN_ID} 收敛到 I6 checker 最小角色`,
    });
  }
  current = await accountById(page, account.id);
  if (current.status !== "enabled") {
    await mutateAccount(page, account.id, "PATCH", "status", {
      status: "enabled",
      reason: `${RUN_ID} 启用 I6 checker 隔离账号`,
    });
  }
  return account;
}

async function activateDedicatedAccount(page: Page, accountId: string) {
  const reset = await mutateAccount<{ temporaryPassword?: string }>(
    page,
    accountId,
    "POST",
    "password/reset",
    { reason: `${RUN_ID} 签发 I6 checker 一次性密码` },
  );
  expect(reset.temporaryPassword, "temporary password must be issued").toBeTruthy();
  const password = `Nx!9I6checker${randomBytes(18).toString("base64url")}Aa`;
  await logout(page);
  const totpSecret = await activateFirstLogin(
    page,
    USERNAME,
    reset.temporaryPassword!,
    password,
  );
  await logout(page);
  await loginExistingPage(page, {
    username: ROOT_USERNAME,
    password: ROOT_PASSWORD,
    totpSecret: ROOT_TOTP_SECRET,
  });
  return { username: USERNAME, password, totpSecret };
}

async function assertExactSession(page: Page) {
  const session = await ok<{ session?: SessionShape }>(
    await page.request.get("/api/admin/auth/session"),
    "I6 checker session",
  );
  expect(session.session?.username).toBe(USERNAME);
  const authorities = session.session?.authorities ?? [];
  const effectiveMenus = session.session?.menuCodes
    ?? (session.session?.effectiveMenus ?? []).map((menu) =>
      typeof menu === "string" ? menu : menu.menuCode ?? "").filter(Boolean);
  expect(sameSet(authorities, PERMISSIONS), `unexpected authorities: ${authorities.join(",")}`).toBe(true);
  expect(sameSet(effectiveMenus, MENU_CODES), `unexpected menus: ${effectiveMenus.join(",")}`).toBe(true);
}

async function assertVisibleScope(page: Page) {
  const group = page.getByRole("button", { name: /内容与合规 CMS\s+I|I\s+内容与合规 CMS/ }).first();
  if (await group.isVisible({ timeout: 3_000 }).catch(() => false)) await group.click();
  await expect(page.locator('a[href="/content/i18n"]').first()).toBeVisible();
  for (const route of OTHER_I_PATHS) {
    await expect(page.locator(`a[href="${route}"]`)).toHaveCount(0);
  }
  await expect(page.locator('a[href^="/finance/"],a[href^="/platform/"],a[href^="/risk/"]')).toHaveCount(0);
  await page.locator('a[href="/content/i18n"]').first().click();
  await expect(page).toHaveURL(/\/content\/i18n(?:\?.*)?$/);
  await expect(page.getByRole("button", { name: "新增词条", exact: true })).toBeVisible();
}

async function assertForbiddenScope(page: Page) {
  const probes = [
    await page.request.get("/api/admin/content/copy-ab/overview"),
    await page.request.patch("/api/admin/content/copy-ab/copies/i6-checker-probe/draft", {
      headers: { "Idempotency-Key": `${RUN_ID}-i6-checker-i1-write-probe-${Date.now()}` },
      data: {},
    }),
    await page.request.get("/api/admin/treasury/b-domain"),
    await page.request.post("/api/admin/platform/audit/operations/WO-I6-CHECKER-PROBE/approve", {
      headers: { "Idempotency-Key": `${RUN_ID}-i6-checker-approval-probe-${Date.now()}` },
      data: { reason: `${RUN_ID} 权限拒绝探针` },
    }),
  ];
  expect(probes.map((response) => response.status())).toEqual([403, 403, 403, 403]);
  const i6 = await page.request.get("/api/admin/content/i18n-learning/overview");
  expect(i6.status()).toBe(200);
}

async function loginInIsolatedContext(browser: Browser, account: FixtureAccount) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await loginExistingPage(page, account);
  return page;
}

async function loginExistingPage(page: Page, account: FixtureAccount) {
  await page.context().clearCookies();
  await login(page, account);
}

async function login(page: Page, account: FixtureAccount) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  const shell = page.locator("aside");
  await Promise.race([
    otp.waitFor({ state: "visible", timeout: 12_000 }),
    shell.waitFor({ state: "visible", timeout: 12_000 }),
  ]);
  if (await otp.isVisible().catch(() => false)) {
    expect(account.totpSecret, `TOTP secret required for ${hash(account.username)}`).not.toBe("");
    await otp.fill(await freshTotp(account.totpSecret));
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  }
  await expect(shell).toBeVisible({ timeout: 30_000 });
}

async function activateFirstLogin(
  page: Page,
  username: string,
  temporaryPassword: string,
  finalPassword: string,
) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  let secret = "";
  let passwordChanged = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) break;
    const otp = page.getByLabel("一次性验证码");
    if (await otp.isVisible().catch(() => false)) {
      secret = secret || (await page.locator("code").first().textContent().catch(() => ""))?.trim() || "";
      expect(secret, "I6 checker first login must provide TOTP enrollment secret").not.toBe("");
      await otp.fill(await freshTotp(secret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
    if (!passwordChanged
      && await page.getByRole("heading", { name: "首次登录修改密码" }).isVisible().catch(() => false)) {
      await page.getByLabel("新密码", { exact: true }).fill(finalPassword);
      await page.getByLabel("确认新密码", { exact: true }).fill(finalPassword);
      await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
      passwordChanged = true;
    }
    await page.waitForTimeout(250);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  expect(passwordChanged).toBe(true);
  return secret;
}

async function logout(page: Page) {
  const direct = page.getByRole("button", { name: /^(退出登录|登出)$/ }).first();
  if (await direct.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await direct.click();
  } else {
    const account = page
      .locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]')
      .first();
    await expect(account).toBeVisible();
    await account.click();
    await page.getByText(/退出登录|登出/, { exact: true }).first().click();
  }
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function accountsOverview(page: Page) {
  return (await ok<{ operators: Array<Record<string, unknown>> }>(
    await page.request.get("/api/admin/platform/accounts/overview"),
    "accounts overview",
  )).operators;
}

async function accountById(page: Page, accountId: string) {
  const account = (await accountsOverview(page))
    .find((candidate) => String(candidate.id) === String(accountId));
  expect(account, `I6 checker account hash ${hash(accountId)} must exist`).toBeTruthy();
  return account!;
}

async function mutateAccount<T>(
  page: Page,
  accountId: string,
  method: "PATCH" | "POST",
  suffix: string,
  data: Record<string, unknown>,
) {
  const current = await accountById(page, accountId);
  return await ok<T>(
    await page.request.fetch(`/api/admin/platform/accounts/${accountId}/${suffix}`, {
      method,
      headers: { "Idempotency-Key": `${RUN_ID}-i6-checker-${suffix}-${Date.now()}` },
      data: {
        ...data,
        operator: ROOT_USERNAME,
        expectedVersion: String(current.version),
      },
    }),
    `mutate I6 checker ${suffix}`,
  );
}

function updateIManifest(
  manifest: Manifest,
  checker: Record<string, unknown>,
  roleId: number,
  menuIds: number[],
  grantTicketId: string,
  approvalUsername: string,
): Manifest {
  const roles = (manifest.roles ?? [])
    .filter((role) => role.roleCode !== ROLE_CODE);
  roles.push({
    roleId,
    roleCode: ROLE_CODE,
    permissionCodes: PERMISSIONS,
    menuIds,
    grantTicketId,
    grantApprovedByHash: hash(approvalUsername),
  });
  const cleanup = (manifest.cleanup ?? [])
    .filter((row) => row.fixturePurpose !== "I6 independent checker");
  cleanup.push({
    accountId: checker.id,
    usernameHash: hash(checker.username),
    role: ROLE_CODE.toLowerCase(),
    fixturePurpose: "I6 independent checker",
    action: "fresh CAS: disable, revoke sessions, reset 2FA; then delete run-scoped role",
  });
  return {
    ...manifest,
    checker: checker as Manifest["checker"],
    roles,
    cleanup,
    updatedAt: new Date().toISOString(),
  };
}

function readManifest(filePath: string): Manifest {
  return JSON.parse(readFileSync(filePath, "utf8")) as Manifest;
}

function atomicWriteJson(filePath: string, value: unknown) {
  const temporary = `${filePath}.i6-checker-${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
}

function writeSafeEvidence(value: unknown) {
  mkdirSync(path.dirname(SAFE_EVIDENCE_PATH), { recursive: true });
  writeFileSync(SAFE_EVIDENCE_PATH, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function flattenMenus(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    const wrapper = node as Record<string, unknown>;
    const row = wrapper.node && typeof wrapper.node === "object" && !Array.isArray(wrapper.node)
      ? wrapper.node as Record<string, unknown>
      : wrapper;
    return [row, ...flattenMenus(wrapper.children ?? row.children)];
  });
}

function sameSet(left: string[], right: string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function operationId(value: Record<string, unknown>) {
  const id = String(value.operationId ?? value.id ?? "");
  expect(id).toMatch(/^(?:WO|OP)-/);
  return id;
}

async function ok<T>(response: APIResponse | Response, label: string) {
  const body = await response.json().catch(() => null) as Envelope<T> | null;
  expect(response.status(), `${label}: HTTP ${response.status()} ${body?.message ?? ""}`).toBeLessThan(400);
  expect(body?.code ?? 0, `${label}: ${body?.message ?? "invalid envelope"}`).toBe(0);
  return body?.data as T;
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) =>
      setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) {
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  }
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  return currentTotp(secret, step);
}

function currentTotp(secret: string, step: number) {
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
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

function hash(value: unknown) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 12);
}
