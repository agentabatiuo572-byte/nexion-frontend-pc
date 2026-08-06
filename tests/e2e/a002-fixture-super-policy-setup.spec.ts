import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * A-AUTO-002 setup is deliberately separate from the CAS probe.  The service
 * policy currently requires a super actor in addition to the narrow
 * platform_a1_account_disable authority; these two Run-scoped actors make
 * that policy explicit rather than silently broadening a normal fixture role.
 * It is inert unless the controller issues A002_FIXTURE_SETUP=1 and a token.
 */
const TARGET_DATABASE = "nexion_acceptance_20260729_114336";

type Credentials = { username: string; password: string; totpSecret: string };
type Account = { id: string; username: string; role: string; status: string; version: string; sessions: number; tfa: boolean };
type Config = {
  runId: string; baseUrl: string; writeToken: string; evidenceDir: string; manifestPath: string;
  creator: Credentials; mysqlBin: string; mysqlPassword: string;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function config(): Config {
  if (process.env.A002_FIXTURE_SETUP !== "1") throw new Error("A002_FIXTURE_SETUP=1_REQUIRED");
  const evidenceDir = path.resolve(required("A002_SETUP_EVIDENCE_DIR"));
  const manifestPath = path.resolve(required("A002_RUN_MANIFEST_PATH"));
  if (!/bug-pic[\\/]\.restricted[\\/]/i.test(evidenceDir) || !/bug-pic[\\/]\.restricted[\\/]/i.test(manifestPath)) {
    throw new Error("A002_RESTRICTED_PATH_REQUIRED");
  }
  const baseUrl = required("A002_SETUP_BASE_URL");
  const parsed = new URL(baseUrl);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname)) throw new Error("A002_LOOPBACK_REQUIRED");
  return {
    runId: required("A002_SETUP_RUN_ID"), baseUrl, writeToken: required("A002_WRITE_TOKEN"), evidenceDir, manifestPath,
    creator: { username: required("A002_SETUP_OPERATOR_USERNAME"), password: required("A002_SETUP_OPERATOR_PASSWORD"), totpSecret: process.env.A002_SETUP_OPERATOR_TOTP_SECRET?.trim() ?? "" },
    mysqlBin: process.env.A002_MYSQL_BIN?.trim() || "D:/software/MySQL/bin/mysql.exe",
    mysqlPassword: process.env.A002_MYSQL_PASSWORD ?? "",
  };
}

function atomicJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temp, file);
}

