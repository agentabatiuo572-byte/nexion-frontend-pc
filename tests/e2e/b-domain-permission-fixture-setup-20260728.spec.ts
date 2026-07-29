import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

const RUN_ID = process.env.B_PERMISSION_RUN_ID ?? "pc-full-acceptance-20260728-151023";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const CHECKER_PATH = process.env.B_PERMISSION_CHECKER_FIXTURE
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`;
const FIXTURE_PATH = process.env.B_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/B/permission-fixtures.json`;
const SUFFIX = process.env.B_PERMISSION_SUFFIX ?? randomBytes(3).toString("hex");
const ROLE_CODE = `ACC_B_RO_R151023_${SUFFIX}`.toUpperCase();
const READ_PERMISSIONS = [
  "overview_b1_read",
  "overview_b2_read",
  "overview_b3_read",
  "overview_b4_read",
  "overview_b5_read",
];
const MENU_CODES = ["B", "B1", "B2", "B3", "B4", "B5"];

type AccountKey = "b_readonly" | "b_no_write" | "b_no_menu";
type Account = {
  accountId: string;
  username: string;
  password: string;
  totpSecret: string;
  role: string;
  authorities: string[];
  effectiveMenus: string[];
};
type Checker = { username: string; password: string; totpSecret: string };
type Envelope<T> = { code?: number; message?: string; data?: T };

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("创建、独立批准并激活 B 域 readonly/no-write/no-menu 夹具", async ({ page, browser }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  const checker = (JSON.parse(readFileSync(CHECKER_PATH, "utf8")) as {
    accounts: { d_checker: Checker };
  }).accounts.d_checker;

  await loginRoot(page);
  const roles = await ok<{ roles: Array<{ id: number; roleCode: string }> }>(
    await page.request.get("/api/admin/platform/roles/overview"),
  );
  const role = roles.roles.find((item) => item.roleCode === ROLE_CODE)
    ?? await ok<{ id: number; roleCode: string }>(
      await page.request.post("/api/admin/platform/roles", {
        headers: { "Idempotency-Key": `${RUN_ID}-${ROLE_CODE}-create` },
        data: {
          roleCode: ROLE_CODE,
          roleName: `${RUN_ID} B 域只读`,
          remark: "B1-B5 五层权限隔离夹具",
          status: 1,
          reason: `${RUN_ID} 创建 B 域只读角色`,
          operator: ROOT_USERNAME,
        },
      }),
    );

  const menuOverview = await ok<{ tree: unknown[] }>(
    await page.request.get("/api/admin/platform/menus/overview"),
  );
  const menuMap = flattenMenus(menuOverview.tree).reduce<Record<string, number>>((result, row) => {
    if (typeof row.menuCode === "string" && typeof row.id === "number") result[row.menuCode] = row.id;
    return result;
  }, {});
  for (const code of MENU_CODES) expect(menuMap[code], `缺少 ${code} 菜单`).toBeGreaterThan(0);
  const menuIds = MENU_CODES.map((code) => menuMap[code]);

  const detail = await ok<{ permissionCodes?: string[]; menuIds?: number[] }>(
    await page.request.get(`/api/admin/platform/roles/${role.id}`),
  );
  let grantTicket = "";
  if (!sameSet(detail.permissionCodes ?? [], READ_PERMISSIONS)
      || !sameSet((detail.menuIds ?? []).map(String), menuIds.map(String))) {
    const proposal = await ok<Record<string, unknown>>(
      await page.request.put(`/api/admin/platform/roles/${role.id}/grants`, {
        headers: { "Idempotency-Key": `${RUN_ID}-B-role-${role.id}-grant` },
        data: {
          permissionCodes: READ_PERMISSIONS,
          menuIds,
          reason: `${RUN_ID} B1-B5 精确只读授权`,
          operator: ROOT_USERNAME,
        },
      }),
    );
    grantTicket = String(proposal.operationId ?? proposal.id ?? "");
    expect(grantTicket).toMatch(/^(?:WO|OP)-/);
  }
  await logout(page);
  if (grantTicket) await approve(browser, checker, grantTicket);

  await loginRoot(page);
  const definitions: Array<{ key: AccountKey; role: string }> = [
    { key: "b_readonly", role: ROLE_CODE.toLowerCase() },
    { key: "b_no_write", role: ROLE_CODE.toLowerCase() },
    { key: "b_no_menu", role: "unassigned" },
  ];
  const accounts = {} as Record<AccountKey, Account>;
  const temporary = {} as Record<AccountKey, string>;
  for (const definition of definitions) {
    const username = `acc_${definition.key.replace("b_", "b")}_r151023_${SUFFIX}`.slice(0, 32);
    const created = await ok<{ id: string; temporaryPassword?: string }>(
      await page.request.post("/api/admin/platform/accounts", {
        headers: { "Idempotency-Key": `${RUN_ID}-${definition.key}-${SUFFIX}` },
        data: {
          username,
          displayName: `${RUN_ID} ${definition.key}`,
          email: `${definition.key}.${SUFFIX}@nexion.invalid`,
          role: definition.role,
          reason: `${RUN_ID} 创建 B 域五层权限夹具`,
          operator: ROOT_USERNAME,
        },
      }),
    );
    expect(created.temporaryPassword).toBeTruthy();
    temporary[definition.key] = created.temporaryPassword!;
    accounts[definition.key] = {
      accountId: String(created.id),
      username,
      password: `Nx!9B${definition.key.replaceAll("_", "")}${randomBytes(16).toString("base64url")}Aa`,
      totpSecret: "",
      role: definition.role,
      authorities: [],
      effectiveMenus: [],
    };
  }
  await logout(page);

  for (const definition of definitions) {
    const account = accounts[definition.key];
    account.totpSecret = await activate(page, account.username, temporary[definition.key], account.password);
    const session = await ok<{
      session?: { authorities?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> };
    }>(await page.request.get("/api/admin/auth/session"));
    account.authorities = session.session?.authorities ?? [];
    account.effectiveMenus = (session.session?.effectiveMenus ?? []).map((menu) =>
      typeof menu === "string" ? menu : menu.menuCode ?? "").filter(Boolean);
    if (definition.key === "b_no_menu") {
      expect(account.authorities).toEqual([]);
      expect(account.effectiveMenus).toEqual([]);
    } else {
      for (const permission of READ_PERMISSIONS) expect(account.authorities).toContain(permission);
      expect(account.authorities.some((permission) =>
        permission.startsWith("overview_b") && !permission.endsWith("_read"))).toBe(false);
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
    role: { id: role.id, roleCode: ROLE_CODE, permissionCodes: READ_PERMISSIONS, menuIds, grantTicket },
    checker: checker.username,
    cleanup: {
      accounts: Object.values(accounts).map(({ accountId, username }) => ({ accountId, username })),
      roles: [{ id: role.id, roleCode: ROLE_CODE }],
      order: [
        "逐账号读取最新 CAS 版本后 reset-2fa、role=unassigned、status=disabled、sessions/revoke。",
        "提交角色删除工单并由 A 域 d_checker 独立批准。",
        "核对账号、角色、会话、pending 工单及本轮幂等记录。",
      ],
    },
  }, null, 2));
});

