import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type ManifestActor = { accountId: string | number; username: string };
type Manifest = {
  runId: string;
  actors: { maker: ManifestActor; checker: ManifestActor; cleanup: ManifestActor };
  cleanup: { required: Array<string | number>; exactPrefix: string };
};
type Credentials = ManifestActor & { password: string; totpSecret: string };
type Account = { id: string; username: string; name: string; email: string; role: string; status: string; version: string; sessions: number; tfa: boolean };
type Result = { status: number; code: number | null; message: string; id?: string };

const EXPECTED_MANIFEST = path.resolve("D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/final7-fixture-refresh/final7-a-fixture-manifest.json");
const manifestPath = required("A_FINAL7_MANIFEST_PATH");
const baseUrl = required("A_FINAL7_BASE_URL");
const evidenceDir = required("A_FINAL7_EVIDENCE_DIR");
const writeToken = required("A_FINAL7_WRITE_TOKEN");
const controlToken = required("A_FINAL7_WRITE_CONTROL_TOKEN");
const dbPassword = required("A_FINAL7_DB_PASSWORD");
const database = required("A_FINAL7_DB_NAME");
const mfaBypass = required("A_FINAL7_MFA_BYPASS");
const totpCounterOffset = Number(process.env.A_FINAL7_TOTP_COUNTER_OFFSET ?? "-1");
const actorSecretKeys = {
  maker: { password: "A_FINAL7_MAKER_PASSWORD", totpSecret: "A_FINAL7_MAKER_TOTP_SECRET" },
  checker: { password: "A_FINAL7_CHECKER_PASSWORD", totpSecret: "A_FINAL7_CHECKER_TOTP_SECRET" },
  cleanup: { password: "A_FINAL7_CLEANUP_PASSWORD", totpSecret: "A_FINAL7_CLEANUP_TOTP_SECRET" },
} as const;
const manifest = loadManifest();
const maker = credentials("maker");
const checker = credentials("checker");
const cleanup = credentials("cleanup");
const usedTotpSteps = new Map<string, number>();

if (!Number.isInteger(totpCounterOffset) || totpCounterOffset < -2 || totpCounterOffset > 2) {
  throw new Error("A_FINAL7_TOTP_COUNTER_OFFSET_MUST_BE_AN_INTEGER_BETWEEN_-2_AND_2");
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function loadManifest(): Manifest {
  if (path.resolve(manifestPath).toLowerCase() !== EXPECTED_MANIFEST.toLowerCase()) throw new Error("A_FINAL7_MANIFEST_PATH_MUST_BIND_FINAL7_A_FIXTURE");
  if (!/bug-pic[\\/]\.restricted[\\/]/i.test(path.resolve(evidenceDir))) throw new Error("A_FINAL7_EVIDENCE_DIR_MUST_BE_RESTRICTED");
  if (mfaBypass !== "false") throw new Error("A_FINAL7_MFA_BYPASS_MUST_BE_FALSE");
  if (writeToken !== controlToken) throw new Error("A_FINAL7_WRITE_TOKEN_CONTROL_MISMATCH");
  const value = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  if (!value.runId || !value.actors?.maker || !value.actors?.checker || !value.actors?.cleanup) throw new Error("A_FINAL7_MANIFEST_INVALID");
  const url = new URL(baseUrl);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname) || url.port !== "3002") throw new Error("A_FINAL7_BASE_URL_MUST_USE_LOOPBACK_3002");
  return value;
}

function credentials(kind: "maker" | "checker" | "cleanup"): Credentials {
  const actor = manifest.actors[kind];
  const accountId = String(actor.accountId ?? "");
  if (!/^\d+$/.test(accountId) || !actor.username) throw new Error(`A_FINAL7_${kind.toUpperCase()}_MANIFEST_ACTOR_INVALID`);
  return {
    accountId,
    username: actor.username,
    password: required(actorSecretKeys[kind].password),
    totpSecret: required(actorSecretKeys[kind].totpSecret),
  };
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("A_FINAL7_TOTP_SECRET_INVALID");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, index) => Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)));
  const step = Math.floor(Date.now() / 30_000);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step + totpCounterOffset));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function login(page: Page, actor: Credentials) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(actor.username);
  await page.locator('input[autocomplete="current-password"]').fill(actor.password);
  const loginResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  expect((await loginResponse).status()).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remaining = 30_000 - (Date.now() % 30_000);
    const prior = usedTotpSteps.get(actor.username) ?? -1;
    if (Math.floor(Date.now() / 30_000) <= prior || remaining < 3_000) await page.waitForTimeout(remaining + 500);
    usedTotpSteps.set(actor.username, Math.floor(Date.now() / 30_000));
    await otp.fill(totp(actor.totpSecret));
    const verified = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/mfa/verify" && response.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    if ((await verified).status() === 200) break;
    if (attempt === 2) throw new Error("A_FINAL7_MFA_LOGIN_FAILED");
    await page.waitForTimeout(30_500 - (Date.now() % 30_000));
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function openVisibleA1(page: Page) {
  const link = page.locator("aside").getByRole("link", { name: "运营账号 & RBAC A1", exact: true });
  if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/rbac$/);
}

