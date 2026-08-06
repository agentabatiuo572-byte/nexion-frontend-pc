import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * A-002 可复用运行时验收载具。
 *
 * `--list` 和 TypeScript 语法检查不需要环境变量；只读交接预检只需要
 * 指向本轮唯一受限 manifest 的 A002_RUN_MANIFEST_PATH。实际 CAS 执行还
 * 必须同时提供：
 *
 *   A002_RUN_MANIFEST_PATH=D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/a-auto-002/manifest.json
 *   A002_PROBE_WRITE_TOKEN=<main-controller-issued CAS-probe token>
 *   A002_EVIDENCE_DIR=<.../bug-pic/.restricted/<Run>/A/a002-cas>
 *   A002_MYSQL_PASSWORD=<database password>
 *   A002_CAS_FIXTURE_ADMIN_USERNAME/PASSWORD[/TOTP_SECRET]=<cleanup-only admin>
 *
 * manifest 的最小结构（只能放在受限目录，不能提交）：
 * {
 *   "runId": "...",
 *   "baseUrl": "http://127.0.0.1:3002",
 *   "probe": { "accountId": "..." },
 *   "operators": {
 *     "primary": { "accountId": "99622", "username": "...", "password": "...", "totpSecret": "..." },
 *     "secondary": { "accountId": "99623", "username": "...", "password": "...", "totpSecret": "..." }
 *   },
 *   "database": { "host": "127.0.0.1", "port": 3306, "name": "...", "user": "root" }
 * }
 *
 * The probe must be a dedicated disposable account.  The harness records the
 * exact pre-write account row and restores that row in `finally` through the
 * separately authorized acceptance fixture-admin; it never
 * resets password/2FA or revokes sessions, because those cannot be restored
 * exactly without creating a new credential lifecycle.
 */

type Credentials = {
  accountId: string;
  username: string;
  password: string;
  totpSecret: string;
};
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
type Manifest = {
  runId: string;
  baseUrl: string;
  probe: { accountId: string };
  operators: { primary: Credentials; secondary: Credentials };
  policy: { superOnlyStatusActor: boolean; actorsMustNotBeReused: boolean };
  database: { host?: string; port?: number; name: string; user?: string };
};
type Config = Manifest & {
  writeToken: string;
  evidenceDir: string;
  mysqlBin: string;
  mysqlPassword: string;
  fixtureAdmin: Credentials;
};
type WireResult = { status: number; body: unknown; raw: string; headers: Record<string, string> };
type LoginDiagnostic = {
  operator: "primary" | "secondary" | "fixture-admin";
  phase: "login" | "mfa-verify" | "shell";
  status?: number;
  code?: number | null;
  message?: string;
  mfaMode?: "challenge" | "bypass-or-session";
  url?: string;
  visibleErrorText?: string[];
};

const EXPECTED_MANIFEST_PATH = path.resolve("D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/a-auto-002/manifest.json");
const EXPECTED_RUN_ID = "pc-full-acceptance-20260729-114336";
const EXPECTED_ACTOR_IDS = { primary: "99622", secondary: "99623" } as const;

