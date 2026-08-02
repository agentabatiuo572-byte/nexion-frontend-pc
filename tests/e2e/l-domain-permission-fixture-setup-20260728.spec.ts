import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const RUN_ID = process.env.L_PERMISSION_RUN_ID ?? "pc-full-acceptance-20260728-151023";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const ROOT_TOTP_SECRET = process.env.ADMIN_E2E_TOTP_SECRET?.trim() ?? "";
const CHECKER_FIXTURE_PATH = process.env.L_PERMISSION_CHECKER_FIXTURE
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`;
const FIXTURE_PATH = process.env.L_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/L/permission-fixtures.json`;
const CARRIER_EVIDENCE_DIR = process.env.L_PERMISSION_CARRIER_EVIDENCE
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/L/final11-owner/carrier-repair-2";
const RESTRICTED_EVIDENCE_ROOT = path.resolve("D:/workspace/bug-pic/.restricted");
const SUFFIX = process.env.L_PERMISSION_SUFFIX ?? randomBytes(3).toString("hex");
const READ_ROLE_CODE = `ACC_L_RO_R151023_${SUFFIX}`.toUpperCase();
const OWNER_ROLE_CODE = `ACC_L_OWNER_R151023_${SUFFIX}`.toUpperCase();
const READ_PERMISSIONS = Array.from({ length: 6 }, (_, index) => `bi_l${index + 1}_read`);
const OWNER_PERMISSIONS = [
  ...READ_PERMISSIONS,
  "bi_l1_write",
  "bi_l2_write",
  "bi_l3_write",
  "bi_l3_export_detail",
  "bi_l4_write",
  "bi_l4_export_tree",
  "bi_l5_write",
  "bi_l5_regulatory_generate",
  "bi_l6_export",
  "platform_a2_read",
  "platform_a2_proposal_create",
];
const MENU_CODES = ["L", "L1", "L2", "L3", "L4", "L5", "L6"];

type AccountKey = "l_owner" | "l_readonly" | "l_no_write" | "l_no_menu";
type FixtureAccount = {
  accountId: string;
  username: string;
  password: string;
  totpSecret: string;
  role: string;
  profile: "owner" | "readonly" | "menu_no_write" | "no_menu";
  authorities: string[];
  effectiveMenus: string[];
};
type CheckerFixture = {
  accounts: { d_checker: { username: string; password: string; totpSecret: string } };
};
type ApiEnvelope<T> = { code?: number; message?: string; data?: T };

const MFA_CHALLENGE_TIMEOUT_MS = 15_000;
const MFA_RESPONSE_TIMEOUT_MS = 20_000;
const MAX_MFA_RECOVERY_ATTEMPTS = 2;
const TOTP_STEP_MS = 30_000;
const TOTP_BOUNDARY_BUFFER_MS = 3_000;
const TOTP_FRESH_TIMEOUT_MS = 35_000;

test.describe.configure({ mode: "serial", timeout: 300_000 });
test.use({ trace: "off", video: "off", screenshot: "off" });
test.beforeAll(() => {
  assertRestrictedCarrierPath(CARRIER_EVIDENCE_DIR, "L carrier evidence");
  mkdirSync(CARRIER_EVIDENCE_DIR, { recursive: true });
});
test.beforeEach(async ({}, testInfo) => {
  assertRestrictedCarrierPath(testInfo.outputDir, "L Playwright output");
});

test("L fixture root performs visible MFA and proves fixture-admin authorities before writes", async ({ page }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  await loginRootWithMfa(page, ROOT_USERNAME, ROOT_PASSWORD, ROOT_TOTP_SECRET);
  const session = await okEnvelope<{ session?: { authorities?: string[] } }>(
    await page.request.get("/api/admin/auth/session"),
  );
  const authorities = session.session?.authorities ?? [];
  for (const permission of ["platform_a1_write", "platform_a6_write", "platform_a6_role_grants_update"]) {
    expect(authorities, `fixture admin must hold ${permission}`).toContain(permission);
  }
  await logout(page);
});

test("L Final11 carrier executes visible MFA with the controlled checker fixture without writes", async ({ page }) => {
  const checker = (JSON.parse(readFileSync(CHECKER_FIXTURE_PATH, "utf8")) as CheckerFixture).accounts.d_checker;
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  await loginRootWithMfa(page, checker.username, checker.password, checker.totpSecret);
  const response = await page.request.get("/api/admin/auth/session");
  const session = await okEnvelope<{ session?: { authorities?: string[] } }>(response);
  expect(session.session?.authorities?.length ?? 0, "checker session must remain authenticated after visible MFA").toBeGreaterThan(0);
  writeFileSync(path.join(CARRIER_EVIDENCE_DIR, "carrier-mfa-readonly.json"), JSON.stringify({
    mfa: "verified",
    sessionStatus: response.status(),
    authenticated: true,
    writes: [],
  }, null, 2));
});

