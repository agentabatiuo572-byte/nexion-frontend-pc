import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const RUN_ID = process.env.E_PERMISSION_RUN_ID ?? "pc-full-acceptance-20260728-151023";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const CHECKER_FIXTURE_PATH = process.env.E_PERMISSION_CHECKER_FIXTURE
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`;
const FIXTURE_PATH = process.env.E_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/E/permission-fixtures.json`;
const SUFFIX = process.env.E_PERMISSION_SUFFIX ?? randomBytes(3).toString("hex");
const ROLE_CODE = `ACC_E_RO_R151023_${SUFFIX}`.toUpperCase();
const READ_PERMISSIONS = [
  "device_e1_read",
  "device_e2_read",
  "device_e3_read",
  "device_e4_read",
  "device_e5_read",
  "device_e6_read",
];
const MENU_CODES = ["E", "E1", "E2", "E3", "E4", "E5", "E6"];

type AccountKey = "e_readonly" | "e_no_write" | "e_no_menu";
type FixtureAccount = {
  accountId: string;
  username: string;
  password: string;
  totpSecret: string;
  role: string;
  domain: "E";
  profile: "readonly" | "menu_no_write" | "no_menu";
  verifiedAuthorities: string[];
  verifiedEffectiveMenus: string[];
  sessionClosedAfterVerification: boolean;
};

type CheckerFixture = {
  accounts: {
    d_checker: {
      username: string;
      password: string;
      totpSecret: string;
    };
  };
};