async function openVisibleA2(page: Page) {
  const link = page.locator("aside").getByRole("link", { name: "审计 & 操作确认 A2", exact: true });
  if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
}

async function openVisibleA4(page: Page) {
  const link = page.locator("aside").getByRole("link", { name: "埋点事件体系 A4", exact: true });
  if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/events$/);
  await expect(page.getByText("事件目录 · 6 个 family × domain 注册表", { exact: true })).toBeVisible();
  await expect(page.getByText(/A4 数据校验失败|A4 接口读取失败/)).toHaveCount(0);
}

async function command(page: Page, method: "POST" | "PATCH", url: string, key: string, data: Record<string, unknown>): Promise<Result> {
  const response = await page.request.fetch(url, { method, headers: { "Content-Type": "application/json", "Idempotency-Key": key }, data });
  const body = await response.json().catch(() => null) as { code?: unknown; message?: unknown; data?: { id?: unknown } } | null;
  const id = typeof body?.data?.id === "string" || typeof body?.data?.id === "number" ? String(body.data.id) : undefined;
  return { status: response.status(), code: typeof body?.code === "number" ? body.code : null, message: typeof body?.message === "string" ? body.message : "", id };
}

async function overview(page: Page, accountId: string): Promise<Account> {
  const response = await page.request.get("/api/admin/platform/accounts/overview");
  const body = await response.json() as { code?: number; data?: { operators?: Account[] } };
  expect(response.status()).toBe(200);
  expect(body.code).toBe(0);
  const account = body.data?.operators?.find((item) => String(item.id) === accountId);
  expect(account, `A_FINAL7_ACCOUNT_NOT_FOUND:${accountId}`).toBeTruthy();
  return account!;
}

function requireOk(result: Result, label: string) {
  expect(result.status, label).toBe(200);
  expect(result.code, label).toBe(0);
}

function mysql(sql: string) {
  const mysqlBin = process.env.NEXION_MYSQL_BIN?.trim() || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
  return execFileSync(mysqlBin, ["--batch", "--skip-column-names", "--raw", "--user=root", `--database=${database}`, "--execute", sql], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, MYSQL_PWD: dbPassword },
  }).trim();
}