test("创建、独立批准并激活 L 域 owner/readonly/no-write/no-menu 权限夹具", async ({ page, browser }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  const checker = (JSON.parse(readFileSync(CHECKER_FIXTURE_PATH, "utf8")) as CheckerFixture).accounts.d_checker;

  await loginRootWithMfa(page, ROOT_USERNAME, ROOT_PASSWORD, ROOT_TOTP_SECRET);
  const rolesOverview = await okEnvelope<{ roles: Array<{ id: number; roleCode: string }> }>(
    await page.request.get("/api/admin/platform/roles/overview"),
  );
  const readRole = rolesOverview.roles.find((role) => role.roleCode === READ_ROLE_CODE)
    ?? await createRole(page, READ_ROLE_CODE, "L 域精确只读");
  const ownerRole = rolesOverview.roles.find((role) => role.roleCode === OWNER_ROLE_CODE)
    ?? await createRole(page, OWNER_ROLE_CODE, "L 域 Owner");

  const menuOverview = await okEnvelope<{ tree: unknown[] }>(
    await page.request.get("/api/admin/platform/menus/overview"),
  );
  const menuMap = flattenMenus(menuOverview.tree).reduce<Record<string, number>>((result, row) => {
    if (typeof row.menuCode === "string" && typeof row.id === "number") result[row.menuCode] = row.id;
    return result;
  }, {});
  for (const code of MENU_CODES) expect(menuMap[code], `缺少 ${code} 菜单`).toBeGreaterThan(0);
  const menuIds = MENU_CODES.map((code) => menuMap[code]);

  const readTicket = await grantRole(page, readRole.id, READ_PERMISSIONS, menuIds, "L 域只读授权");
  const ownerTicket = await grantRole(page, ownerRole.id, OWNER_PERMISSIONS, menuIds, "L 域 Owner 授权");
  await logout(page);

  for (const [ticketId, reason] of [
    [readTicket, "独立复核 L 域只读授权"],
    [ownerTicket, "独立复核 L 域 Owner 授权"],
  ] as const) {
    if (!ticketId) continue;
    const context = await browser.newContext({ baseURL: BASE_URL });
    const checkerPage = await context.newPage();
    try {
      await loginWithMfa(checkerPage, checker);
      await okEnvelope(await checkerPage.request.post(
        `/api/admin/platform/audit/operations/${ticketId}/approve`,
        {
          headers: { "Idempotency-Key": `${RUN_ID}-${ticketId}-approve-${SUFFIX}` },
          data: { reason: `${RUN_ID} ${reason}` },
        },
      ));
      await logout(checkerPage);
    } finally {
      await context.close();
    }
  }

  await loginRootWithMfa(page, ROOT_USERNAME, ROOT_PASSWORD, ROOT_TOTP_SECRET);
  const definitions: Array<{
    key: AccountKey;
    role: string;
    profile: FixtureAccount["profile"];
  }> = [
    { key: "l_owner", role: OWNER_ROLE_CODE.toLowerCase(), profile: "owner" },
    { key: "l_readonly", role: READ_ROLE_CODE.toLowerCase(), profile: "readonly" },
    { key: "l_no_write", role: READ_ROLE_CODE.toLowerCase(), profile: "menu_no_write" },
    { key: "l_no_menu", role: "unassigned", profile: "no_menu" },
  ];
  const accounts = {} as Record<AccountKey, FixtureAccount>;
  const oneTimePasswords = {} as Record<AccountKey, string>;

  for (const definition of definitions) {
    const username = `acc_${definition.key.replace("l_", "l")}_r151023_${SUFFIX}`.slice(0, 32);
    const created = await okEnvelope<{ id: string; temporaryPassword?: string }>(
      await page.request.post("/api/admin/platform/accounts", {
        headers: { "Idempotency-Key": `${RUN_ID}-${definition.key}-${SUFFIX}` },
        data: {
          username,
          displayName: `${RUN_ID} ${definition.key}`,
          email: `${definition.key}.${SUFFIX}@nexion.invalid`,
          role: definition.role,
          reason: `${RUN_ID} 创建 L 域五层权限验收夹具`,
          operator: ROOT_USERNAME,
        },
      }),
    );
    expect(created.temporaryPassword, `${definition.key} 临时密码`).toBeTruthy();
    oneTimePasswords[definition.key] = created.temporaryPassword!;
    accounts[definition.key] = {
      accountId: String(created.id),
      username,
      password: `Nx!9L${definition.profile.replaceAll("_", "")}${randomBytes(16).toString("base64url")}Aa`,
      totpSecret: "",
      role: definition.role,
      profile: definition.profile,
      authorities: [],
      effectiveMenus: [],
    };
  }
  await logout(page);

  for (const definition of definitions) {
    const account = accounts[definition.key];
    account.totpSecret = await activateFirstLogin(
      page,
      account.username,
      oneTimePasswords[definition.key],
      account.password,
    );
    const session = await okEnvelope<{
      session?: { authorities?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> };
    }>(await page.request.get("/api/admin/auth/session"));
    account.authorities = session.session?.authorities ?? [];
    account.effectiveMenus = (session.session?.effectiveMenus ?? []).map((menu) =>
      typeof menu === "string" ? menu : menu.menuCode ?? "").filter(Boolean);
    if (definition.key === "l_no_menu") {
      expect(account.authorities).toEqual([]);
      expect(account.effectiveMenus).toEqual([]);
    } else {
      const expected = definition.key === "l_owner" ? OWNER_PERMISSIONS : READ_PERMISSIONS;
      for (const permission of expected) expect(account.authorities).toContain(permission);
      for (const code of MENU_CODES) expect(account.effectiveMenus).toContain(code);
      if (definition.key !== "l_owner") {
        expect(account.authorities.some((permission) =>
          /^bi_l[1-6]_/.test(permission) && !permission.endsWith("_read"))).toBe(false);
      }
    }
    await logout(page);
  }

  mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, JSON.stringify({
    sensitive: true,
    doNotUpload: true,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    accounts,
    roles: [
      { id: readRole.id, roleCode: READ_ROLE_CODE, permissions: READ_PERMISSIONS, menuIds, grantTicket: readTicket },
      { id: ownerRole.id, roleCode: OWNER_ROLE_CODE, permissions: OWNER_PERMISSIONS, menuIds, grantTicket: ownerTicket },
    ],
    checker: checker.username,
    cleanup: {
      accounts: Object.values(accounts).map(({ accountId, username }) => ({ accountId, username })),
      roles: [READ_ROLE_CODE, OWNER_ROLE_CODE],
      order: [
        "复审完成后按最新 CAS 版本依次 reset-2fa、role=unassigned、status=disabled、sessions/revoke。",
        "提交两个隔离角色删除工单，并由非 Owner 独立批准。",
        "核对账号、角色、会话、pending A2 工单和本轮幂等记录为 0。",
      ],
    },
  }, null, 2));
});

