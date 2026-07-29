import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const FIXTURE_PATH = process.env.M_PERMISSION_FIXTURE_PATH ?? "";
const EVIDENCE_DIR = process.env.M_PERMISSION_CLEANUP_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/M-review-L/permissions/cleanup";
const MYSQL = process.env.NEXION_MYSQL_EXE ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const DB_NAME = process.env.NEXION_DB_NAME ?? "nexion_acceptance_20260728_151023";
const DB_PASSWORD = process.env.NEXION_DB_PASSWORD ?? "";
const REDIS = process.env.NEXION_REDIS_CLI ?? "D:/software/Redis-8.6.1/redis-cli.exe";
const REDIS_PASSWORD = process.env.NEXION_REDIS_PASSWORD ?? "";
const REDIS_DB = process.env.NEXION_REDIS_DB ?? "14";

type FixtureAccount = { id: string; username: string; password: string };
type Fixture = {
  runId: string;
  accounts: Record<string, FixtureAccount>;
};
type ApiEnvelope<T> = { code?: number; data?: T };

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("L→M 全新权限夹具按最新 CAS 清除 MFA、角色、会话、Redis 与幂等记录", async ({ page }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(FIXTURE_PATH, "M_PERMISSION_FIXTURE_PATH is required").not.toBe("");
  expect(DB_PASSWORD, "NEXION_DB_PASSWORD is required").not.toBe("");
  expect(REDIS_PASSWORD, "NEXION_REDIS_PASSWORD is required").not.toBe("");
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
  const accounts = Object.values(fixture.accounts);

  await loginRoot(page);
  for (const account of accounts) await sanitizeAccount(page, fixture.runId, account);

  const overview = await accountsOverview(page);
  const finalAccounts = accounts.map((account) => {
    const current = overview.find((candidate) => String(candidate.id) === account.id);
    expect(current).toMatchObject({
      role: "unassigned",
      status: "disabled",
      tfa: false,
      sessions: 0,
    });
    return {
      accountId: account.id,
      username: account.username,
      role: current?.role,
      status: current?.status,
      tfa: current?.tfa,
      sessions: current?.sessions,
    };
  });

  for (const account of accounts) {
    const disabledLogin = await page.request.post("/api/admin/auth/login", {
      data: { username: account.username, password: account.password },
    });
    expect([401, 403]).toContain(disabledLogin.status());
  }

  const escapedRunId = sql(fixture.runId);
  const idempotencyCleanup = mysql(`
    DELETE FROM nx_admin_idempotency_record
      WHERE idempotency_key LIKE '${escapedRunId}%'
         OR idempotency_key LIKE 'm-permission-${escapedRunId}-%';
    SELECT COUNT(*) FROM nx_admin_idempotency_record
      WHERE idempotency_key LIKE '${escapedRunId}%'
         OR idempotency_key LIKE 'm-permission-${escapedRunId}-%';
  `);
  expect(idempotencyCleanup).toBe("0");

  const redisPatterns = [
    `*${fixture.runId}*`,
    ...accounts.flatMap((account) => [`*${account.username}*`, `*${account.id}*`]),
  ];
  const redisKeysBefore = Array.from(new Set(redisPatterns.flatMap(redisScan)));
  const allowedCounter = new RegExp(
    `^ops:admin:mfa-used-counter:(?:${accounts.map((account) => account.id).join("|")}):\\d+$`,
  );
  expect(
    redisKeysBefore.filter((key) => !allowedCounter.test(key)),
    "Only exact MFA replay counters for the three isolated accounts may be deleted",
  ).toEqual([]);
  for (const key of redisKeysBefore) redisDelete(key);
  const redisKeys = Array.from(new Set(redisPatterns.flatMap(redisScan)));
  expect(redisKeys, `Redis DB ${REDIS_DB} must not retain L→M permission identities`).toEqual([]);

  writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify({
    runId: fixture.runId,
    finalAccounts,
    customRolesCreated: 0,
    activeAccounts: 0,
    boundRoles: 0,
    mfaBindings: 0,
    sessions: 0,
    redisDb: Number(REDIS_DB),
    redisKeysDeleted: redisKeysBefore,
    redisKeys,
    idempotencyRecords: 0,
  }, null, 2));
});

async function loginRoot(page: Page) {
  await page.context().clearCookies();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(ROOT_USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(ROOT_PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function sanitizeAccount(page: Page, runId: string, account: FixtureAccount) {
  let current = await accountById(page, account.id);
  if (current.tfa === true) {
    await mutateAccount(page, runId, account.id, "POST", "reset-2fa", {
      reason: `${runId} 清除 L→M 权限夹具 MFA`,
    });
  }
  current = await accountById(page, account.id);
  if (current.role !== "unassigned") {
    await mutateAccount(page, runId, account.id, "PATCH", "role", {
      role: "unassigned",
      reason: `${runId} 解除 L→M 权限夹具角色`,
    });
  }
  current = await accountById(page, account.id);
  if (current.status !== "disabled") {
    await mutateAccount(page, runId, account.id, "PATCH", "status", {
      status: "disabled",
      reason: `${runId} 停用 L→M 权限夹具`,
    });
  }
  current = await accountById(page, account.id);
  if (Number(current.sessions) > 0) {
    await mutateAccount(page, runId, account.id, "POST", "sessions/revoke", {
      reason: `${runId} 撤销 L→M 权限夹具会话`,
    });
  }
}

async function mutateAccount(
  page: Page,
  runId: string,
  accountId: string,
  method: "PATCH" | "POST",
  suffix: string,
  data: Record<string, unknown>,
) {
  const current = await accountById(page, accountId);
  await okEnvelope(await page.request.fetch(`/api/admin/platform/accounts/${accountId}/${suffix}`, {
    method,
    headers: { "Idempotency-Key": `${runId}-cleanup-${accountId}-${suffix}` },
    data: {
      ...data,
      operator: ROOT_USERNAME,
      expectedVersion: String(current.version),
    },
  }));
}

async function accountById(page: Page, accountId: string) {
  const account = (await accountsOverview(page)).find((candidate) => String(candidate.id) === accountId);
  expect(account, `M fixture account ${accountId} must exist`).toBeTruthy();
  return account!;
}

async function accountsOverview(page: Page) {
  const overview = await okEnvelope<{ operators: Array<Record<string, unknown>> }>(
    await page.request.get("/api/admin/platform/accounts/overview"),
  );
  return overview.operators;
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
  ], { encoding: "utf8" }).trim().split(/\r?\n/).at(-1) ?? "";
}

function redisScan(pattern: string) {
  const output = execFileSync(REDIS, [
    "-h", "127.0.0.1",
    "-a", REDIS_PASSWORD,
    "-n", REDIS_DB,
    "--scan",
    "--pattern", pattern,
  ], { encoding: "utf8", windowsHide: true });
  return output.split(/\r?\n/).map((key) => key.trim()).filter(Boolean);
}

function redisDelete(key: string) {
  const result = execFileSync(REDIS, [
    "-h", "127.0.0.1",
    "-a", REDIS_PASSWORD,
    "-n", REDIS_DB,
    "DEL", key,
  ], { encoding: "utf8", windowsHide: true }).trim();
  expect(result, `Redis key ${key} must be deleted exactly once`).toBe("1");
}

function sql(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "''");
}