function quote(value: string) { return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`; }

function databaseEvidence(accountId: string, probe: string) {
  const account = mysql(`SELECT COUNT(*) FROM nx_admin WHERE id=${quote(accountId)} AND is_deleted=0`);
  const a2 = mysql(`SELECT COUNT(*) FROM nx_audit_log WHERE is_deleted=0 AND resource_id=${quote(accountId)} AND detail_json LIKE ${quote(`%${probe}%`)}`);
  return { account: Number(account || "0"), a2: Number(a2 || "0") };
}

function exactCleanup(accountId: string, username: string) {
  const id = quote(accountId);
  const user = quote(username);
  mysql(`DELETE FROM nx_admin_role_relation WHERE admin_id=${id}; DELETE FROM nx_admin_account_state WHERE admin_id=${id}; DELETE FROM nx_admin WHERE id=${id} AND username=${user};`);
  const residual = Number(mysql(`SELECT COUNT(*) FROM nx_admin WHERE id=${id} OR username=${user}`) || "0");
  expect(residual, "Final7 exact temporary account residual").toBe(0);
  return residual;
}

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("Final7 A1 visible lifecycle: CAS, idempotency, outcome unknown, A2 audit, A4 governance health and exact cleanup", async ({ page, browser }) => {
  const probe = `A1-FINAL7-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const evidence: Record<string, unknown> = { runId: manifest.runId, probe, actorAccountIds: [maker.accountId, checker.accountId, cleanup.accountId] };
  let checkerContext: BrowserContext | undefined;
  let cleanupContext: BrowserContext | undefined;
  let targetId = "";
  let targetUsername = "";
  try {
    await login(page, maker);
    await openVisibleA1(page);
    await openVisibleA2(page);
    await openVisibleA4(page);
    await openVisibleA1(page);
    checkerContext = await browser.newContext({ baseURL: baseUrl });
    const checkerPage = await checkerContext.newPage();
    await login(checkerPage, checker);

    const create = await command(page, "POST", "/api/admin/platform/accounts", `${probe}:create`, {
      username: `ffix.a.final7.target.${randomBytes(5).toString("hex")}`,
      displayName: `Final7 A1 ${probe}`,
      email: `${probe}@nexion.invalid`,
      role: "unassigned",
      deliver: "handoff",
      operator: maker.username,
      reason: `${probe} disposable lifecycle target`,
    });
    requireOk(create, "A1 create disposable target");
    targetId = create.id ?? "";
    expect(targetId).toMatch(/^\d+$/);
    const initial = await overview(page, targetId);
    targetUsername = initial.username;

    const profileA = { username: initial.username, displayName: `${initial.name} maker`, email: initial.email, operator: maker.username, reason: `${probe} concurrent profile maker`, expectedVersion: initial.version };
    const profileB = { username: initial.username, displayName: `${initial.name} checker`, email: initial.email, operator: checker.username, reason: `${probe} concurrent profile checker`, expectedVersion: initial.version };
    const [first, second] = await Promise.all([
      command(page, "PATCH", `/api/admin/platform/accounts/${targetId}/profile`, `${probe}:cas-maker`, profileA),
      command(checkerPage, "PATCH", `/api/admin/platform/accounts/${targetId}/profile`, `${probe}:cas-checker`, profileB),
    ]);
    expect([first, second].filter((result) => result.status === 200 && result.code === 0)).toHaveLength(1);
    expect([first, second].filter((result) => result.status === 409 && result.message.includes("ACCOUNT_VERSION_STALE"))).toHaveLength(1);
    const winner = first.status === 200 ? { key: `${probe}:cas-maker`, body: profileA } : { key: `${probe}:cas-checker`, body: profileB };
    const afterCas = await overview(page, targetId);
    const replay = await command(page, "PATCH", `/api/admin/platform/accounts/${targetId}/profile`, winner.key, winner.body);
    requireOk(replay, "same-key replay");
    expect((await overview(page, targetId)).version).toBe(afterCas.version);
    const mismatch = await command(page, "PATCH", `/api/admin/platform/accounts/${targetId}/profile`, winner.key, { ...winner.body, displayName: `${initial.name} mismatch` });
    expect(mismatch.status, "idempotency key payload mismatch must fail closed").toBe(409);

    const unknownKey = `${probe}:outcome-unknown`;
    const unknownBody = { username: initial.username, displayName: `${initial.name} unknown`, email: initial.email, operator: maker.username, reason: `${probe} outcome unknown must replay`, expectedVersion: afterCas.version };
    const observed = await page.evaluate(async ({ endpoint, key, body }) => {
      const pending = fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) })
        .then(() => "response-observed", () => "network-failed");
      return Promise.race([pending, new Promise<string>((resolve) => setTimeout(() => resolve("outcome-unknown"), 0))]);
    }, { endpoint: `/api/admin/platform/accounts/${targetId}/profile`, key: unknownKey, body: unknownBody });
    expect(observed).toBe("outcome-unknown");
    await expect.poll(async () => (await overview(page, targetId)).version, { timeout: 20_000 }).not.toBe(afterCas.version);
    const afterUnknown = await overview(page, targetId);
    requireOk(await command(page, "PATCH", `/api/admin/platform/accounts/${targetId}/profile`, unknownKey, unknownBody), "outcome unknown exact-key replay");
    expect((await overview(page, targetId)).version).toBe(afterUnknown.version);

    const evidenceSnapshot = databaseEvidence(targetId, probe);
    expect(evidenceSnapshot.account).toBe(1);
    expect(evidenceSnapshot.a2, "A2 audit evidence required").toBeGreaterThan(0);
    evidence.lifecycle = { cas: [first.status, second.status], replay: replay.status, mismatch: mismatch.status, unknownOutcome: observed, database: evidenceSnapshot };
  } finally {
    if (targetId && targetUsername) {
      cleanupContext = await browser.newContext({ baseURL: baseUrl });
      const cleanupPage = await cleanupContext.newPage();
      await login(cleanupPage, cleanup);
      await openVisibleA1(cleanupPage);
      evidence.residual = exactCleanup(targetId, targetUsername);
    }
    await cleanupContext?.close();
    await checkerContext?.close();
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(path.join(evidenceDir, `${probe}-summary.json`), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
});