async function createRole(page: Page, roleCode: string, roleName: string) {
  return okEnvelope<{ id: number; roleCode: string }>(
    await page.request.post("/api/admin/platform/roles", {
      headers: { "Idempotency-Key": `${RUN_ID}-${roleCode}-create-${SUFFIX}` },
      data: {
        roleCode,
        roleName: `${RUN_ID} ${roleName}`,
        remark: "L1-L6 全量验收隔离夹具",
        status: 1,
        reason: `${RUN_ID} 创建 ${roleName}角色`,
        operator: ROOT_USERNAME,
      },
    }),
  );
}

async function grantRole(
  page: Page,
  roleId: number,
  permissionCodes: string[],
  menuIds: number[],
  reason: string,
) {
  const detail = await okEnvelope<{ permissionCodes?: string[]; menuIds?: number[] }>(
    await page.request.get(`/api/admin/platform/roles/${roleId}`),
  );
  if (sameSet(detail.permissionCodes ?? [], permissionCodes)
    && sameSet((detail.menuIds ?? []).map(String), menuIds.map(String))) return "";
  const ticket = await okEnvelope<Record<string, unknown>>(
    await page.request.put(`/api/admin/platform/roles/${roleId}/grants`, {
      headers: { "Idempotency-Key": `${RUN_ID}-role-${roleId}-grant-${SUFFIX}` },
      data: { permissionCodes, menuIds, reason: `${RUN_ID} ${reason}`, operator: ROOT_USERNAME },
    }),
  );
  const ticketId = String(ticket.operationId ?? ticket.id ?? "");
  expect(ticketId).toMatch(/^(?:WO|OP)-/);
  return ticketId;
}

