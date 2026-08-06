import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

const RUN_ID = "pc-full-acceptance-20260728-151023";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const CHECKER_FIXTURE_PATH = process.env.E6_CHECKER_FIXTURE
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`;
const FIXTURE_PATH = process.env.E6_MAKER_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/E/e6-maker-fixture.json`;
const SUFFIX = process.env.E6_MAKER_SUFFIX ?? "DCHK1";
const ROLE_CODE = `ACC_E6_MKR_R151023_${SUFFIX}`.toUpperCase();
const USERNAME = `acc_e6_maker_r151023_${SUFFIX}`.toLowerCase();
const PERMISSIONS = [
  "device_e6_read",
  "device_e6_write",
  "platform_a2_proposal_create",
];
const FORBIDDEN_PERMISSIONS = [
  "platform_a2_operation_approve",
  "platform_a2_write",
];
const MENU_CODES = ["E", "E6"];

type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type CheckerFixture = {
  accounts: {
    d_checker: {
      username: string;
      password: string;
      totpSecret: string;
    };
  };
};

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("创建 E6 专用最小权限 maker，授权由独立 A checker 批准", async ({ page, browser }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  const checker = (JSON.parse(readFileSync(CHECKER_FIXTURE_PATH, "utf8")) as CheckerFixture)
    .accounts.d_checker;
  const checkerContext = await browser.newContext({ baseURL: BASE_URL });
  const checkerPage = await checkerContext.newPage();

  await loginPasswordOnly(page, ROOT_USERNAME, ROOT_PASSWORD);
  await expectSessionUsername(page, ROOT_USERNAME);
  await loginMfa(checkerPage, checker);
  await expectSessionUsername(checkerPage, checker.username);

  const roles = await ok<{ roles: Array<{ id: number; roleCode: string }> }>(
    await page.request.get("/api/admin/platform/roles/overview"),
  );
  const existingRole = roles.roles.find((candidate) => candidate.roleCode === ROLE_CODE);
  const role = existingRole ?? await ok<{ id: number; roleCode: string }>(
    await page.request.post("/api/admin/platform/roles", {
      headers: { "Idempotency-Key": `${RUN_ID}-e6-maker-role-create-${SUFFIX}` },
      data: {
        roleCode: ROLE_CODE,
        roleName: `${RUN_ID} E6 最小 maker`,
        remark: "E6 终局A2确认专用；无审批权",
        status: 1,
        reason: `${RUN_ID} 创建 E6 专用最小权限 maker 角色`,
        operator: ROOT_USERNAME,
      },
    }),
  );
  expect(role.roleCode).toBe(ROLE_CODE);

  const menus = await ok<{ tree: unknown[] }>(
    await page.request.get("/api/admin/platform/menus/overview"),
  );
  const menuByCode = flattenMenus(menus.tree).reduce<Record<string, number>>((map, row) => {
    if (typeof row.menuCode === "string" && typeof row.id === "number") map[row.menuCode] = row.id;
    return map;
  }, {});
  const menuIds = MENU_CODES.map((code) => {
    expect(menuByCode[code], `缺少 ${code} 菜单节点`).toBeGreaterThan(0);
    return menuByCode[code];
  });

  const detail = await ok<{ permissionCodes?: string[]; menuIds?: number[] }>(
    await page.request.get(`/api/admin/platform/roles/${role.id}`),
  );
  let grantTicketId = "PREVIOUSLY_APPROVED";
  if (
    !sameSet(detail.permissionCodes ?? [], PERMISSIONS)
    || !sameSet((detail.menuIds ?? []).map(String), menuIds.map(String))
  ) {
    const ticket = await ok<Record<string, unknown>>(
      await page.request.put(`/api/admin/platform/roles/${role.id}/grants`, {
        headers: { "Idempotency-Key": `${RUN_ID}-e6-maker-role-grants-${SUFFIX}` },
        data: {
          permissionCodes: PERMISSIONS,
          menuIds,
          reason: `${RUN_ID} E6 maker 仅授读取、写入、创建 A2 提案`,
          operator: ROOT_USERNAME,
        },
      }),
    );
    grantTicketId = operationId(ticket);
    await ok(
      await checkerPage.request.post(
        `/api/admin/platform/audit/operations/${encodeURIComponent(grantTicketId)}/approve`,
        {
          headers: { "Idempotency-Key": `${RUN_ID}-e6-maker-role-grants-approve-${SUFFIX}` },
          data: { reason: `${RUN_ID} 独立 A checker 核对 E6 maker 最小授权` },
        },
      ),
    );
  }

  const accounts = await accountsOverview(page);
  const existingAccount = accounts.find((candidate) => candidate.username === USERNAME);
  const account = existingAccount
    ? { id: String(existingAccount.id) }
    : await ok<{ id: string }>(
        await page.request.post("/api/admin/platform/accounts", {
          headers: { "Idempotency-Key": `${RUN_ID}-e6-maker-account-create-${SUFFIX}` },
          data: {
            username: USERNAME,
            displayName: `${RUN_ID} E6 maker`,
            email: `e6-maker.${SUFFIX}@nexion.invalid`,
            role: ROLE_CODE.toLowerCase(),
            reason: `${RUN_ID} 创建 E6 终局隔离 maker`,
            operator: ROOT_USERNAME,
          },
        }),
      );
  const accountId = String(account.id);
  let current = await accountById(page, accountId);
  if (current.tfa === true) {
    await mutateAccount(page, accountId, "POST", "reset-2fa", {
      reason: `${RUN_ID} 恢复中断的 E6 maker MFA`,
    }, `${RUN_ID}-e6-maker-reset-mfa-${SUFFIX}-${Date.now()}`);
  }
  current = await accountById(page, accountId);
  if (current.role !== ROLE_CODE.toLowerCase()) {
    await mutateAccount(page, accountId, "PATCH", "role", {
      role: ROLE_CODE.toLowerCase(),
      reason: `${RUN_ID} 恢复 E6 maker 最小角色`,
    }, `${RUN_ID}-e6-maker-role-${SUFFIX}-${Date.now()}`);
  }
  current = await accountById(page, accountId);
  if (current.status !== "enabled") {
    await mutateAccount(page, accountId, "PATCH", "status", {
      status: "enabled",
      reason: `${RUN_ID} 恢复 E6 maker 隔离账号`,
    }, `${RUN_ID}-e6-maker-enable-${SUFFIX}-${Date.now()}`);
  }
  const reset = await mutateAccount<{ temporaryPassword?: string }>(
    page,
    accountId,
    "POST",
    "password/reset",
    { reason: `${RUN_ID} 签发 E6 maker 一次性密码` },
    `${RUN_ID}-e6-maker-password-${SUFFIX}-${Date.now()}`,
  );
  expect(reset.temporaryPassword).toBeTruthy();

  const finalPassword = `Nx!9E6maker${randomBytes(16).toString("base64url")}Aa`;
  await logout(page);
  const totpSecret = await activateFirstLogin(
    page,
    USERNAME,
    reset.temporaryPassword!,
    finalPassword,
  );
  const session = await ok<{
    session?: {
      username?: string;
      authorities?: string[];
      menuCodes?: string[];
      effectiveMenus?: Array<string | { menuCode?: string }>;
    };
  }>(await page.request.get("/api/admin/auth/session"));
  expect(session.session?.username).toBe(USERNAME);
  const authorities = session.session?.authorities ?? [];
  const effectiveMenus = session.session?.menuCodes
    ?? (session.session?.effectiveMenus ?? []).map((menu) =>
      typeof menu === "string" ? menu : menu.menuCode ?? "").filter(Boolean);
  for (const permission of PERMISSIONS) expect(authorities).toContain(permission);
  for (const permission of FORBIDDEN_PERMISSIONS) expect(authorities).not.toContain(permission);
  expect(effectiveMenus).toEqual(expect.arrayContaining(MENU_CODES));
  await logout(page);

  mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, JSON.stringify({
    sensitive: true,
    doNotUpload: true,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    account: {
      accountId,
      username: USERNAME,
      password: finalPassword,
      totpSecret,
      verifiedAuthorities: authorities,
      verifiedEffectiveMenus: effectiveMenus,
    },
    customRole: {
      id: role.id,
      roleCode: ROLE_CODE,
      permissionCodes: PERMISSIONS,
      menuIds,
      grantTicketId,
      grantApprovedBy: checker.username,
    },
  }, null, 2));
  await checkerContext.close();
});