async function approve(browser: Browser, checker: Checker, ticketId: string) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  try {
    await loginMfa(page, checker);
    await ok(await page.request.post(`/api/admin/platform/audit/operations/${ticketId}/approve`, {
      headers: { "Idempotency-Key": `${RUN_ID}-${ticketId}-approve` },
      data: { reason: `${RUN_ID} 独立复核 B 域只读授权` },
    }));
  } finally {
    await context.close();
  }
}

async function loginRoot(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
  await page.locator('input[autocomplete="username"]').fill(ROOT_USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(ROOT_PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function loginMfa(page: Page, account: Checker) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 15_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function activate(page: Page, username: string, temporaryPassword: string, finalPassword: string) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const payload = await (await responsePromise).json() as { data?: { mfa?: { manualKey?: string } } };
  let secret = payload.data?.mfa?.manualKey?.trim() ?? "";
  let changed = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) break;
    const otp = page.getByLabel("一次性验证码");
    if (await otp.isVisible().catch(() => false)) {
      secret = secret || (await page.locator("code").first().textContent().catch(() => ""))?.trim() || "";
      expect(secret).not.toBe("");
      await otp.fill(await freshTotp(secret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
    if (!changed && await page.getByRole("heading", { name: "首次登录修改密码" }).isVisible().catch(() => false)) {
      await page.getByLabel("新密码", { exact: true }).fill(finalPassword);
      await page.getByLabel("确认新密码", { exact: true }).fill(finalPassword);
      await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
      changed = true;
    }
    await page.waitForTimeout(250);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  expect(changed).toBe(true);
  return secret;
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
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
  const sorted = [...right].sort();
  return left.length === right.length && [...left].sort().every((value, index) => value === sorted[index]);
}

async function ok<T>(response: { status(): number; text(): Promise<string> }) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as Envelope<T>;
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
