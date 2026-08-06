import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

const RUN_ID = "pc-full-acceptance-20260729-114336";
const TARGET_DATABASE = "nexion_acceptance_20260729_114336";
const A002_MANIFEST = path.resolve("D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/a-auto-002/manifest.json");
const TARGETS = [
  { id: "99622", username: "a002_primary_ef2a6e1cf7f8", lifecycle: "a002" },
  { id: "99623", username: "a002_secondary_99b30a29826d", lifecycle: "a002" },
  { id: "99628", username: "a003_lifecycle_d3712a77f2", lifecycle: "a003" },
] as const;

type Credentials = { accountId?: string; username: string; password: string; totpSecret: string };
type Operator = {
  id: string;
  username: string;
  role: string;
  status: "enabled" | "disabled";
  version: string;
  sessions: number;
  tfa: boolean;
};
type Config = {
  baseUrl: string;
  evidenceDir: string;
  cleanupToken: string;
  fixtureAdmin: Credentials;
  mysqlBin: string;
  mysqlPassword: string;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function config(): Config {
  if (process.env.A002_A003_FINAL_CLEANUP !== "1") throw new Error("A002_A003_FINAL_CLEANUP=1_REQUIRED");
  if (process.env.A002_FIXTURE_ADMIN_EXCEPTION !== "1") throw new Error("A002_FIXTURE_ADMIN_EXCEPTION=1_REQUIRED");
  const baseUrl = required("A002_SETUP_BASE_URL");
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(new URL(baseUrl).hostname)) throw new Error("A002_LOOPBACK_REQUIRED");
  const evidenceDir = path.resolve(required("A002_FINAL_CLEANUP_EVIDENCE_DIR"));
  if (!/bug-pic[\\/]\.restricted[\\/]/i.test(evidenceDir)) throw new Error("A002_RESTRICTED_PATH_REQUIRED");
  const fixtureAdmin = {
    username: required("A002_FIXTURE_ADMIN_USERNAME"),
    password: required("A002_FIXTURE_ADMIN_PASSWORD"),
    totpSecret: process.env.A002_FIXTURE_ADMIN_TOTP_SECRET?.trim() ?? "",
  };
  if (fixtureAdmin.username !== "superadmin") throw new Error("A002_FIXTURE_ADMIN_EXCEPTION_MUST_BE_SUPERADMIN");
  return {
    baseUrl,
    evidenceDir,
    cleanupToken: required("A002_ACTOR_FINAL_CLEANUP_TOKEN"),
    fixtureAdmin,
    mysqlBin: process.env.A002_MYSQL_BIN?.trim() || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe",
    mysqlPassword: required("A002_MYSQL_PASSWORD"),
  };
}

function atomicJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

function mysql(active: Config, sql: string) {
  return execFileSync(active.mysqlBin, ["-N", "-B", "-h", "127.0.0.1", "-P", "3306", "-u", "root", TARGET_DATABASE, "-e", sql], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, MYSQL_PWD: active.mysqlPassword },
  }).trim();
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
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

async function login(page: Page, active: Config) {
  await page.request.post("/api/admin/auth/logout").catch(() => undefined);
  await page.goto(active.baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(active.fixtureAdmin.username);
  await page.locator('input[autocomplete="current-password"]').fill(active.fixtureAdmin.password);
  const loginResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await loginResponse).status()).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  if (await otp.isVisible({ timeout: 1_000 }).catch(() => false)) {
    if (!active.fixtureAdmin.totpSecret) throw new Error("A002_FIXTURE_ADMIN_MFA_SECRET_REQUIRED");
    const remaining = 30_000 - (Date.now() % 30_000);
    if (remaining <= 4_000) await page.waitForTimeout(remaining + 500);
    await otp.fill(totp(active.fixtureAdmin.totpSecret));
    const verifyResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/mfa/verify" && response.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await verifyResponse).status()).toBe(200);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function envelope<T>(response: APIResponse) {
  const raw = await response.text();
  expect(response.status(), raw).toBe(200);
  const body = JSON.parse(raw) as { code?: number; data?: T };
  expect(body.code, raw).toBe(0);
  return body.data as T;
}

async function operators(page: Page) {
  return (await envelope<{ operators: Operator[] }>(await page.request.get("/api/admin/platform/accounts/overview"))).operators;
}

async function operator(page: Page, id: string) {
  return (await operators(page)).find((entry) => String(entry.id) === id);
}