/** Root may be MFA-bound; this carrier always completes the visible challenge. */
async function loginRootWithMfa(page: Page, username: string, password: string, totpSecret: string) {
  for (let attempt = 0; attempt <= MAX_MFA_RECOVERY_ATTEMPTS; attempt += 1) {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('input[autocomplete="username"]').fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    const credential = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST"
      && new URL(candidate.url()).pathname === "/api/admin/auth/login",
    { timeout: MFA_RESPONSE_TIMEOUT_MS });
    await page.getByRole("button", { name: /登录|继续/ }).click();
    expect((await credential).status(), "root credential").toBe(200);

    const otp = page.getByLabel("一次性验证码");
    const mfaRequired = await otp.waitFor({ state: "visible", timeout: MFA_CHALLENGE_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!mfaRequired) {
      await expect(page.locator("aside")).toBeVisible({ timeout: MFA_RESPONSE_TIMEOUT_MS });
      return;
    }
    expect(totpSecret, "ADMIN_E2E_TOTP_SECRET is required for an MFA-bound root fixture actor").not.toBe("");

    const code = await freshTotp(totpSecret);
    await otp.fill(code);
    const response = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST"
      && new URL(candidate.url()).pathname === "/api/admin/auth/mfa/verify",
    { timeout: MFA_RESPONSE_TIMEOUT_MS });
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const result = await response;
    const body = await result.json().catch(() => null) as { code?: unknown; message?: unknown } | null;
    const mfaReason = `${body?.code ?? ""} ${body?.message ?? ""}`;
    if (/(?:MFA_CODE_REPLAYED|MFA_CHALLENGE_EXPIRED)/i.test(mfaReason)
      && attempt < MAX_MFA_RECOVERY_ATTEMPTS) continue;
    expect(result.status(), "root MFA verification").toBe(200);
    await expect(page.locator("aside")).toBeVisible({ timeout: MFA_RESPONSE_TIMEOUT_MS });
    return;
  }
  throw new Error("L_FINAL11_MFA_RECOVERY_EXHAUSTED");
}

async function loginWithMfa(
  page: Page,
  account: { username: string; password: string; totpSecret: string },
) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 10_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
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
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const payload = await (await loginResponse).json() as { data?: { mfa?: { manualKey?: string } } };
  let secret = payload.data?.mfa?.manualKey?.trim() ?? "";
  let passwordChanged = false;

  for (let transition = 0; transition < 6; transition += 1) {
    const state = await firstVisibleState(page);
    if (state === "ready") break;
    // A visible password panel can be a stale remount while the authenticated
    // console has already won the first-login transition.
    if (await page.locator("aside").isVisible().catch(() => false)) break;
    if (state === "password") {
      const newPassword = page.getByLabel("新密码", { exact: true });
      const confirmPassword = page.getByLabel("确认新密码", { exact: true });
      try {
        await expect(newPassword).toBeVisible();
        await expect(confirmPassword).toBeVisible();
        await newPassword.fill(finalPassword);
        await confirmPassword.fill(finalPassword);
        const changed = page.waitForResponse((response) =>
          response.request().method() === "POST"
          && new URL(response.url()).pathname === "/api/admin/auth/password/change");
        await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
        expect((await changed).status()).toBeLessThan(400);
        passwordChanged = true;
      } catch (error) {
        if (!await page.locator("aside").isVisible().catch(() => false)) throw error;
        passwordChanged = true;
        break;
      }
      continue;
    }
    const otp = page.getByLabel("一次性验证码");
    secret = secret || (await page.locator("code").first().textContent().catch(() => ""))?.trim() || "";
    expect(secret, `${username} TOTP secret`).not.toBe("");
    await otp.fill(await freshTotp(secret));
    const verified = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await verified).status()).toBeLessThan(400);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  expect(passwordChanged).toBe(true);
  return secret;
}

async function firstVisibleState(page: Page): Promise<"ready" | "password" | "otp"> {
  return Promise.race([
    page.locator("aside").waitFor({ state: "visible", timeout: 20_000 }).then(() => "ready" as const),
    page.getByLabel("新密码", { exact: true })
      .waitFor({ state: "visible", timeout: 20_000 }).then(() => "password" as const),
    page.getByLabel("一次性验证码")
      .waitFor({ state: "visible", timeout: 20_000 }).then(() => "otp" as const),
  ]);
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
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
  const sortedRight = [...right].sort();
  return left.length === right.length && [...left].sort().every((value, index) => value === sortedRight[index]);
}

async function okEnvelope<T>(response: { status(): number; text(): Promise<string> }) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as ApiEnvelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  const deadline = Date.now() + TOTP_FRESH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const now = Date.now();
    const step = Math.floor(now / TOTP_STEP_MS);
    const remaining = TOTP_STEP_MS - (now % TOTP_STEP_MS);
    if (step > lastTotpStep && remaining > TOTP_BOUNDARY_BUFFER_MS) {
      lastTotpStep = step;
      return currentTotp(secret, step);
    }
    const untilNextStep = TOTP_STEP_MS - (now % TOTP_STEP_MS) + 250;
    const remainingBudget = deadline - now;
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(untilNextStep, remainingBudget))));
  }
  throw new Error("L_FINAL11_TOTP_FRESH_TIMEOUT");
}

function assertRestrictedCarrierPath(rawPath: string, label: string) {
  const resolved = path.resolve(rawPath);
  const relative = path.relative(RESTRICTED_EVIDENCE_ROOT, resolved);
  if (!path.isAbsolute(rawPath) || relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`L_FINAL11_RESTRICTED_PATH_REQUIRED: ${label}`);
  }
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
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
