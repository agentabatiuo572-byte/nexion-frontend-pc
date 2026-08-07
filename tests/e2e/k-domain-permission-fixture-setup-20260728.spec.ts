import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const RUN_ID = process.env.K_PERMISSION_RUN_ID ?? "pc-full-acceptance-20260728-151023";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const CHECKER_FIXTURE_PATH = process.env.K_PERMISSION_CHECKER_FIXTURE
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`;
const FIXTURE_PATH = process.env.K_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/K/permission-fixtures.json`;
const SUFFIX = process.env.K_PERMISSION_SUFFIX ?? randomBytes(3).toString("hex");
const READ_ROLE_CODE = `ACC_K_RO_R151023_${SUFFIX}`.toUpperCase();
const MAKER_ROLE_CODE = `ACC_K_MAKER_R151023_${SUFFIX}`.toUpperCase();
const READ_PERMISSIONS = Array.from({ length: 6 }, (_, index) => `risk_k${index + 1}_read`);
const MAKER_PERMISSIONS = [
  ...READ_PERMISSIONS,
  "risk_k1_write", "risk_k1_cluster_freeze", "risk_k1_cluster_release",
  "risk_k1_cluster_cleared", "risk_k1_cluster_flag",
  "risk_k2_write", "risk_k2_row_freeze", "risk_k2_row_flag",
  "risk_k2_row_blockgift", "risk_k2_row_boardflag",
  "risk_k3_write", "risk_k3_rule_create", "risk_k3_rule_toggle", "risk_k3_rule_archive",
  "risk_k4_write", "risk_k4_user_override", "risk_k4_user_recompute",
  "risk_k6_write", "risk_k6_senior", "risk_k6_target_manage",
  "platform_a2_read", "platform_a2_proposal_create",
];
const MENU_CODES = ["K", "K1", "K2", "K3", "K4", "K6"];