type ApiEnvelope<T> = { code?: number; message?: string; data?: T };

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("创建、独立批准并激活 E 域 readonly/no-write/no-menu 权限夹具", async ({ page, browser }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  const checkerFixture = JSON.parse(readFileSync(CHECKER_FIXTURE_PATH, "utf8")) as CheckerFixture;
  const checker = checkerFixture.accounts.d_checker;

  await loginPasswordOnly(page, ROOT_USERNAME, ROOT_PASSWORD);
  const roles = await okEnvelope<{ roles: Array<{ id: number; roleCode: string }> }>(
    await page.request.get("/api/admin/platform/roles/overview"),
  );
  const existingRole = roles.roles.find((candidate) => candidate.roleCode === ROLE_CODE);
  const role = existingRole ?? await okEnvelope<{ id: number; roleCode: string }>(
      await page.request.post("/api/admin/platform/roles", {
        headers: { "Idempotency-Key": `${RUN_ID}-e-role-create-${SUFFIX}` },
        data: {
          roleCode: ROLE_CODE,
          roleName: `${RUN_ID} E 域只读`,
          remark: "E1-E6 五层权限验收专用，禁止写操作",
          status: 1,
          reason: `${RUN_ID} 创建 E 域只读权限夹具`,
          operator: ROOT_USERNAME,
        },
      }),
    );
  expect(role.roleCode).toBe(ROLE_CODE);

  const menus = await okEnvelope<{ tree: unknown[] }>(
    await page.request.get("/api/admin/platform/menus/overview"),
  );
  const menuByCode = flattenMenus(menus.tree).reduce<Record<string, number>>((map, row) => {
    if (typeof row.menuCode === "string" && typeof row.id === "number") map[row.menuCode] = row.id;
    return map;
  }, {});
  for (const code of MENU_CODES) expect(menuByCode[code], `缺少 ${code} 菜单节点`).toBeGreaterThan(0);
  const menuIds = MENU_CODES.map((code) => menuByCode[code]);
  const roleDetail = await okEnvelope<{ permissionCodes?: string[]; menuIds?: number[] }>(
    await page.request.get(`/api/admin/platform/roles/${role.id}`),
  );
  let grantTicketId = "PREVIOUSLY_APPROVED";
  if (
    !sameSet(roleDetail.permissionCodes ?? [], READ_PERMISSIONS)
    || !sameSet((roleDetail.menuIds ?? []).map(String), menuIds.map(String))
  ) {
    const grantTicket = await okEnvelope<Record<string, unknown>>(
      await page.request.put(`/api/admin/platform/roles/${role.id}/grants`, {
        headers: { "Idempotency-Key": `${RUN_ID}-e-role-grants-${SUFFIX}` },
        data: {
          permissionCodes: READ_PERMISSIONS,
          menuIds,
          reason: `${RUN_ID} E1-E6 只读精确授权`,
          operator: ROOT_USERNAME,
        },
      }),
    );
    grantTicketId = String(grantTicket.operationId ?? grantTicket.id ?? "");
    expect(grantTicketId).toMatch(/^(?:WO|OP)-/);
    await logout(page);

    const checkerContext = await browser.newContext({ baseURL: BASE_URL });
    const checkerPage = await checkerContext.newPage();
    try {
      await loginWithMfa(checkerPage, checker);
      await okEnvelope(
        await checkerPage.request.post(`/api/admin/platform/audit/operations/${grantTicketId}/approve`, {
          headers: { "Idempotency-Key": `${RUN_ID}-e-role-approve-${SUFFIX}` },
          data: { reason: `${RUN_ID} checker 独立复核 E 域最小只读授权` },
        }),
      );
      await logout(checkerPage);
    } finally {
      await checkerContext.close();
    }
    await loginPasswordOnly(page, ROOT_USERNAME, ROOT_PASSWORD);
  }
  const definitions: Array<{
    key: AccountKey;
    role: string;
    profile: FixtureAccount["profile"];
  }> = [
    { key: "e_readonly", role: ROLE_CODE.toLowerCase(), profile: "readonly" },
    { key: "e_no_write", role: ROLE_CODE.toLowerCase(), profile: "menu_no_write" },
    { key: "e_no_menu", role: "unassigned", profile: "no_menu" },
  ];
  const accounts = {} as Record<AccountKey, FixtureAccount>;
  const temporaryPasswords = {} as Record<AccountKey, string>;

  for (const definition of definitions) {
    const username = `acc_${definition.key.replace("e_", "e")}_r151023_${SUFFIX}`.slice(0, 32);
    const accountOverview = await okEnvelope<{ operators: Array<Record<string, unknown>> }>(
      await page.request.get("/api/admin/platform/accounts/overview"),
    );
    const existing = accountOverview.operators.find((operator) => operator.username === username);
    const created = existing
      ? { id: String(existing.id) }
      : await okEnvelope<{ id: string }>(
          await page.request.post("/api/admin/platform/accounts", {
            headers: { "Idempotency-Key": `${RUN_ID}-${definition.key}-${SUFFIX}` },
            data: {
              username,
              displayName: `${RUN_ID} ${definition.key}`,
              email: `${definition.key}.${SUFFIX}@nexion.invalid`,
              role: definition.role,
              reason: `${RUN_ID} 创建 E 域五层权限验收夹具`,
              operator: ROOT_USERNAME,
            },
          }),
        );
    const finalPassword = `Nx!9E${definition.profile.replaceAll("_", "")}${randomBytes(16).toString("base64url")}Aa`;
    accounts[definition.key] = {
      accountId: String(created.id),
      username,
      password: finalPassword,
      totpSecret: "",
      role: definition.role,
      domain: "E",
      profile: definition.profile,
      verifiedAuthorities: [],
      verifiedEffectiveMenus: [],
      sessionClosedAfterVerification: false,
    };
  }

  for (const definition of definitions) {
    const account = accounts[definition.key];
    const current = await getAccount(page, account.accountId);
    if (current.tfa === true) {
      await mutateAccount(page, account.accountId, "POST", "reset-2fa", {
        reason: `${RUN_ID} 恢复中断的 E 域 MFA 夹具`,
        operator: ROOT_USERNAME,
      }, `${RUN_ID}-${definition.key}-reset-mfa-${Date.now()}`);
    }
    const reset = await mutateAccount<{ temporaryPassword?: string }>(
      page,
      account.accountId,
      "POST",
      "password/reset",
      {
        reason: `${RUN_ID} 签发 E 域夹具一次性密码`,
        operator: ROOT_USERNAME,
      },
      `${RUN_ID}-${definition.key}-reset-password-${Date.now()}`,
    );
    expect(reset.temporaryPassword, `${definition.key} 重置后必须返回一次性密码`).toBeTruthy();
    temporaryPasswords[definition.key] = reset.temporaryPassword!;
  }
  await logout(page);

  for (const definition of definitions) {
    const account = accounts[definition.key];
    account.totpSecret = await activateFirstLogin(
      page,
      account.username,
      temporaryPasswords[definition.key],
      account.password,
    );
    const session = await okEnvelope<{
      session?: { authorities?: string[]; menuCodes?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> };
    }>(await page.request.get("/api/admin/auth/session"));
    const authorities = session.session?.authorities ?? [];
    const menuCodes = session.session?.menuCodes
      ?? (session.session?.effectiveMenus ?? []).map((menu) =>
        typeof menu === "string" ? menu : menu.menuCode ?? "").filter(Boolean);
    if (definition.key === "e_no_menu") {
      expect(authorities).toEqual([]);
      expect(menuCodes).toEqual([]);
    } else {
      for (const permission of READ_PERMISSIONS) expect(authorities).toContain(permission);
      expect(authorities.some((permission) => /^device_e[1-6]_.+(write|manage|toggle|adjust|pause|activate|refund)/.test(permission))).toBe(false);
      for (const code of MENU_CODES) expect(menuCodes).toContain(code);
    }
    account.verifiedAuthorities = authorities;
    account.verifiedEffectiveMenus = menuCodes;
    await logout(page);
    account.sessionClosedAfterVerification = true;
  }

  mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, JSON.stringify({
    sensitive: true,
    doNotUpload: true,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    accounts,
    customRole: {
      id: role.id,
      roleCode: ROLE_CODE,
      permissionCodes: READ_PERMISSIONS,
      menuIds,
      grantTicketId,
      grantApprovedBy: checker.username,
    },
    cleanup: {
      expectedVersionRule: "每一次账号写操作前重新 GET /api/admin/platform/accounts/overview，使用目标账号最新 version。",
      order: [
        "保留 A 域 d_checker，先清理三个 E 域账号。",
        "按最新 CAS 版本依次执行 reset-2fa、role=unassigned、status=disabled、sessions/revoke。",
        "确认三个账号均解绑角色后，由 superadmin 提交自定义角色删除工单。",
        "由 A 域 d_checker 独立批准角色删除工单。",
        "核对账号 disabled/unassigned/tfa=false/sessions=0、角色和 pending A2 工单均为 0。",
      ],
      customRoleCode: ROLE_CODE,
    },
  }, null, 2));
});