function optionalConfig(mode: "preflight" | "probe"): Config | null {
  const manifestPath = process.env.A002_RUN_MANIFEST_PATH?.trim();
  if (!manifestPath) return null;
  const resolvedManifest = path.resolve(manifestPath);
  if (resolvedManifest.toLowerCase() !== EXPECTED_MANIFEST_PATH.toLowerCase()) {
    throw new Error(`A002_RUN_MANIFEST_PATH must be the single Run-scoped handoff manifest: ${EXPECTED_MANIFEST_PATH}`);
  }
  if (!/bug-pic[\\/]\.restricted[\\/]/i.test(resolvedManifest)) {
    throw new Error("A002_RUN_MANIFEST_PATH must be under bug-pic/.restricted");
  }
  // Setup and business probes use distinct controller-issued capabilities.  A
  // fixture-only token must never accidentally authorize a status mutation.
  const writeToken = process.env.A002_PROBE_WRITE_TOKEN?.trim();
  const evidenceDir = process.env.A002_EVIDENCE_DIR?.trim();
  const mysqlPassword = process.env.A002_MYSQL_PASSWORD;
  const fixtureAdmin: Credentials = {
    accountId: "",
    username: process.env.A002_CAS_FIXTURE_ADMIN_USERNAME?.trim() ?? "",
    password: process.env.A002_CAS_FIXTURE_ADMIN_PASSWORD?.trim() ?? "",
    totpSecret: process.env.A002_CAS_FIXTURE_ADMIN_TOTP_SECRET?.trim() ?? "",
  };
  if (mode === "probe" && (!writeToken || !evidenceDir || !mysqlPassword || !fixtureAdmin.username || !fixtureAdmin.password)) return null;

  const manifest = JSON.parse(readFileSync(resolvedManifest, "utf8")) as Partial<Manifest>;
  if (!manifest.runId || !manifest.baseUrl || !manifest.probe?.accountId
    || !manifest.operators?.primary || !manifest.operators?.secondary || !manifest.database?.name
    || !manifest.policy?.superOnlyStatusActor || !manifest.policy.actorsMustNotBeReused) {
    throw new Error("A002 manifest is incomplete; see harness header for the required shape");
  }
  if (manifest.runId !== EXPECTED_RUN_ID || manifest.probe.accountId !== "99535") {
    throw new Error("A002 manifest Run/probe binding does not match the frozen acceptance scope");
  }
  for (const [name, operator] of Object.entries(manifest.operators) as Array<["primary" | "secondary", Credentials]>) {
    if (!operator?.accountId || !operator.username || !operator.password || !operator.totpSecret) {
      throw new Error(`A002 manifest operator ${name} is incomplete`);
    }
    if (String(operator.accountId) !== EXPECTED_ACTOR_IDS[name]) {
      throw new Error(`A002 manifest operator ${name} must be actor ${EXPECTED_ACTOR_IDS[name]}`);
    }
    if (operator.username.trim().toLowerCase() === "superadmin") {
      throw new Error(`A002 manifest operator ${name} must not reuse real superadmin`);
    }
  }
  if (manifest.operators.primary.username === manifest.operators.secondary.username) {
    throw new Error("A002 primary and secondary must be independent accounts");
  }
  const base = new URL(manifest.baseUrl);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(base.hostname)) {
    throw new Error("A002 harness only permits a loopback acceptance endpoint");
  }
  const resolvedEvidence = evidenceDir ? path.resolve(evidenceDir) : "";
  if (mode === "probe" && !/bug-pic[\\/]\.restricted[\\/]/i.test(resolvedEvidence)) {
    throw new Error("A002_EVIDENCE_DIR must be under bug-pic/.restricted");
  }
  return {
    ...(manifest as Manifest),
    writeToken: writeToken ?? "",
    evidenceDir: resolvedEvidence,
    mysqlBin: process.env.A002_MYSQL_BIN?.trim() || "D:/software/MySQL/bin/mysql.exe",
    mysqlPassword: mysqlPassword ?? "",
    fixtureAdmin,
  };
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function opaque(value: string) {
  // Evidence must correlate events without containing a credential or bearer token.
  return `${value.slice(0, 12)}…${value.slice(-4)}`;
}