function retainedCounts(active: Config, id: string, username: string) {
  return {
    audit: Number(mysql(active, `SELECT COUNT(*) FROM nx_audit_log WHERE resource_id='${id}' OR actor_id=${id} OR actor_username='${username}'`) || "0"),
    a2Tickets: Number(mysql(active, `SELECT COUNT(*) FROM nx_audit_operation_ticket WHERE object_text LIKE '%${id}%' OR before_value LIKE '%${id}%' OR after_value LIKE '%${id}%' OR operator_name='${username}' OR command_json LIKE '%${id}%'`) || "0"),
    a2Locks: Number(mysql(active, `SELECT COUNT(*) FROM nx_audit_object_lock WHERE target_id='${id}' OR operator='${username}'`) || "0"),
    outbox: Number(mysql(active, `SELECT COUNT(*) FROM nx_event_outbox WHERE aggregate_id='${id}' OR CAST(payload AS CHAR) LIKE '%${id}%'`) || "0"),
    idempotency: Number(mysql(active, `SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE idempotency_key LIKE '%${id}%' OR CAST(response_json AS CHAR) LIKE '%${id}%' OR error_message LIKE '%${id}%'`) || "0"),
  };
}

function mutableSnapshot(active: Config, id: string, username: string) {
  return {
    account: mysql(active, `SELECT id,username,status,super_admin,is_deleted FROM nx_admin WHERE id=${id} AND username='${username}'`),
    state: mysql(active, `SELECT admin_id,tfa_required,tfa_secret_encrypted IS NOT NULL,sessions_revoked_at IS NOT NULL,credential_delivery_status,is_deleted FROM nx_admin_account_state WHERE admin_id=${id}`),
    roleRelations: mysql(active, `SELECT role_id,is_deleted FROM nx_admin_role_relation WHERE admin_id=${id} ORDER BY id`),
  };
}

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("A002/A003 final actor cleanup removes mutable identities and retires the sole credential manifest", async ({ page }) => {
  const active = config();
  const originalManifest = readFileSync(A002_MANIFEST);
  const manifest = JSON.parse(originalManifest.toString("utf8")) as {
    runId?: string;
    operators?: { primary?: Credentials; secondary?: Credentials };
  };
  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    database: TARGET_DATABASE,
    targets: TARGETS,
    fixtureAdminException: true,
    originalManifestSha256: createHash("sha256").update(originalManifest).digest("hex"),
    cleanupCapabilityAccepted: Boolean(active.cleanupToken),
  };
  try {
    expect(mysql(active, "SELECT DATABASE()")).toBe(TARGET_DATABASE);
    expect(manifest.runId).toBe(RUN_ID);
    expect(manifest.operators?.primary?.accountId).toBe("99622");
    expect(manifest.operators?.secondary?.accountId).toBe("99623");
    await login(page, active);
    const beforeApi = Object.fromEntries(await Promise.all(TARGETS.map(async (target) => [target.id, await operator(page, target.id)])));
    const beforeDb = Object.fromEntries(TARGETS.map((target) => [target.id, mutableSnapshot(active, target.id, target.username)]));
    const retainedBefore = Object.fromEntries(TARGETS.map((target) => [target.id, retainedCounts(active, target.id, target.username)]));
    evidence.before = { api: beforeApi, database: beforeDb, retained: retainedBefore };

    const a003 = beforeApi["99628"];
    expect(a003?.status).toBe("disabled");
    expect(a003?.sessions).toBe(0);
    expect(a003?.tfa).toBe(false);
    expect(mysql(active, "SELECT COUNT(*) FROM nx_admin_role_relation WHERE admin_id=99628 AND is_deleted=0")).toBe("0");

    const recovery: Record<string, unknown> = {};
    for (const target of TARGETS.filter((entry) => entry.lifecycle === "a002")) {
      let current = await operator(page, target.id);
      expect(current?.username).toBe(target.username);
      const reason = `${RUN_ID} final temporary A002 actor cleanup`;
      const revoke = await page.request.post(`/api/admin/platform/accounts/${target.id}/sessions/revoke`, {
        headers: { "Idempotency-Key": `${RUN_ID}:a002-final:${target.id}:revoke:${randomBytes(5).toString("hex")}` },
        data: { reason, operator: active.fixtureAdmin.username, expectedVersion: current!.version },
      });
      const revokeBody = await revoke.json().catch(() => null) as { message?: string } | null;
      expect(revoke.status()).toBe(403);
      expect(revokeBody?.message).toBe("FORCE_LOGOUT_SUPER_TARGET_FORBIDDEN");
      current = await operator(page, target.id);
      const disabled = await envelope<Operator>(await page.request.patch(`/api/admin/platform/accounts/${target.id}/status`, {
        headers: { "Idempotency-Key": `${RUN_ID}:a002-final:${target.id}:disable:${randomBytes(5).toString("hex")}` },
        data: { status: "disabled", reason, operator: active.fixtureAdmin.username, expectedVersion: current!.version },
      }));
      expect(disabled.status).toBe("disabled");
      expect(disabled.sessions).toBe(0);
      current = await operator(page, target.id);
      const reset = await envelope<Operator>(await page.request.post(`/api/admin/platform/accounts/${target.id}/reset-2fa`, {
        headers: { "Idempotency-Key": `${RUN_ID}:a002-final:${target.id}:reset-mfa:${randomBytes(5).toString("hex")}` },
        data: { reason, operator: active.fixtureAdmin.username, expectedVersion: current!.version },
      }));
      expect(reset.tfa).toBe(false);
      expect(reset.sessions).toBe(0);
      recovery[target.id] = {
        directRevoke: { http: revoke.status(), message: revokeBody?.message, governedFallback: "disable" },
        afterDisableReset: { status: reset.status, sessions: reset.sessions, tfa: reset.tfa },
      };
    }
    evidence.governedRecovery = recovery;

    const foreignKeys = mysql(active, "SELECT TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='nx_admin' ORDER BY TABLE_NAME").split(/\r?\n/).filter(Boolean);
    expect(foreignKeys).toEqual(["nx_admin_account_state"]);
    const deleted = mysql(active, `START TRANSACTION;
      DELETE FROM nx_admin_role_relation WHERE admin_id IN (99622,99623,99628);
      DELETE FROM nx_admin_account_state WHERE admin_id IN (99622,99623,99628);
      DELETE FROM nx_admin WHERE (id=99622 AND username='a002_primary_ef2a6e1cf7f8')
        OR (id=99623 AND username='a002_secondary_99b30a29826d')
        OR (id=99628 AND username='a003_lifecycle_d3712a77f2');
      COMMIT;
      SELECT
        (SELECT COUNT(*) FROM nx_admin WHERE id IN (99622,99623,99628)),
        (SELECT COUNT(*) FROM nx_admin_account_state WHERE admin_id IN (99622,99623,99628)),
        (SELECT COUNT(*) FROM nx_admin_role_relation WHERE admin_id IN (99622,99623,99628));`);
    expect(deleted).toBe("0\t0\t0");

    const afterApi = Object.fromEntries(await Promise.all(TARGETS.map(async (target) => [target.id, await operator(page, target.id)])));
    for (const target of TARGETS) expect(afterApi[target.id]).toBeUndefined();
    const afterDb = Object.fromEntries(TARGETS.map((target) => [target.id, mutableSnapshot(active, target.id, target.username)]));
    const retainedAfter = Object.fromEntries(TARGETS.map((target) => [target.id, retainedCounts(active, target.id, target.username)]));
    for (const target of TARGETS) {
      const before = retainedBefore[target.id];
      const after = retainedAfter[target.id];
      for (const key of Object.keys(before) as Array<keyof typeof before>) expect(after[key]).toBeGreaterThanOrEqual(before[key]);
    }
    evidence.after = { api: afterApi, database: afterDb, retained: retainedAfter, foreignKeys };

    const actualPasswords = [
      manifest.operators!.primary!,
      manifest.operators!.secondary!,
    ];
    const loginAfterRemoval: Record<string, number> = {};
    for (const credentials of actualPasswords) {
      const response = await page.context().request.post(`${active.baseUrl}/api/admin/auth/login`, {
        data: { username: credentials.username, password: credentials.password },
      });
      expect(response.status()).toBe(401);
      loginAfterRemoval[String(credentials.accountId)] = response.status();
    }
    const a003Login = await page.context().request.post(`${active.baseUrl}/api/admin/auth/login`, {
      data: { username: "a003_lifecycle_d3712a77f2", password: `removed-${randomBytes(18).toString("hex")}` },
    });
    expect(a003Login.status()).toBe(401);
    loginAfterRemoval["99628"] = a003Login.status();
    evidence.loginAfterRemoval = loginAfterRemoval;

    const retiredAt = new Date().toISOString();
    const retiredManifest = {
      sensitive: false,
      doNotUpload: true,
      retired: true,
      credentialsDestroyed: true,
      runId: RUN_ID,
      retiredAt,
      reason: "A002/A003 lifecycle complete; mutable actors exactly removed",
      originalManifestSha256: evidence.originalManifestSha256,
      actors: TARGETS.map(({ id, username, lifecycle }) => ({ accountId: id, username, lifecycle, retired: true })),
      evidence: path.join(active.evidenceDir, "a002-a003-final-actor-cleanup.json"),
    };
    atomicJson(A002_MANIFEST, retiredManifest);
    evidence.retiredManifest = {
      path: A002_MANIFEST,
      credentialsDestroyed: true,
      sha256: createHash("sha256").update(readFileSync(A002_MANIFEST)).digest("hex"),
    };
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    atomicJson(path.join(active.evidenceDir, "a002-a003-final-actor-cleanup.json"), evidence);
  }
});