async function loginPasswordOnly(page: Page, username: string, password: string) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function loginWithMfa(
  page: Page,
  account: { username: string; password: string; totpSecret: string },
) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const loggedIn = await loginResponse;
  const loginPayload = await loggedIn.json().catch(() => ({})) as ApiEnvelope<unknown>;
  expect(loggedIn.status(), JSON.stringify(loginPayload)).toBe(200);
  expect(loginPayload.code ?? 0, JSON.stringify(loginPayload)).toBe(0);
  const otp = page.getByLabel("一次性验证码");
  const verificationFailures: string[] = [];
  await otp.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  for (let attempt = 0; attempt < 3 && await otp.isVisible().catch(() => false); attempt += 1) {
    await otp.fill(await freshTotp(account.totpSecret));
    const verification = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const verified = await verification;
    const payload = await verified.json().catch(() => ({})) as ApiEnvelope<unknown>;
    if (verified.status() === 200 && (payload.code ?? 0) === 0) {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      break;
    }
    verificationFailures.push(`HTTP ${verified.status()} code=${payload.code ?? "none"} message=${payload.message ?? "none"}`);
    await expect(otp).toBeVisible({ timeout: 5_000 });
  }
  if (!(await page.locator("aside").isVisible().catch(() => false)) && verificationFailures.length > 0) {
    throw new Error(`checker MFA failed: ${verificationFailures.join(" | ")}`);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function activateFirstLogin(
  page: Page,
  username: string,
  temporaryPassword: string,
  finalPassword: string,
) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const response = await loginResponse;
  const payload = await response.json().catch(() => ({})) as {
    data?: { mfa?: { manualKey?: string | null } };
  };
  expect(response.status(), JSON.stringify(payload)).toBeLessThan(400);
  let secret = payload.data?.mfa?.manualKey?.trim() ?? "";
  let passwordChanged = false;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) break;
    const otp = page.getByLabel("一次性验证码");
    if (await otp.isVisible().catch(() => false)) {
      secret = secret || (await page.locator("code").first().textContent().catch(() => ""))?.trim() || "";
      expect(secret, `${username} 首次登录必须提供 TOTP secret`).not.toBe("");
      await otp.fill(await freshTotp(secret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
    if (!passwordChanged && await page.getByRole("heading", { name: "首次登录修改密码" }).isVisible().catch(() => false)) {
      await page.getByLabel("新密码", { exact: true }).fill(finalPassword);
      await page.getByLabel("确认新密码", { exact: true }).fill(finalPassword);
      await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
      passwordChanged = true;
    }
    await page.waitForTimeout(250);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  expect(passwordChanged).toBe(true);
  return secret;
}

async function logout(page: Page) {
  const direct = page.getByRole("button", { name: /^(退出登录|登出)$/ }).first();
  if (await direct.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await direct.click();
  } else {
    const account = page.locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]').first();
    await expect(account).toBeVisible();
    await account.click();
    const textLogout = page.getByText(/退出登录|登出/, { exact: true }).first();
    if (await textLogout.isVisible({ timeout: 2_000 }).catch(() => false)) await textLogout.click();
    else await page.getByRole("button", { name: /退出登录|登出/ }).first().click();
  }
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
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

async function getAccount(page: Page, accountId: string) {
  const overview = await okEnvelope<{ operators: Array<Record<string, unknown>> }>(
    await page.request.get("/api/admin/platform/accounts/overview"),
  );
  const account = overview.operators.find((operator) => String(operator.id) === accountId);
  expect(account, `账号 ${accountId} 必须存在`).toBeTruthy();
  return account!;
}

async function mutateAccount<T>(
  page: Page,
  accountId: string,
  method: "PATCH" | "POST",
  suffix: string,
  data: Record<string, unknown>,
  idempotencyKey: string,
) {
  const current = await getAccount(page, accountId);
  const expectedVersion = String(current.version ?? "");
  expect(expectedVersion, `账号 ${accountId} 必须提供 CAS version`).not.toBe("");
  return okEnvelope<T>(await page.request.fetch(`/api/admin/platform/accounts/${accountId}/${suffix}`, {
    method,
    headers: { "Idempotency-Key": idempotencyKey },
    data: { ...data, expectedVersion },
  }));
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
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  return currentTotp(secret);
}

function currentTotp(secret: string) {
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
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