function base32(raw: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = raw.replace(/[^A-Z2-7]/gi, "").toUpperCase();
  let bits = "";
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("A002_TOTP_SECRET_INVALID");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

const usedTotpSteps = new Map<string, number>();
async function freshTotp(secret: string) {
  const key = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  const current = Math.floor(Date.now() / 30_000);
  const previous = usedTotpSteps.get(key) ?? -1;
  const nearBoundary = 30_000 - (Date.now() % 30_000) <= 3_000;
  if (current <= previous || nearBoundary) {
    await new Promise((resolve) => setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 500));
  }
  const step = Math.floor(Date.now() / 30_000);
  usedTotpSteps.set(key, step);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function responseDiagnostic(response: import("@playwright/test").Response) {
  let raw = "";
  try { raw = await response.text(); } catch { /* a failed BFF response is still diagnosable by HTTP status */ }
  type AuthPayload = { code?: unknown; message?: unknown; data?: { mfa?: unknown } };
  let payload: AuthPayload | undefined;
  try { payload = JSON.parse(raw) as AuthPayload; } catch { /* never write arbitrary body data to evidence */ }
  return {
    status: response.status(),
    code: typeof payload?.code === "number" ? payload.code : null,
    message: typeof payload?.message === "string" ? payload.message.slice(0, 240) : "",
    mfaMode: payload?.data?.mfa ? "challenge" as const : "bypass-or-session" as const,
  };
}

async function visibleErrors(page: Page) {
  const selectors = ["[role=alert]", ".error", ".error-message", "[data-error]"];
  const values = (await Promise.all(selectors.map(async (selector) =>
    page.locator(selector).allTextContents().catch(() => [] as string[]),
  ))).flat();
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))]
    .map((value) => value.replace(/\b\d{6}\b/g, "[redacted-otp]").slice(0, 240));
}