function mysql(candidate: Config, sql: string) {
  const result = execFileSync(candidate.mysqlBin, ["-N", "-B", "-h", "127.0.0.1", "-P", "3306", "-u", "root", TARGET_DATABASE, "-e", sql], {
    encoding: "utf8", windowsHide: true, env: { ...process.env, MYSQL_PWD: candidate.mysqlPassword },
  }).trim();
  return result;
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("A002_TOTP_SECRET_INVALID");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function login(page: Page, candidate: Config, credential: Credentials) {
  // Always establish the requested identity from a clean session.  Without
  // this, `goto` can retain the just-validated fixture actor and silently
  // bypass the creator login that must own the next account creation.
  await page.request.post("/api/admin/auth/logout").catch(() => undefined);
  await page.goto(candidate.baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(credential.username);
  await page.locator('input[autocomplete="current-password"]').fill(credential.password);
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/admin/auth/login" && item.request().method() === "POST");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await response).status()).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  if (await otp.isVisible({ timeout: 1_000 }).catch(() => false)) {
    if (!credential.totpSecret) throw new Error("A002_CREATOR_MFA_SECRET_REQUIRED");
    const remaining = 30_000 - (Date.now() % 30_000);
    if (remaining <= 4_000) await page.waitForTimeout(remaining + 500);
    await otp.fill(currentTotp(credential.totpSecret));
    const verified = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/admin/auth/mfa/verify" && item.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await verified).status()).toBe(200);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function firstLogin(page: Page, candidate: Config, username: string, temporaryPassword: string, finalPassword: string) {
  await page.request.post("/api/admin/auth/logout").catch(() => undefined);
  await page.goto(candidate.baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/admin/auth/login" && item.request().method() === "POST");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const payload = await (await response).json() as { data?: { mfa?: { manualKey?: string } } };
  const totpSecret = payload.data?.mfa?.manualKey?.trim();
  if (!totpSecret) throw new Error("A002_ENROLLMENT_SECRET_MISSING");
  let passwordChanged = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) break;
    const changePassword = page.getByRole("button", { name: "确认修改并进入", exact: true });
    if (!passwordChanged && await changePassword.isVisible().catch(() => false)) {
      await page.getByLabel("新密码", { exact: true }).fill(finalPassword);
      await page.getByLabel("确认新密码", { exact: true }).fill(finalPassword);
      await changePassword.click();
      passwordChanged = true;
      continue;
    }
    const otp = page.getByLabel("一次性验证码");
    if (await otp.isVisible().catch(() => false)) {
      const remaining = 30_000 - (Date.now() % 30_000);
      if (remaining <= 4_000) await page.waitForTimeout(remaining + 500);
      await otp.fill(currentTotp(totpSecret));
      const verified = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/admin/auth/mfa/verify" && item.request().method() === "POST");
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
      expect((await verified).status()).toBe(200);
      continue;
    }
    await page.waitForTimeout(250);
  }
  expect(passwordChanged, "temporary account must complete its first-login password rotation").toBe(true);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  return { username, password: finalPassword, totpSecret };
}

async function envelope<T>(response: import("@playwright/test").APIResponse) {
  const raw = await response.text();
  expect(response.status(), raw).toBe(200);
  const body = JSON.parse(raw) as { code?: number; data?: T };
  expect(body.code, raw).toBe(0);
  return body.data as T;
}

async function account(page: Page, id: string) {
  const overview = await envelope<{ operators: Account[] }>(await page.request.get("/api/admin/platform/accounts/overview"));
  const found = overview.operators.find((item) => String(item.id) === id);
  expect(found, `A002 actor ${id}`).toBeTruthy();
  return found!;
}

async function sessionProof(page: Page, username: string) {
  const session = await envelope<{ session?: { username?: string; authorities?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> } }>(await page.request.get("/api/admin/auth/session"));
  const current = session.session ?? {};
  expect(current.username).toBe(username);
  const authorities = current.authorities ?? [];
  const menus = (current.effectiveMenus ?? []).map((entry) => typeof entry === "string" ? entry : entry.menuCode ?? "");
  expect(authorities).toContain("platform_a1_account_disable");
  expect(menus).toContain("A");
  expect(menus).toContain("A1");
  return { authorityCount: authorities.length, menuCount: menus.length, statusAuthority: true, a1Menu: true };
}

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("A-AUTO-002 creates only isolated super-policy CAS actors and MFA manifests", async ({ page }) => {
  const candidate = config();
  expect(mysql(candidate, "SELECT DATABASE()")).toBe(TARGET_DATABASE);
  const evidence: Record<string, unknown> = { runId: candidate.runId, database: TARGET_DATABASE, policy: "super-only status actor required by OpsAdminAccountService", actors: [] as unknown[] };
  const actors: Record<string, Credentials & { accountId: string }> = {};
  try {
    await login(page, candidate, candidate.creator);
    for (const key of ["primary", "secondary"] as const) {
      const nonce = randomBytes(6).toString("hex");
      const username = `a002_${key}_${nonce}`.slice(0, 32);
      const created = await envelope<{ id: string | number; temporaryPassword?: string }>(await page.request.post("/api/admin/platform/accounts", {
        headers: { "Idempotency-Key": `${candidate.runId}:a002:${key}:create:${nonce}` },
        // `nx_admin.nickname` is intentionally short; keep test metadata in the
        // reason/audit field rather than turning fixture setup into a truncation
        // probe.
        data: { username, displayName: `A002 ${key} ${nonce}`, email: `${username}@nexion.invalid`, role: "super", operator: candidate.creator.username, reason: `${candidate.runId} A-AUTO-002 temporary super-only status policy actor` },
      }));
      (evidence.actors as unknown[]).push({ key, accountId: String(created.id), username, state: "created" });
      if (!created.temporaryPassword) throw new Error(`A002_${key.toUpperCase()}_TEMPORARY_PASSWORD_MISSING`);
      const finalPassword = `Nx!9A002${randomBytes(18).toString("base64url")}Aa`;
      const credential = await firstLogin(page, candidate, username, created.temporaryPassword, finalPassword);
      const row = await account(page, String(created.id));
      expect(row.role.toLowerCase()).toBe("super");
      expect(row.status.toLowerCase()).toBe("enabled");
      expect(row.tfa).toBe(true);
      const proof = await sessionProof(page, username);
      actors[key] = { ...credential, accountId: String(created.id) };
      (evidence.actors as unknown[]).push({ key, accountId: String(created.id), username, state: "validated", role: row.role, status: row.status, tfa: row.tfa, ...proof, passwordSha256: createHash("sha256").update(finalPassword).digest("hex"), totpSecretSha256: createHash("sha256").update(credential.totpSecret).digest("hex") });
      await login(page, candidate, candidate.creator);
    }
    const manifest = {
      sensitive: true, doNotUpload: true, runId: candidate.runId, baseUrl: candidate.baseUrl,
      database: { host: "127.0.0.1", port: 3306, name: TARGET_DATABASE, user: "root" }, probe: { accountId: "99535" },
      policy: { superOnlyStatusActor: true, rationale: "service requires super authorization after platform_a1_account_disable", actorsMustNotBeReused: true },
      operators: { primary: actors.primary, secondary: actors.secondary },
    };
    atomicJson(candidate.manifestPath, manifest);
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    atomicJson(path.join(candidate.evidenceDir, "a002-fixture-setup-summary.json"), evidence);
  }
});
