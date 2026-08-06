import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

/**
 * One-shot recovery for an unhanded A-AUTO-002 actor.  It is deliberately
 * separate from the A-002 business probe and is inert without the controller
 * cleanup capability.  The only permitted target is the recorded failed
 * fixture; audit and outbox rows are evidence and are never deleted.
 */
const TARGET_DATABASE = "nexion_acceptance_20260729_114336";
const FAILED = { id: "99621", username: "a002_primary_3903da2560c1" };

type Credentials = { username: string; password: string; totpSecret: string };
type Config = { baseUrl: string; evidenceDir: string; cleanupToken: string; fixtureAdmin: Credentials; mysqlBin: string; mysqlPassword: string };
type Operator = { id: string; username: string; role: string; status: string; version: string; sessions: number; tfa: boolean };

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function config(): Config {
  if (process.env.A002_FAILED_FIXTURE_CLEANUP !== "1") throw new Error("A002_FAILED_FIXTURE_CLEANUP=1_REQUIRED");
  const baseUrl = required("A002_SETUP_BASE_URL");
  const host = new URL(baseUrl).hostname;
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(host)) throw new Error("A002_LOOPBACK_REQUIRED");
  const evidenceDir = path.resolve(required("A002_CLEANUP_EVIDENCE_DIR"));
  if (!/bug-pic[\\/]\.restricted[\\/]/i.test(evidenceDir)) throw new Error("A002_RESTRICTED_PATH_REQUIRED");
  if (process.env.A002_FIXTURE_ADMIN_EXCEPTION !== "1") throw new Error("A002_FIXTURE_ADMIN_EXCEPTION=1_REQUIRED");
  return {
    baseUrl, evidenceDir, cleanupToken: required("A002_FIXTURE_CLEANUP_TOKEN"),
    fixtureAdmin: { username: required("A002_FIXTURE_ADMIN_USERNAME"), password: required("A002_FIXTURE_ADMIN_PASSWORD"), totpSecret: process.env.A002_FIXTURE_ADMIN_TOTP_SECRET?.trim() ?? "" },
    mysqlBin: process.env.A002_MYSQL_BIN?.trim() || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe",
    mysqlPassword: required("A002_MYSQL_PASSWORD"),
  };
}

function atomicJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temp, file);
}

