import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";

const RUN_ID = "pc-full-acceptance-20260728-151023";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const CHECKER_FIXTURE_PATH = process.env.A_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`;
const MYSQL = process.env.NEXION_MYSQL_EXE ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const DB_NAME = process.env.NEXION_DB_NAME ?? "nexion_acceptance_20260728_151023";
const DB_PASSWORD = process.env.NEXION_DB_PASSWORD ?? "";
const REDIS = process.env.NEXION_REDIS_CLI ?? "D:/software/Redis-8.6.1/redis-cli.exe";
const REDIS_PASSWORD = process.env.NEXION_REDIS_PASSWORD ?? "";
const REDIS_DB = process.env.NEXION_REDIS_DB ?? "14";
const FIRST_RUN_ACCOUNT_ID = 99_337;
const FIRST_RUN_ROLE_ID = 4_030;

type ApiEnvelope<T> = { code?: number; message?: string; data?: T };
type Account = {
  id: string | number;
  username: string;
  role: string;
  status: string;
  tfa: boolean;
  sessions: number;
  version: string | number;
};
type CheckerFixture = {
  accounts: {
    d_checker: {
      accountId: string;
      username: string;
      password: string;
      totpSecret: string;
    };
  };
};

test.describe.configure({ mode: "serial", timeout: 600_000 });

test("A–M 统一复审后精确清理隔离账号、角色、幂等记录与 Redis DB14", async ({ page, browser }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(DB_PASSWORD, "NEXION_DB_PASSWORD is required").not.toBe("");
  expect(REDIS_PASSWORD, "NEXION_REDIS_PASSWORD is required").not.toBe("");
  const checker = (JSON.parse(readFileSync(CHECKER_FIXTURE_PATH, "utf8")) as CheckerFixture).accounts.d_checker;

  await loginPassword(page, ROOT_USERNAME, ROOT_PASSWORD);
  const initialAccounts = await accountsOverview(page);
  const initialRunRoles = (await rolesOverview(page))
    .filter((role) => Number(role.id) >= FIRST_RUN_ROLE_ID);
  const checkerPage = initialRunRoles.length > 0 ? await loginChecker(browser, checker) : null;
  try {
    const runAccounts = initialAccounts.filter((account) => Number(account.id) >= FIRST_RUN_ACCOUNT_ID);
    expect(runAccounts.length, "必须识别到本轮隔离账号").toBeGreaterThan(0);

    for (const account of runAccounts) {
      if (String(account.id) !== checker.accountId && !isSanitized(account)) {
        await sanitizeAccount(page, account.id);
      }
    }

    for (const role of initialRunRoles) {
      expect(checkerPage, "存在待删隔离角色时必须保留独立 checker").toBeTruthy();
      const proposal = await okEnvelope<Record<string, unknown>>(
        await page.request.delete(`/api/admin/platform/roles/${role.id}`, {
          headers: { "Idempotency-Key": `${RUN_ID}-final-cleanup-role-${role.id}` },
          data: {
            reason: `${RUN_ID} 全量复审完成后删除隔离角色`,
            operator: ROOT_USERNAME,
          },
        }),
      );
      const ticketId = String(proposal.operationId ?? proposal.id ?? "");
      expect(ticketId, `角色 ${role.roleCode} 删除必须生成独立复核工单`).toMatch(/^(?:WO|OP)-/);
      await okEnvelope(await checkerPage!.request.post(
        `/api/admin/platform/audit/operations/${ticketId}/approve`,
        {
          headers: { "Idempotency-Key": `${RUN_ID}-final-cleanup-role-${role.id}-approve` },
          data: { reason: `${RUN_ID} 独立复核删除隔离角色 ${role.roleCode}` },
        },
      ));
    }
  } finally {
    if (checkerPage) await checkerPage.context().close();
  }

  const checkerCurrent = await accountById(page, checker.accountId);
  if (!isSanitized(checkerCurrent)) await sanitizeAccount(page, checker.accountId);

  const finalAccounts = (await accountsOverview(page))
    .filter((account) => Number(account.id) >= FIRST_RUN_ACCOUNT_ID);
  for (const account of finalAccounts) {
    expect(account, `隔离账号 ${account.id}/${account.username} 必须完全失活`).toMatchObject({
      role: "unassigned",
      status: "disabled",
      tfa: false,
      sessions: 0,
    });
  }
  expect((await rolesOverview(page)).filter((role) => Number(role.id) >= FIRST_RUN_ROLE_ID)).toEqual([]);

  const audit = await okEnvelope<{ operationQueue: Array<{ status: string; obj: string; ts: string }> }>(
    await page.request.get("/api/admin/platform/audit/overview?limit=500"),
  );
  expect(
    audit.operationQueue.filter((ticket) =>
      ticket.status.toLowerCase() === "pending"
      && new Date(ticket.ts).getTime() >= new Date("2026-07-28T14:00:00").getTime()
      && /R151023|MS4|K2_FLAG|J2_RO/i.test(ticket.obj)),
    "本轮角色清理不得留下待审批工单",
  ).toEqual([]);

  const deletedIdempotency = Number(mysql(`
    DELETE FROM nx_admin_idempotency_record
      WHERE created_at >= '2026-07-28 14:00:00';
    SELECT ROW_COUNT();
  `));
  expect(deletedIdempotency).toBeGreaterThanOrEqual(0);
  expect(mysql(`
    SELECT COUNT(*) FROM nx_admin_idempotency_record
      WHERE created_at >= '2026-07-28 14:00:00';
  `)).toBe("0");

  const redisKeysBefore = Number(redis("DBSIZE"));
  redis("FLUSHDB");
  expect(Number(redis("DBSIZE")), "专用 Redis DB14 必须无验收残留").toBe(0);

  test.info().annotations.push(
    { type: "accounts-cleaned", description: String(finalAccounts.length) },
    { type: "roles-cleaned", description: "all role ids >= 4030" },
    { type: "idempotency-deleted", description: String(deletedIdempotency) },
    { type: "redis-keys-deleted", description: String(redisKeysBefore) },
  );
});

function isSanitized(account: Account) {
  return account.role === "unassigned"
    && account.status === "disabled"
    && account.tfa === false
    && Number(account.sessions) === 0;
}

async function loginPassword(page: Page, username: string, password: string) {
  const sessionProbe = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/admin/auth/session",
    { timeout: 30_000 },
  );
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await sessionProbe;
  const usernameInput = page.locator('input[autocomplete="username"]');
  await expect(usernameInput).toBeVisible({ timeout: 20_000 });
  await usernameInput.fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const loginResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/admin/auth/login"
      && response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await loginResponse).status()).toBeLessThan(400);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function loginChecker(
  browser: Browser,
  checker: CheckerFixture["accounts"]["d_checker"],
) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  const sessionProbe = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/admin/auth/session",
    { timeout: 30_000 },
  );
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await sessionProbe;
  const usernameInput = page.locator('input[autocomplete="username"]');
  await expect(usernameInput).toBeVisible({ timeout: 20_000 });
  await usernameInput.fill(checker.username);
  await page.locator('input[autocomplete="current-password"]').fill(checker.password);
  const loginResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/admin/auth/login"
      && response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await loginResponse).status()).toBeLessThan(400);
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 20_000 });
  await otp.fill(currentTotp(checker.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  return page;
}

async function sanitizeAccount(page: Page, accountId: string | number) {
  let current = await accountById(page, accountId);
  if (current.tfa) {
    await mutateAccount(page, accountId, "POST", "reset-2fa", {
      reason: `${RUN_ID} 全量复审完成后清除隔离账号 MFA`,
    });
  }
  current = await accountById(page, accountId);
  if (current.role !== "unassigned") {
    await mutateAccount(page, accountId, "PATCH", "role", {
      role: "unassigned",
      reason: `${RUN_ID} 全量复审完成后解除隔离角色`,
    });
  }
  current = await accountById(page, accountId);
  if (current.status !== "disabled") {
    await mutateAccount(page, accountId, "PATCH", "status", {
      status: "disabled",
      reason: `${RUN_ID} 全量复审完成后停用隔离账号`,
    });
  }
  current = await accountById(page, accountId);
  if (Number(current.sessions) > 0) {
    await mutateAccount(page, accountId, "POST", "sessions/revoke", {
      reason: `${RUN_ID} 全量复审完成后撤销隔离会话`,
    });
  }
}

async function mutateAccount(
  page: Page,
  accountId: string | number,
  method: "PATCH" | "POST",
  suffix: string,
  data: Record<string, unknown>,
) {
  const current = await accountById(page, accountId);
  await okEnvelope(await page.request.fetch(`/api/admin/platform/accounts/${accountId}/${suffix}`, {
    method,
    headers: { "Idempotency-Key": `${RUN_ID}-final-cleanup-${accountId}-${suffix}` },
    data: {
      ...data,
      operator: ROOT_USERNAME,
      expectedVersion: String(current.version),
    },
  }));
}

async function accountById(page: Page, accountId: string | number) {
  const account = (await accountsOverview(page))
    .find((candidate) => String(candidate.id) === String(accountId));
  expect(account, `隔离账号 ${accountId} 必须存在`).toBeTruthy();
  return account!;
}

async function accountsOverview(page: Page) {
  const overview = await okEnvelope<{ operators: Account[] }>(
    await page.request.get("/api/admin/platform/accounts/overview"),
  );
  return overview.operators;
}

async function rolesOverview(page: Page) {
  const overview = await okEnvelope<{ roles: Array<{ id: number; roleCode: string }> }>(
    await page.request.get("/api/admin/platform/roles/overview"),
  );
  return overview.roles;
}

async function okEnvelope<T>(response: { status(): number; text(): Promise<string> }) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as ApiEnvelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}

function mysql(statement: string) {
  return execFileSync(MYSQL, [
    "-h", "127.0.0.1",
    "-uroot",
    `--password=${DB_PASSWORD}`,
    "-N", "-B",
    "-D", DB_NAME,
    "-e", statement,
  ], { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/).at(-1) ?? "";
}

function redis(command: string) {
  return execFileSync(REDIS, [
    "-h", "127.0.0.1",
    "-a", REDIS_PASSWORD,
    "-n", REDIS_DB,
    command,
  ], { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/).at(-1) ?? "";
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
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