async function loginPasswordOnly(page: Page, username: string, password: string) {
  await page.context().clearCookies();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function loginMfa(
  page: Page,
  account: { username: string; password: string; totpSecret: string },
) {
  // J-AUTO-003: a rejected/replayed OTP consumes the challenge. Every retry must
  // discard its cookies and start from password login with a strictly newer counter.
  lastTotpStep = Math.max(lastTotpStep, Math.floor(Date.now() / 30_000));
  const failures: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.context().clearCookies();
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    await page.getByRole("button", { name: /登录|继续/ }).click();
    const otp = page.getByLabel("一次性验证码");
    await expect(otp).toBeVisible({ timeout: 15_000 });
    await otp.fill(await freshTotp(account.totpSecret));
    const verification = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verification;
    const body = await envelope(response);
    if (response.status() === 200 && (body?.code ?? 0) === 0) {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
      return;
    }
    failures.push(`HTTP ${response.status()} code=${body?.code ?? "none"}`);
  }
  throw new Error(`checker MFA failed: ${failures.join(" | ")}`);
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
  await page.getByRole("button", { name: /登录|继续/ }).click();
  let secret = "";
  let passwordChanged = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) break;
    const otp = page.getByLabel("一次性验证码");
    if (await otp.isVisible().catch(() => false)) {
      secret = secret || (await page.locator("code").first().textContent().catch(() => ""))?.trim() || "";
      expect(secret, "E6 maker 首次登录必须提供 TOTP secret").not.toBe("");
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
  const button = page.getByRole("button", { name: /退出登录|登出/ }).first();
  if (await button.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await button.click();
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

async function expectSessionUsername(page: Page, username: string) {
  const response = await page.request.get("/api/admin/auth/session");
  const body = await envelope<{ session?: { username?: string } }>(response);
  expect(response.status()).toBe(200);
  expect(body.data?.session?.username).toBe(username);
}

async function accountsOverview(page: Page) {
  return (await ok<{ operators: Array<Record<string, unknown>> }>(
    await page.request.get("/api/admin/platform/accounts/overview"),
  )).operators;
}

async function accountById(page: Page, accountId: string) {
  const account = (await accountsOverview(page))
    .find((candidate) => String(candidate.id) === accountId);
  expect(account, `E6 maker account ${accountId} must exist`).toBeTruthy();
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
  const current = await accountById(page, accountId);
  return await ok<T>(await page.request.fetch(`/api/admin/platform/accounts/${accountId}/${suffix}`, {
    method,
    headers: { "Idempotency-Key": idempotencyKey },
    data: { ...data, operator: ROOT_USERNAME, expectedVersion: String(current.version) },
  }));
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
  return left.length === right.length
    && [...left].sort().every((value, index) => value === sortedRight[index]);
}

function operationId(body: Record<string, unknown>) {
  const id = String(body.operationId ?? body.id ?? "");
  expect(id).toMatch(/^(?:WO|OP)-/);
  return id;
}

async function ok<T>(response: APIResponse | Response) {
  const body = await envelope<T>(response);
  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(body.code ?? 0, JSON.stringify(body)).toBe(0);
  return body.data as T;
}

async function envelope<T = unknown>(response: APIResponse | Response) {
  return await response.json().catch(() => null) as Envelope<T>;
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
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