function mysql(active: Config, sql: string) {
  return execFileSync(active.mysqlBin, ["-N", "-B", "-h", "127.0.0.1", "-P", "3306", "-u", "root", TARGET_DATABASE, "-e", sql], {
    encoding: "utf8", windowsHide: true, env: { ...process.env, MYSQL_PWD: active.mysqlPassword },
  }).trim();
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const source = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const part of source) {
    const index = alphabet.indexOf(part);
    if (index < 0) throw new Error("A002_TOTP_SECRET_INVALID");
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < key.length; index += 1) key[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function envelope<T>(response: APIResponse) {
  const raw = await response.text();
  expect(response.status(), raw).toBe(200);
  const body = JSON.parse(raw) as { code?: number; data?: T };
  expect(body.code, raw).toBe(0);
  return body.data as T;
}

async function login(page: Page, active: Config, credential: Credentials) {
  await page.request.post("/api/admin/auth/logout").catch(() => undefined);
  await page.goto(active.baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(credential.username);
  await page.locator('input[autocomplete="current-password"]').fill(credential.password);
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/admin/auth/login" && item.request().method() === "POST");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await response).status()).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  if (await otp.isVisible({ timeout: 1_000 }).catch(() => false)) {
    const remaining = 30_000 - (Date.now() % 30_000);
    if (remaining <= 4_000) await page.waitForTimeout(remaining + 500);
    await otp.fill(totp(credential.totpSecret));
    const verified = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/admin/auth/mfa/verify" && item.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await verified).status()).toBe(200);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function readOperator(page: Page, id: string) {
  const overview = await envelope<{ operators: Operator[] }>(await page.request.get("/api/admin/platform/accounts/overview"));
  return overview.operators.find((entry) => entry.id === id);
}

function snapshot(active: Config) {
  return {
    account: mysql(active, `SELECT id,username,status,super_admin,is_deleted FROM nx_admin WHERE id=${FAILED.id} AND username='${FAILED.username}'`),
    state: mysql(active, `SELECT admin_id,tfa_required,tfa_secret_encrypted IS NOT NULL,sessions_revoked_at IS NOT NULL,is_deleted FROM nx_admin_account_state WHERE admin_id=${FAILED.id}`),
    roles: mysql(active, `SELECT COUNT(*) FROM nx_admin_role_relation WHERE admin_id=${FAILED.id}`),
    audit: mysql(active, `SELECT COUNT(*) FROM nx_audit_log WHERE resource_id='${FAILED.id}' OR actor_username='${FAILED.username}'`),
    outbox: mysql(active, `SELECT COUNT(*) FROM nx_event_outbox WHERE aggregate_id='${FAILED.id}'`),
  };
}

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("A-AUTO-002 removes only failed unhanded actor 99621 while preserving audit/outbox", async ({ page }) => {
  const active = config();
  const evidence: Record<string, unknown> = { target: FAILED, database: TARGET_DATABASE, runId: "pc-full-acceptance-20260729-114336", cleanupCapabilityAccepted: Boolean(active.cleanupToken) };
  try {
    expect(mysql(active, "SELECT DATABASE()")).toBe(TARGET_DATABASE);
    const cleaner = active.fixtureAdmin;
    if (cleaner.username !== "superadmin") throw new Error("A002_FIXTURE_ADMIN_EXCEPTION_MUST_BE_SUPERADMIN");
    await login(page, active, cleaner);
    const session = await envelope<{ session?: { username?: string; authorities?: string[] } }>(await page.request.get("/api/admin/auth/session"));
    expect(session.session?.username).toBe(cleaner.username);
    expect(session.session?.authorities ?? []).toContain("platform_a1_account_disable");
    evidence.cleaner = { username: cleaner.username, fixtureAdminException: true, statusAuthority: true };
    evidence.before = snapshot(active);
    let current = await readOperator(page, FAILED.id);
    expect(current?.username).toBe(FAILED.username);
    const reason = "pc-full-acceptance-20260729-114336 A-AUTO-002 failed unhanded fixture cleanup";
    // A1 correctly forbids direct force-logout of a super target.  Disabling
    // the failed fixture below is the governed revocation path and must revoke
    // its sessions atomically; retain the 403 as policy evidence rather than
    // attempting a bypass.
    const directRevoke = await page.request.post(`/api/admin/platform/accounts/${FAILED.id}/sessions/revoke`, { headers: { "Idempotency-Key": `a002-cleanup-${randomBytes(8).toString("hex")}` }, data: { reason, operator: cleaner.username, expectedVersion: current!.version } });
    const directRevokeBody = await directRevoke.json().catch(() => null) as { message?: string } | null;
    expect(directRevoke.status()).toBe(403);
    expect(directRevokeBody?.message).toBe("FORCE_LOGOUT_SUPER_TARGET_FORBIDDEN");
    evidence.directSuperSessionRevoke = { http: directRevoke.status(), message: directRevokeBody?.message, governedFallback: "disable" };
    current = await readOperator(page, FAILED.id);
    await envelope(await page.request.patch(`/api/admin/platform/accounts/${FAILED.id}/status`, { headers: { "Idempotency-Key": `a002-cleanup-${randomBytes(8).toString("hex")}` }, data: { status: "disabled", reason, operator: cleaner.username, expectedVersion: current!.version } }));
    current = await readOperator(page, FAILED.id);
    await envelope(await page.request.post(`/api/admin/platform/accounts/${FAILED.id}/reset-2fa`, { headers: { "Idempotency-Key": `a002-cleanup-${randomBytes(8).toString("hex")}` }, data: { reason, operator: cleaner.username, expectedVersion: current!.version } }));
    evidence.afterApiRecovery = { account: await readOperator(page, FAILED.id), database: snapshot(active) };
    const foreignKeys = mysql(active, "SELECT TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='nx_admin' ORDER BY TABLE_NAME").split(/\r?\n/).filter(Boolean);
    expect(foreignKeys).toEqual(["nx_admin_account_state"]);
    const deleted = mysql(active, `START TRANSACTION; DELETE FROM nx_admin_role_relation WHERE admin_id=${FAILED.id}; DELETE FROM nx_admin_account_state WHERE admin_id=${FAILED.id}; DELETE FROM nx_admin WHERE id=${FAILED.id} AND username='${FAILED.username}'; COMMIT; SELECT (SELECT COUNT(*) FROM nx_admin WHERE id=${FAILED.id}) AS account_rows,(SELECT COUNT(*) FROM nx_admin_account_state WHERE admin_id=${FAILED.id}) AS state_rows,(SELECT COUNT(*) FROM nx_admin_role_relation WHERE admin_id=${FAILED.id}) AS role_rows;`);
    expect(deleted).toBe("0\t0\t0");
    evidence.afterDeletion = { database: snapshot(active), foreignKeys };
    expect(await readOperator(page, FAILED.id)).toBeUndefined();
    const anonymous = await page.context().request.post(`${active.baseUrl}/api/admin/auth/login`, { data: { username: FAILED.username, password: `removed-${randomBytes(12).toString("hex")}` } });
    evidence.loginAfterRemoval = { http: anonymous.status(), body: await anonymous.json().catch(() => null) };
    expect(anonymous.status()).toBe(401);
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    atomicJson(path.join(active.evidenceDir, "a002-failed-fixture-cleanup.json"), evidence);
  }
});
