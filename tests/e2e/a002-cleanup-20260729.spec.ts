import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

type Account = {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  status: "enabled" | "disabled";
  version: string;
  sessions: number;
  tfa: boolean;
};
type SourceEvidence = {
  probeId: string;
  preWrite: { api: Account; database: { account: string } };
};
type CleanupConfig = {
  sourcePath: string;
  evidencePath: string;
  runId: string;
  baseUrl: string;
  username: string;
  password: string;
  mysqlBin: string;
  mysqlPassword: string;
};

function config(): CleanupConfig {
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name}_REQUIRED`);
    return value;
  };
  const sourcePath = path.resolve(required("A002_CLEANUP_SOURCE_PATH"));
  const evidencePath = path.resolve(required("A002_CLEANUP_EVIDENCE_PATH"));
  if (!/bug-pic[\\/]\.restricted[\\/]/i.test(sourcePath)
    || !/bug-pic[\\/]\.restricted[\\/]/i.test(evidencePath)) {
    throw new Error("A002_CLEANUP_RESTRICTED_PATH_REQUIRED");
  }
  return {
    sourcePath,
    evidencePath,
    runId: required("A002_CLEANUP_RUN_ID"),
    baseUrl: process.env.A002_CLEANUP_BASE_URL?.trim() || "http://127.0.0.1:3002",
    username: required("A002_CLEANUP_OPERATOR_USERNAME"),
    password: required("A002_CLEANUP_OPERATOR_PASSWORD"),
    mysqlBin: required("A002_CLEANUP_MYSQL_BIN"),
    mysqlPassword: required("A002_CLEANUP_MYSQL_PASSWORD"),
  };
}

function publicAccount(account: Account | undefined) {
  if (!account) return null;
  return {
    id: String(account.id), username: account.username, name: account.name, email: account.email,
    role: account.role, status: account.status, version: account.version,
    sessions: account.sessions, tfa: account.tfa,
  };
}

async function loginWithLocalSuperBypass(page: Page, candidate: CleanupConfig) {
  await page.goto(candidate.baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(candidate.username);
  await page.locator('input[autocomplete="current-password"]').fill(candidate.password);
  const loginResponse = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.request().method() === "POST" && requestUrl.pathname === "/api/admin/auth/login";
  });
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const response = await loginResponse;
  // Navigation can dispose the DevTools response body before Playwright reads
  // it.  The shell-vs-OTP race below is the authoritative bypass assertion.
  expect(response.status()).toBe(200);
  const result = await Promise.race([
    page.locator("aside").waitFor({ state: "visible", timeout: 15_000 }).then(() => "shell" as const),
    page.getByLabel("一次性验证码").waitFor({ state: "visible", timeout: 15_000 }).then(() => "otp" as const),
  ]);
  expect(result, "the local cleanup actor must reach the real console shell without OTP").toBe("shell");
  const group = page.getByRole("button", { name: /平台基础/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  const entry = page.locator('aside a[href="/platform/rbac"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/platform\/rbac/);
}

async function readAccount(page: Page, accountId: string): Promise<Account> {
  const response = await page.request.get("/api/admin/platform/accounts/overview");
  const raw = await response.text();
  expect(response.status(), raw).toBe(200);
  const body = JSON.parse(raw) as { code?: number; data?: { operators?: Account[] } };
  expect(body.code ?? 0, raw).toBe(0);
  const account = body.data?.operators?.find((entry) => String(entry.id) === String(accountId));
  expect(account, `probe ${accountId} must be visible to the cleanup operator`).toBeTruthy();
  expect(account!.version).toMatch(/^\d+$/);
  return account!;
}

async function patchAccount(page: Page, endpoint: string, idempotencyKey: string, data: Record<string, unknown>) {
  const response = await page.request.patch(endpoint, {
    headers: { "Idempotency-Key": idempotencyKey, "Content-Type": "application/json" },
    data,
  });
  const raw = await response.text();
  expect(response.status(), raw).toBe(200);
  const body = JSON.parse(raw) as { code?: number };
  expect(body.code ?? 0, raw).toBe(0);
}

function databaseSnapshot(candidate: CleanupConfig, database: string, accountId: string, probeId: string) {
  const escapedProbe = probeId.replace(/'/g, "''");
  const escapedId = accountId.replace(/'/g, "''");
  const sql = [
    "SELECT CONCAT_WS('|', id, username, nickname, COALESCE(email,''), status, version) FROM nx_admin WHERE id='" + escapedId + "' AND is_deleted=0;",
    "SELECT COUNT(*) FROM nx_audit_log WHERE is_deleted=0 AND resource_id='" + escapedId + "' AND detail_json LIKE '%" + escapedProbe + "%';",
    "SELECT COUNT(*) FROM nx_event_outbox WHERE is_deleted=0 AND payload LIKE '%" + escapedProbe + "%';",
    "SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE is_deleted=0 AND idempotency_key LIKE '%" + escapedProbe + "%';",
  ].join(" ");
  const output = execFileSync(candidate.mysqlBin, ["-N", "-B", "-h", "127.0.0.1", "-P", "3306", "-u", "root", database, "-e", sql], {
    encoding: "utf8",
    env: { ...process.env, MYSQL_PWD: candidate.mysqlPassword },
  }).trim().split(/\r?\n/);
  if (output.length !== 4 || output.some((line) => !line)) throw new Error("A002_CLEANUP_DATABASE_SNAPSHOT_INCOMPLETE");
  const [id, username, name, email, status, version] = output[0].split("|");
  return {
    account: { id, username, name, email, status, version },
    auditCount: Number(output[1]), outboxCount: Number(output[2]), idempotencyCount: Number(output[3]),
  };
}

test("A-002 cleanup restores only profile/status and preserves immutable evidence", async ({ page }) => {
  const candidate = config();
  const source = JSON.parse(readFileSync(candidate.sourcePath, "utf8")) as SourceEvidence;
  const pre = source.preWrite?.api;
  expect(source.probeId).toBeTruthy();
  expect(pre).toBeTruthy();
  const manifestPath = path.resolve(path.dirname(candidate.sourcePath), "..", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { database?: { name?: string } };
  const database = manifest.database?.name;
  expect(database).toBeTruthy();

  let before: Account | undefined;
  let final: Account | undefined;
  const actions: string[] = [];
  let failure: string | undefined;
  try {
    await loginWithLocalSuperBypass(page, candidate);
    before = await readAccount(page, pre.id);
    const profileDrift = before.username !== pre.username || before.name !== pre.name || before.email !== pre.email;
    if (profileDrift) {
      await patchAccount(page, `/api/admin/platform/accounts/${encodeURIComponent(pre.id)}/profile`, `${source.probeId}:cleanup-profile-super`, {
        username: pre.username, displayName: pre.name, email: pre.email,
        operator: "acceptance-cleanup-super", reason: "A-002 cleanup restore pre-write profile", expectedVersion: before.version,
      });
      actions.push("profile-restored");
    }
    let current = profileDrift ? await readAccount(page, pre.id) : before;
    if (current.status !== pre.status) {
      await patchAccount(page, `/api/admin/platform/accounts/${encodeURIComponent(pre.id)}/status`, `${source.probeId}:cleanup-status-super`, {
        status: pre.status, operator: "acceptance-cleanup-super", reason: "A-002 cleanup restore pre-write status", expectedVersion: current.version,
      });
      actions.push("status-restored");
      current = await readAccount(page, pre.id);
    }
    final = current;
    expect(final.username).toBe(pre.username);
    expect(final.name).toBe(pre.name);
    expect(final.email).toBe(pre.email);
    expect(final.status).toBe(pre.status);
    expect(final.role).toBe(pre.role);
    expect(final.sessions).toBe(pre.sessions);
    expect(final.tfa).toBe(pre.tfa);
    expect(Number(final.version)).toBeGreaterThanOrEqual(Number(pre.version));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    final ??= await readAccount(page, pre.id).catch(() => undefined);
    const databaseSnapshotResult = database ? databaseSnapshot(candidate, database, pre.id, source.probeId) : undefined;
    mkdirSync(path.dirname(candidate.evidencePath), { recursive: true });
    writeFileSync(candidate.evidencePath, `${JSON.stringify({
      runId: candidate.runId, probeId: source.probeId, cleanupActor: "local-superadmin-temporary-mfa-bypass",
      scope: "restore profile/status only; no password, MFA, session, role, audit, outbox, or idempotency deletion",
      preWrite: publicAccount(pre), before: publicAccount(before), final: publicAccount(final), actions,
      assertions: {
        profileAndStatusEqualPreWrite: !!final && final.username === pre.username && final.name === pre.name && final.email === pre.email && final.status === pre.status,
        roleSessionsTfaUnchangedFromPreWrite: !!final && final.role === pre.role && final.sessions === pre.sessions && final.tfa === pre.tfa,
        versionMonotonicFromPreWrite: !!final && Number(final.version) >= Number(pre.version),
      },
      database: databaseSnapshotResult,
      immutableEvidence: "audit/outbox retained; idempotency records retained for final cleanup",
      failure: failure ?? null,
    }, null, 2)}\n`, "utf8");
  }
});