type AccountKey = "k_readonly" | "k_no_write" | "k_no_menu" | "k_maker";
type FixtureAccount = {
  accountId: string;
  username: string;
  password: string;
  totpSecret: string;
  role: string;
  profile: "readonly" | "menu_no_write" | "no_menu" | "maker";
  authorities: string[];
  effectiveMenus: string[];
};
type ApiEnvelope<T> = { code?: number; message?: string; data?: T };
type CheckerFixture = {
  accounts: { d_checker: { username: string; password: string; totpSecret: string } };
};

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("创建、独立批准并激活 K 域 readonly/no-write/no-menu/maker 权限夹具", async ({ page, browser }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  const checker = (JSON.parse(readFileSync(CHECKER_FIXTURE_PATH, "utf8")) as CheckerFixture).accounts.d_checker;

  await loginPasswordOnly(page, ROOT_USERNAME, ROOT_PASSWORD);
  const rolesOverview = await okEnvelope<{ roles: Array<{ id: number; roleCode: string }> }>(
    await page.request.get("/api/admin/platform/roles/overview"),
  );
  const readRole = rolesOverview.roles.find((role) => role.roleCode === READ_ROLE_CODE)
    ?? await createRole(page, READ_ROLE_CODE, "K 域只读");
  const makerRole = rolesOverview.roles.find((role) => role.roleCode === MAKER_ROLE_CODE)
    ?? await createRole(page, MAKER_ROLE_CODE, "K 域 maker");

  const menuOverview = await okEnvelope<{ tree: unknown[] }>(
    await page.request.get("/api/admin/platform/menus/overview"),
  );
  const menuMap = flattenMenus(menuOverview.tree).reduce<Record<string, number>>((result, row) => {
    if (typeof row.menuCode === "string" && typeof row.id === "number") result[row.menuCode] = row.id;
    return result;
  }, {});
  for (const code of MENU_CODES) expect(menuMap[code], `缺少 ${code} 菜单`).toBeGreaterThan(0);
  const menuIds = MENU_CODES.map((code) => menuMap[code]);

  const readTicket = await grantRole(page, readRole.id, READ_PERMISSIONS, menuIds, "K 域精确只读授权");
  const makerTicket = await grantRole(page, makerRole.id, MAKER_PERMISSIONS, menuIds, "K 域 maker 精确授权");
  await logout(page);

  for (const [ticketId, reason] of [
    [readTicket, "独立复核 K 域只读授权"],
    [makerTicket, "独立复核 K 域 maker 授权"],
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

  await loginPasswordOnly(page, ROOT_USERNAME, ROOT_PASSWORD);
  const definitions: Array<{
    key: AccountKey;
    role: string;
    profile: FixtureAccount["profile"];
  }> = [
    { key: "k_readonly", role: READ_ROLE_CODE.toLowerCase(), profile: "readonly" },
    { key: "k_no_write", role: READ_ROLE_CODE.toLowerCase(), profile: "menu_no_write" },
    { key: "k_no_menu", role: "unassigned", profile: "no_menu" },
    { key: "k_maker", role: MAKER_ROLE_CODE.toLowerCase(), profile: "maker" },
  ];
  const accounts = {} as Record<AccountKey, FixtureAccount>;
  const oneTimePasswords = {} as Record<AccountKey, string>;

  for (const definition of definitions) {
    const username = `acc_${definition.key.replace("k_", "k")}_r151023_${SUFFIX}`.slice(0, 32).toLowerCase();
    const created = await okEnvelope<{ id: string; temporaryPassword?: string }>(
      await page.request.post("/api/admin/platform/accounts", {
        headers: { "Idempotency-Key": `${RUN_ID}-${definition.key}-${SUFFIX}` },
        data: {
          username,
          displayName: `${RUN_ID} ${definition.key}`,
          email: `${definition.key}.${SUFFIX}@nexion.invalid`,
          role: definition.role,
          reason: `${RUN_ID} 创建 K 域五层权限夹具`,
          operator: ROOT_USERNAME,
        },
      }),
    );
    expect(created.temporaryPassword, `${definition.key} 临时密码`).toBeTruthy();
    oneTimePasswords[definition.key] = created.temporaryPassword!;
    accounts[definition.key] = {
      accountId: String(created.id),
      username,
      password: `Nx!9K${definition.profile.replaceAll("_", "")}${randomBytes(16).toString("base64url")}Aa`,
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
    if (definition.key === "k_no_menu") {
      expect(account.authorities).toEqual([]);
      expect(account.effectiveMenus).toEqual([]);
    } else if (definition.key === "k_maker") {
      for (const permission of MAKER_PERMISSIONS) expect(account.authorities).toContain(permission);
      for (const code of MENU_CODES) expect(account.effectiveMenus).toContain(code);
    } else {
      for (const permission of READ_PERMISSIONS) expect(account.authorities).toContain(permission);
      expect(account.authorities.some((permission) =>
        /^risk_k[1-6]_/.test(permission) && !permission.endsWith("_read"))).toBe(false);
      for (const code of MENU_CODES) expect(account.effectiveMenus).toContain(code);
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
      { id: makerRole.id, roleCode: MAKER_ROLE_CODE, permissions: MAKER_PERMISSIONS, menuIds, grantTicket: makerTicket },
    ],
    checker: checker.username,
    cleanup: {
      accounts: Object.values(accounts).map(({ accountId, username }) => ({ accountId, username })),
      roles: [READ_ROLE_CODE, MAKER_ROLE_CODE],
      order: [
        "每次重读账号最新 CAS 版本：reset-2fa、role=unassigned、status=disabled、sessions/revoke。",
        "提交两个自定义角色删除工单，并由 A 域 d_checker 独立批准。",
        "核对账号、角色、会话、pending A2 工单和本轮幂等记录。",
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
        remark: "K1-K6 全量验收隔离夹具",
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) break;
    const otp = page.getByLabel("一次性验证码");
    if (await otp.isVisible().catch(() => false)) {
      secret = secret || (await page.locator("code").first().textContent().catch(() => ""))?.trim() || "";
      expect(secret, `${username} TOTP secret`).not.toBe("");
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
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  expect(passwordChanged).toBe(true);
  return secret;
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