async function login(
  page: Page,
  config: Config,
  credentials: Credentials,
  operator: "primary" | "secondary" | "fixture-admin",
  diagnostics: LoginDiagnostic[],
) {
  await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(credentials.username);
  await page.locator('input[autocomplete="current-password"]').fill(credentials.password);
  const loginResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === "/api/admin/auth/login";
  });
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const login = await responseDiagnostic(await loginResponse);
  diagnostics.push({ operator, phase: "login", ...login });
  if (login.status !== 200 || (login.code !== null && login.code !== 0)) {
    throw new Error(`${operator.toUpperCase()}_LOGIN_FAILED: HTTP ${login.status} ${login.message || "NO_MESSAGE"}`);
  }
  const otp = page.getByLabel("一次性验证码");
  if (await otp.isVisible({ timeout: 10_000 }).catch(() => false)) {
    if (!credentials.totpSecret || credentials.totpSecret === "MFA_BYPASS_NOT_USED") {
      throw new Error(`${operator.toUpperCase()}_MFA_CHALLENGE_HAS_NO_USABLE_TOTP_SECRET`);
    }
    const remainingMs = 30_000 - (Date.now() % 30_000);
    if (remainingMs <= 3_000) await page.waitForTimeout(remainingMs + 500);
    await otp.fill(await freshTotp(credentials.totpSecret));
    const mfaResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST" && url.pathname === "/api/admin/auth/mfa/verify";
    });
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const verified = await responseDiagnostic(await mfaResponse);
    diagnostics.push({ operator, phase: "mfa-verify", ...verified });
    // A successful navigation can make the response body unavailable to
    // Playwright. HTTP 200 is provisionally accepted when no envelope can be
    // read; the authoritative shell/session assertion below still must pass.
    if (verified.status !== 200 || (verified.code !== null && verified.code !== 0)) {
      throw new Error(`${operator.toUpperCase()}_MFA_VERIFY_FAILED: HTTP ${verified.status} ${verified.message || "NO_MESSAGE"}`);
    }
  }
  try {
    await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
    diagnostics.push({ operator, phase: "shell", url: page.url() });
  } catch (error) {
    diagnostics.push({ operator, phase: "shell", url: page.url(), visibleErrorText: await visibleErrors(page) });
    throw new Error(`${operator.toUpperCase()}_SHELL_NOT_READY: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readAccount(page: Page, accountId: string): Promise<Account> {
  const response = await page.request.get("/api/admin/platform/accounts/overview");
  const raw = await response.text();
  expect(response.status(), raw).toBe(200);
  const json = JSON.parse(raw) as { code?: number; data?: { operators?: Account[] } };
  expect(json.code ?? 0, raw).toBe(0);
  const account = json.data?.operators?.find((candidate) => String(candidate.id) === String(accountId));
  expect(account, `A-002 probe ${accountId} must exist`).toBeTruthy();
  expect(account!.version, "A-002 probe must expose CAS version").toMatch(/^\d+$/);
  return account!;
}

async function assertHandoffActor(page: Page, credentials: Credentials) {
  const account = await readAccount(page, credentials.accountId);
  expect(account.username).toBe(credentials.username);
  expect(account.role).toBe("super");
  expect(account.status).toBe("enabled");
  expect(account.tfa, `${credentials.accountId} must have completed MFA enrollment`).toBe(true);
  const response = await page.request.get("/api/admin/auth/session");
  const raw = await response.text();
  expect(response.status(), raw).toBe(200);
  const body = JSON.parse(raw) as {
    code?: number;
    data?: { session?: { username?: string; authorities?: string[] } };
  };
  expect(body.code ?? 0, raw).toBe(0);
  expect(body.data?.session?.username).toBe(credentials.username);
  expect(body.data?.session?.authorities ?? []).toContain("platform_a1_account_disable");
  return {
    accountId: account.id,
    username: account.username,
    role: account.role,
    status: account.status,
    mfaEnrolled: account.tfa,
    statusAuthority: true,
  };
}

async function mutation(
  page: Page,
  method: "PATCH" | "POST",
  endpoint: string,
  key: string,
  body: Record<string, unknown>,
): Promise<WireResult> {
  const response = await page.request.fetch(endpoint, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    data: body,
  });
  const raw = await response.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { /* preserve non-JSON in restricted evidence */ }
  return { status: response.status(), body: parsed, raw, headers: response.headers() };
}

function resultCode(result: WireResult) {
  return typeof result.body === "object" && result.body !== null && "code" in result.body
    ? Number((result.body as { code?: unknown }).code) : result.status;
}

function message(result: WireResult) {
  return typeof result.body === "object" && result.body !== null && "message" in result.body
    ? String((result.body as { message?: unknown }).message ?? "") : result.raw;
}

function requireOk(result: WireResult, label: string) {
  expect(result.status, `${label}: ${result.raw}`).toBe(200);
  expect(resultCode(result), `${label}: ${result.raw}`).toBe(0);
}

function requireStale409(result: WireResult, label: string) {
  expect(result.status, `${label}: ${result.raw}`).toBe(409);
  expect(message(result), `${label}: ${result.raw}`).toContain("ACCOUNT_VERSION_STALE");
}

function mysql(config: Config, sql: string) {
  const args = [
    `--host=${config.database.host || "127.0.0.1"}`,
    `--port=${config.database.port || 3306}`,
    `--user=${config.database.user || "root"}`,
    `--database=${config.database.name}`,
    "--batch", "--skip-column-names", "--raw", "--execute", sql,
  ];
  return execFileSync(config.mysqlBin, args, {
    encoding: "utf8",
    env: { ...process.env, MYSQL_PWD: config.mysqlPassword },
    windowsHide: true,
  }).trim();
}

function sqlQuote(value: string) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function databaseSnapshot(config: Config, accountId: string, probeId: string) {
  const account = mysql(config, `SELECT CONCAT_WS('|', id, username, nickname, COALESCE(email,''), status, version) FROM nx_admin WHERE id=${sqlQuote(accountId)} AND is_deleted=0`);
  const audit = mysql(config, `SELECT COUNT(*) FROM nx_audit_log WHERE is_deleted=0 AND resource_id=${sqlQuote(accountId)} AND detail_json LIKE ${sqlQuote(`%${probeId}%`)}`);
  const outbox = mysql(config, `SELECT COUNT(*) FROM nx_event_outbox WHERE is_deleted=0 AND payload LIKE ${sqlQuote(`%${probeId}%`)}`);
  const idempotency = mysql(config, `SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE is_deleted=0 AND idempotency_key LIKE ${sqlQuote(`%${probeId}%`)}`);
  return { account, audit: Number(audit || "0"), outbox: Number(outbox || "0"), idempotency: Number(idempotency || "0") };
}

async function eventuallyReadAccount(page: Page, accountId: string, expectedVersion: string) {
  await expect.poll(async () => (await readAccount(page, accountId)).version, { timeout: 20_000, intervals: [200, 500, 1_000] })
    .not.toBe(expectedVersion);
  return readAccount(page, accountId);
}

async function abandonBrowserOutcome(page: Page, endpoint: string, key: string, body: Record<string, unknown>) {
  // The browser starts the real request but deliberately stops observing it.
  // We then prove server-side outcome by a fresh read and replaying the same key.
  return page.evaluate(async ({ endpoint: url, key: commandKey, body: requestBody }) => {
    const task = fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey },
      body: JSON.stringify(requestBody),
      cache: "no-store",
    }).then(() => "response-observed", () => "network-failed");
    return Promise.race([task, new Promise<string>((resolve) => setTimeout(() => resolve("outcome-unknown"), 0))]);
  }, { endpoint, key, body });
}

async function restoreExactly(
  page: Page,
  config: Config,
  initial: Account,
  probeId: string,
  operator = config.operators.primary.username,
) {
  let current = await readAccount(page, initial.id);
  const reasons = `${probeId} finally exact restore`;
  if (current.username !== initial.username || current.name !== initial.name || current.email !== initial.email) {
    requireOk(await mutation(page, "PATCH", `/api/admin/platform/accounts/${encodeURIComponent(initial.id)}/profile`, `${probeId}:cleanup-profile`, {
      username: initial.username,
      displayName: initial.name,
      email: initial.email,
      operator,
      reason: reasons,
      expectedVersion: current.version,
    }), "cleanup profile");
    current = await readAccount(page, initial.id);
  }
  if (current.status !== initial.status) {
    requireOk(await mutation(page, "PATCH", `/api/admin/platform/accounts/${encodeURIComponent(initial.id)}/status`, `${probeId}:cleanup-status`, {
      status: initial.status,
      operator,
      reason: reasons,
      expectedVersion: current.version,
    }), "cleanup status");
  }
  const restored = await readAccount(page, initial.id);
  expect({ username: restored.username, name: restored.name, email: restored.email, role: restored.role, status: restored.status, sessions: restored.sessions, tfa: restored.tfa })
    .toEqual({ username: initial.username, name: initial.name, email: initial.email, role: initial.role, status: initial.status, sessions: initial.sessions, tfa: initial.tfa });
}

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("A-002 handoff: read-only actor/MFA/super-policy preflight", async ({ browser }) => {
  const config = optionalConfig("preflight");
  test.skip(!config, "A002_RUN_MANIFEST_PATH must point to the single restricted A/a-auto-002/manifest.json");
  const active = config!;
  const verified: Array<Awaited<ReturnType<typeof assertHandoffActor>>> = [];
  for (const [name, credentials] of Object.entries(active.operators) as Array<["primary" | "secondary", Credentials]>) {
    const context = await browser.newContext({ baseURL: active.baseUrl });
    try {
      const page = await context.newPage();
      const diagnostics: LoginDiagnostic[] = [];
      await login(page, active, credentials, name, diagnostics);
      verified.push(await assertHandoffActor(page, credentials));
      await page.request.post("/api/admin/auth/logout").catch(() => undefined);
    } finally {
      await context.close();
    }
  }
  expect(verified.map((entry) => entry.accountId)).toEqual(["99622", "99623"]);
  expect(new Set(verified.map((entry) => entry.username)).size).toBe(2);
});

test("A-002: two operators, CAS, replay/mismatch, unknown outcome, A2/A4 database evidence, exact cleanup", async ({ page, browser }) => {
  const config = optionalConfig("probe");
  test.skip(!config, "A002_RUN_MANIFEST_PATH, A002_PROBE_WRITE_TOKEN, A002_EVIDENCE_DIR, A002_MYSQL_PASSWORD and cleanup-only fixture-admin credentials are required; --list remains safe without them");
  const active = config!;
  mkdirSync(active.evidenceDir, { recursive: true });
  const probeId = `A002-${safeName(active.runId)}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const evidence: Record<string, unknown> = { probeId, runId: active.runId, startedAt: new Date().toISOString(), writeToken: opaque(active.writeToken) };
  let secondary: BrowserContext | undefined;
  let secondaryPage: Page | undefined;
  let initial: Account | undefined;

  try {
    evidence.logins = [] as LoginDiagnostic[];
    await login(page, active, active.operators.primary, "primary", evidence.logins as LoginDiagnostic[]);
    secondary = await browser.newContext({ baseURL: active.baseUrl });
    secondaryPage = await secondary.newPage();
    await login(secondaryPage, active, active.operators.secondary, "secondary", evidence.logins as LoginDiagnostic[]);
    evidence.actorPolicy = [
      await assertHandoffActor(page, active.operators.primary),
      await assertHandoffActor(secondaryPage, active.operators.secondary),
    ];
    initial = await readAccount(page, active.probe.accountId);
    evidence.preWrite = { api: initial, database: databaseSnapshot(active, initial.id, probeId) };

    // Two independently authenticated operators read one version, then submit
    // the same status transition with distinct keys. Exactly one may change the
    // row; the other must lose the database CAS with 409.
    const concurrentVersion = initial.version;
    const statusEndpoint = `/api/admin/platform/accounts/${encodeURIComponent(initial.id)}/status`;
    const concurrentTarget = initial.status === "enabled" ? "disabled" : "enabled";
    const [first, second] = await Promise.all([
      mutation(page, "PATCH", statusEndpoint, `${probeId}:two-operator-a`, {
        status: concurrentTarget,
        operator: active.operators.primary.username, reason: `${probeId} two operator CAS A`, expectedVersion: concurrentVersion,
      }),
      mutation(secondaryPage, "PATCH", statusEndpoint, `${probeId}:two-operator-b`, {
        status: concurrentTarget,
        operator: active.operators.secondary.username, reason: `${probeId} two operator CAS B`, expectedVersion: concurrentVersion,
      }),
    ]);
    const ordered = [first, second];
    expect(ordered.filter((result) => result.status === 200 && resultCode(result) === 0)).toHaveLength(1);
    expect(ordered.filter((result) => result.status === 409 && message(result).includes("ACCOUNT_VERSION_STALE"))).toHaveLength(1);
    const afterConcurrent = await eventuallyReadAccount(page, initial.id, concurrentVersion);
    expect(afterConcurrent.status).toBe(concurrentTarget);
    expect({ username: afterConcurrent.username, name: afterConcurrent.name, email: afterConcurrent.email })
      .toEqual({ username: initial.username, name: initial.name, email: initial.email });
    evidence.twoOperator = { version: concurrentVersion, statuses: ordered.map((result) => ({ status: result.status, code: resultCode(result), message: message(result) })), after: afterConcurrent };

    // Same command key and payload is a replay, not another side effect; using the
    // same key with another payload is a hard conflict.
    const statusTarget = afterConcurrent.status === "enabled" ? "disabled" : "enabled";
    const replayKey = `${probeId}:replay`;
    const replayBody = { status: statusTarget, operator: active.operators.primary.username, reason: `${probeId} same key replay`, expectedVersion: afterConcurrent.version };
    const firstReplay = await mutation(page, "PATCH", statusEndpoint, replayKey, replayBody);
    requireOk(firstReplay, "same-key initial request");
    const afterFirstReplay = await readAccount(page, initial.id);
    const replay = await mutation(page, "PATCH", statusEndpoint, replayKey, replayBody);
    requireOk(replay, "same-key replay");
    const afterReplay = await readAccount(page, initial.id);
    expect(afterReplay.version, "same idempotency key must not increment version twice").toBe(afterFirstReplay.version);
    const mismatch = await mutation(page, "PATCH", statusEndpoint, replayKey, {
      ...replayBody,
      status: statusTarget === "enabled" ? "disabled" : "enabled",
    });
    expect(mismatch.status, mismatch.raw).toBe(409);
    evidence.idempotency = { first: { status: firstReplay.status, code: resultCode(firstReplay) }, replay: { status: replay.status, code: resultCode(replay) }, mismatch: { status: mismatch.status, code: resultCode(mismatch), message: message(mismatch) }, versionAfterFirst: afterFirstReplay.version, versionAfterReplay: afterReplay.version };

    // Outcome unknown is a client-observation failure, not permission to issue a
    // new command: prove the authoritative state then replay the exact same key.
    const unknownTarget = afterReplay.status === "enabled" ? "disabled" : "enabled";
    const unknownKey = `${probeId}:unknown`;
    const beforeUnknown = await readAccount(page, initial.id);
    const unknownBody = {
      status: unknownTarget,
      operator: active.operators.primary.username,
      reason: `${probeId} outcome unknown replay`,
      expectedVersion: beforeUnknown.version,
    };
    const observation = await abandonBrowserOutcome(page, statusEndpoint, unknownKey, unknownBody);
    expect(observation, "the harness must abandon response observation before deciding outcome").toBe("outcome-unknown");
    const afterUnknown = await eventuallyReadAccount(page, initial.id, beforeUnknown.version);
    expect(afterUnknown.status).toBe(unknownTarget);
    const unknownReplay = await mutation(page, "PATCH", statusEndpoint, unknownKey, unknownBody);
    requireOk(unknownReplay, "unknown-outcome same-key replay");
    const afterUnknownReplay = await readAccount(page, initial.id);
    expect(afterUnknownReplay.version).toBe(afterUnknown.version);
    evidence.unknownOutcome = { observation, commandKey: opaque(unknownKey), beforeVersion: beforeUnknown.version, afterVersion: afterUnknown.version, replay: { status: unknownReplay.status, code: resultCode(unknownReplay) } };

    const db = databaseSnapshot(active, initial.id, probeId);
    expect(db.audit, "every successful probe write must leave A2 audit evidence").toBeGreaterThanOrEqual(3);
    expect(db.idempotency, "probe keys must be durable in the idempotency ledger").toBeGreaterThanOrEqual(4);
    // A1 account mutations are audit-only.  A4 must not fabricate an outbox event
    // for a rejected/replayed command; the probe identifier makes this an exact DB assertion.
    expect(db.outbox, "A1 CAS/idempotency must not create a phantom A4 outbox event").toBe(0);
    evidence.preCleanup = { api: await readAccount(page, initial.id), database: db };
  } finally {
    if (initial) {
      try {
        // The fixture-admin is not one of the two business actors and opens a
        // session only after the CAS/replay/unknown-outcome assertions finish.
        const cleanupContext = await browser.newContext({ baseURL: active.baseUrl });
        const restorePage = await cleanupContext.newPage();
        try {
          await login(restorePage, active, active.fixtureAdmin, "fixture-admin", evidence.logins as LoginDiagnostic[]);
          await restoreExactly(restorePage, active, initial, probeId, active.fixtureAdmin.username);
        } finally {
          await cleanupContext.close();
        }
        evidence.cleanup = { status: "restored", account: await readAccount(page, initial.id), database: databaseSnapshot(active, initial.id, probeId) };
      } catch (error) {
        evidence.cleanup = { status: "failed", error: error instanceof Error ? error.message : String(error) };
        throw error;
      } finally {
        writeFileSync(path.join(active.evidenceDir, `${probeId}.json`), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
      }
    } else {
      writeFileSync(path.join(active.evidenceDir, `${probeId}.json`), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    }
    await secondary?.close();
  }
});
