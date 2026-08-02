import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

/**
 * Final10 B-domain main-candidate write carrier.
 *
 * This carrier is inert until the main controller supplies every B_FINAL10_*
 * value, including a one-run write token.  It never falls back to a child DB,
 * a historical fixture, a default URL, or an old token.
 */

type Account = { id?: string | number; accountId?: string | number; username: string; password: string; totpSecret?: string };
type Fixture = { runId: string; sensitive?: boolean; accounts?: { maker?: Account; secondWriter?: Account } };
type RuntimeLock = {
  runId: string;
  candidate: string;
  jarSha256: string;
  pcBuildId: string;
  main: { backendPid: number; backendPort: number; pcPid: number; pcPort: number; database: string };
};
type ConfigRow = { id: number; configKey: string; configValue: string | null; valueType: string | null; configGroup: string | null; visibility: string | null; remark: string | null; status: number; createdAt: string; updatedAt: string; isDeleted: number };
type Evidence = { status: number; body: any };

const PREFIX = "FINAL10-B";
const EXPECTED_CANDIDATE = process.env.B_EXPECTED_CANDIDATE?.trim() || "Final10";
const MYSQL = process.env.B_FINAL10_MYSQL_EXE || "D:\\software\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe";
const configPrefix = "treasury.d3.forecast-config";
const TOTP_COUNTER_OFFSET = Number(process.env.B_FINAL10_TOTP_COUNTER_OFFSET ?? "-1");

test.describe.configure({ mode: "serial" });

if (!Number.isInteger(TOTP_COUNTER_OFFSET) || TOTP_COUNTER_OFFSET < -2 || TOTP_COUNTER_OFFSET > 2) {
  throw new Error("B_FINAL10_TOTP_COUNTER_OFFSET_MUST_BE_AN_INTEGER_BETWEEN_-2_AND_2");
}

test("Final10 B main：B2 双运营员 CAS/幂等/结果未知与 B3 保存闭环，精确恢复夹具", async ({ browser }) => {
  test.skip(!process.env.B_FINAL10_WRITE_TOKEN?.trim(), "B Final10 write token has not been issued by the main controller");
  test.setTimeout(300_000);

  const runId = required("B_FINAL10_RUN_ID");
  const baseUrl = required("B_FINAL10_BASE_URL");
  const database = required("B_FINAL10_DATABASE");
  const fixturePath = required("B_FINAL10_FIXTURE_PATH");
  const evidenceDir = required("B_FINAL10_EVIDENCE_DIR");
  const runtimeLockPath = required("B_FINAL10_RUNTIME_LOCK_PATH");
  const jarPath = required("B_FINAL10_BACKEND_JAR_PATH");
  const mysqlPassword = required("B_FINAL10_MYSQL_PASSWORD");
  const caseId = required("B_FINAL10_CASE_ID");
  const writeToken = required("B_FINAL10_WRITE_TOKEN");
  expect(runId).toBe("pc-full-acceptance-20260729-114336");
  expect(caseId).toMatch(/^[a-z0-9-]{6,48}$/);
  expect(writeToken.length, "write token must be explicit and non-trivial").toBeGreaterThanOrEqual(16);
  expect(new URL(baseUrl).hostname).toBe("127.0.0.1");
  expect(path.resolve(evidenceDir)).toContain(path.resolve(`D:\\workspace\\bug-pic\\.restricted\\${runId}\\B`));

  const lock = normalizeRuntimeLock(JSON.parse(await readFile(runtimeLockPath, "utf8")));
  assertRuntimeLock(lock, runId, baseUrl, database, jarPath);
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
  expect(fixture.runId).toBe(runId);
  expect(fixture.sensitive, "fixture must be restricted/sensitive").toBe(true);
  const maker = account(fixture.accounts?.maker, "accounts.maker");
  const secondWriter = account(fixture.accounts?.secondWriter, "accounts.secondWriter");
  expect(secondWriter.username).not.toBe(maker.username);
  expect(accountId(maker)).not.toBe(accountId(secondWriter));
  expect((await mysql(mysqlPassword, database, "SELECT DATABASE()")).trim()).toBe(database);
  await assertCandidateIsLive(baseUrl, lock);
  await assertNoTargetCollision(mysqlPassword, database, runId, caseId);

  await mkdir(evidenceDir, { recursive: true });
  const evidence: Record<string, unknown> = {
    runId, candidate: lock.candidate, baseUrl, database, caseId,
    runtime: { pcBuildId: lock.pcBuildId, jarSha256: lock.jarSha256, pcPid: lock.main.pcPid, backendPid: lock.main.backendPid },
    actors: [{ id: accountId(maker), username: maker.username }, { id: accountId(secondWriter), username: secondWriter.username }],
  };
  const beforeConfig = await snapshotConfig(mysqlPassword, database);
  const createdViews: string[] = [];
  let runFailure: unknown;
  let cleanupFailure: unknown;
  const one = await browser.newContext();
  const two = await browser.newContext();
  try {
    const pageOne = await one.newPage();
    const pageTwo = await two.newPage();
    await Promise.all([login(pageOne, baseUrl, maker), login(pageTwo, baseUrl, secondWriter)]);
    await Promise.all([openVisibleB2(pageOne), openVisibleB2(pageTwo)]);
    evidence.authorities = await Promise.all([assertWriter(pageOne, maker), assertWriter(pageTwo, secondWriter)]);
    evidence.b2 = await b2Lifecycle(pageOne, pageTwo, runId, caseId);
    await openVisibleB3(pageOne);
    const b3 = await b3Lifecycle(pageOne, runId, caseId);
    createdViews.push(...b3.names);
    evidence.b3 = b3;
    evidence.database = await databaseEvidence(mysqlPassword, database, runId, caseId, createdViews);
  } catch (error) {
    runFailure = error;
    evidence.failure = errorText(error);
  } finally {
    const errors: unknown[] = [];
    try { await restoreConfig(mysqlPassword, database, beforeConfig); } catch (error) { errors.push(error); }
    try { await deleteViews(mysqlPassword, database, runId, caseId); } catch (error) { errors.push(error); }
    try { expect(await snapshotConfig(mysqlPassword, database)).toEqual(beforeConfig); } catch (error) { errors.push(error); }
    try { expect(await countViews(mysqlPassword, database, runId, caseId)).toBe(0); } catch (error) { errors.push(error); }
    evidence.cleanup = { configRestoredExactly: errors.length === 0, remainingViews: await countViews(mysqlPassword, database, runId, caseId).catch(() => -1), retainedAuditAndOutbox: true };
    if (errors.length) cleanupFailure = new AggregateError(errors, "B_FINAL10_MAIN_CLEANUP_INCOMPLETE");
    await Promise.allSettled([one.close(), two.close()]);
    await writeFile(path.join(evidenceDir, `b-final10-main-write-${caseId}.json`), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
  if (cleanupFailure) throw cleanupFailure;
  if (runFailure) throw runFailure;
});

async function b2Lifecycle(one: Page, two: Page, runId: string, caseId: string) {
  const initial = await api(await one.request.get("/api/admin/treasury/forecast-config"));
  expect(initial.status).toBe(200);
  const version = integer(initial.body?.data?.version, "B2 initial version");
  const original = config(initial.body?.data);
  const changed = { ...original, trialStressEnabled: !original.trialStressEnabled };
  const firstBody = { ...changed, expectedVersion: version, reason: `${PREFIX}-${runId}-${caseId}-b2-w1`, operator: "Final10 B writer one" };
  const secondBody = { ...changed, expectedVersion: version, reason: `${PREFIX}-${runId}-${caseId}-b2-w2`, operator: "Final10 B writer two" };
  const keyOne = key(runId, caseId, "b2-w1");
  const keyTwo = key(runId, caseId, "b2-w2");
  const [first, second] = await Promise.all([put(one, keyOne, firstBody), put(two, keyTwo, secondBody)]);
  expect([first.status, second.status].sort()).toEqual([200, 409]);
  const winner = first.status === 200 ? { page: one, key: keyOne, body: firstBody, response: first } : { page: two, key: keyTwo, body: secondBody, response: second };
  const replay = await put(winner.page, winner.key, winner.body);
  expect(replay.body).toEqual(winner.response.body);
  const mismatch = await put(winner.page, winner.key, { ...winner.body, reason: `${winner.body.reason}-mismatch` });
  expect(mismatch.status).toBe(409);
  expect(mismatch.body?.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
  const unknownBody = { ...changed, genesisIncluded: !changed.genesisIncluded, expectedVersion: version + 1, reason: `${PREFIX}-${runId}-${caseId}-b2-unknown`, operator: "Final10 B unknown-result recovery" };
  const unknownKey = key(runId, caseId, "b2-unknown");
  const unknown = await commitThenDisconnect(winner.page, unknownKey, unknownBody);
  expect(unknown.server.status).toBe(200);
  const recovered = await put(winner.page, unknownKey, unknownBody);
  expect(recovered.status).toBe(200);
  expect(recovered.body).toEqual(unknown.server.body);
  const current = await api(await winner.page.request.get("/api/admin/treasury/forecast-config"));
  expect(integer(current.body?.data?.version, "B2 CAS result")).toBe(version + 2);
  return { initial, concurrent: { first, second }, replay, mismatch, unknown, recovered, final: current };
}

async function commitThenDisconnect(page: Page, idempotencyKey: string, data: Record<string, unknown>) {
  let resolveServer!: (value: Evidence) => void;
  const observedServer = new Promise<Evidence>((resolve) => { resolveServer = resolve; });
  const matcher = "**/api/admin/treasury/forecast-config";
  await page.route(matcher, async (route) => {
    if (route.request().headers()["idempotency-key"] !== idempotencyKey) return route.continue();
    const response = await route.fetch();
    resolveServer(await api(response));
    await route.abort("connectionreset");
  });
  try {
    const client = await page.evaluate(async ({ key, body }) => {
      try {
        await fetch("/api/admin/treasury/forecast-config", { method: "PUT", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
        return { kind: "response" };
      } catch (error) {
        return { kind: "error", name: error instanceof Error ? error.name : "Error" };
      }
    }, { key: idempotencyKey, body: data });
    const server = await observedServer;
    expect(client.kind, "client must not receive the committed response").toBe("error");
    return { client, server };
  } finally {
    await page.unroute(matcher);
  }
}

async function b3Lifecycle(page: Page, runId: string, caseId: string) {
  const name = `${PREFIX}-${caseId}-view`;
  const body = { name, cohort: "ALL", phase: "ALL", ref: "ALL", granularity: "WEEK", comparison: "PREVIOUS" };
  const stableKey = key(runId, caseId, "b3-stable");
  const first = await post(page, stableKey, body);
  expect(first.status).toBe(200);
  const replay = await post(page, stableKey, body);
  expect(replay.body).toEqual(first.body);
  const mismatch = await post(page, stableKey, { ...body, comparison: "YEAR_OVER_YEAR" });
  expect(mismatch.status).toBe(409);
  expect(mismatch.body?.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
  return { names: [name], first, replay, mismatch };
}

async function assertWriter(page: Page, actor: Account) {
  const session = await api(await page.request.get("/api/admin/auth/session"));
  expect(session.status).toBe(200);
  const data = session.body?.data?.session ?? session.body?.data ?? {};
  const authorities: string[] = Array.isArray(data.authorities) ? data.authorities.map(String) : [];
  expect(authorities.some((item: string) => item === "overview_b2_write" || item === "finance_d3_write")).toBe(true);
  expect(authorities).toContain("overview_b3_view_write");
  expect(String(data.username)).toBe(actor.username);
  return { id: data.adminId ?? data.id, username: data.username, bAuthorities: authorities.filter((item: string) => item.startsWith("overview_b")) };
}

async function openVisibleB2(page: Page) { await openSidebar(page, "/overview/liquidity", "资金池水位"); }
async function openVisibleB3(page: Page) { await openSidebar(page, "/overview/funnel", "转化漏斗"); }
async function openSidebar(page: Page, href: string, heading: string) {
  const link = page.locator(`aside a[href="${href}"]`).first();
  if (!(await link.isVisible().catch(() => false))) await page.getByRole("button", { name: /总览驾驶舱/ }).click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
}

async function login(page: Page, baseUrl: string, actor: Account) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  if (await shell.isVisible().catch(() => false)) return;
  await page.locator('input[autocomplete="username"]').fill(actor.username);
  await page.locator('input[autocomplete="current-password"]').fill(actor.password);
  const response = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/admin/auth/login" && candidate.request().method() === "POST");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await response).status()).toBe(200);
  if (!(await shell.isVisible({ timeout: 1000 }).catch(() => false))) {
    if (!actor.totpSecret) throw new Error("FINAL10_B_RESTRICTED_TOTP_REQUIRED");
    await page.getByLabel("一次性验证码").fill(await freshTotp(actor.totpSecret));
    const verified = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/admin/auth/mfa/verify" && candidate.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await verified).status()).toBe(200);
  }
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function databaseEvidence(password: string, database: string, runId: string, caseId: string, views: string[]) {
  const marker = `${PREFIX}-${runId}-${caseId}`;
  const auditCount = await scalar(password, database, `SELECT COUNT(*) FROM nx_audit_log WHERE is_deleted=0 AND CAST(detail_json AS CHAR) LIKE ${sql(`%${marker}%`)}`);
  const outboxCount = await scalar(password, database, `SELECT COUNT(*) FROM nx_event_outbox WHERE is_deleted=0 AND event_type='admin.treasury_forecast_config_changed' AND CAST(payload AS CHAR) LIKE ${sql(`%${marker}%`)}`);
  const succeededIdempotency = await scalar(password, database, `SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE is_deleted=0 AND status='SUCCEEDED' AND idempotency_key LIKE ${sql(`${PREFIX}-${runId}-${caseId}-%`)}`);
  const savedViewCount = await scalar(password, database, `SELECT COUNT(*) FROM nx_admin_funnel_view WHERE is_deleted=0 AND view_name IN (${views.map(sql).join(",")})`);
  expect(auditCount, "A2 immutable audit evidence").toBeGreaterThanOrEqual(2);
  expect(outboxCount, "A4/outbox evidence for the B2 mutation").toBeGreaterThanOrEqual(1);
  expect(succeededIdempotency).toBeGreaterThanOrEqual(2);
  expect(savedViewCount).toBe(1);
  return { marker, auditCount, outboxCount, succeededIdempotency, savedViewCount };
}

async function assertNoTargetCollision(password: string, database: string, runId: string, caseId: string) {
  const marker = `${PREFIX}-${runId}-${caseId}`;
  expect(await scalar(password, database, `SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE idempotency_key LIKE ${sql(`${marker}-%`)}`)).toBe(0);
  expect(await scalar(password, database, `SELECT COUNT(*) FROM nx_admin_funnel_view WHERE view_name LIKE ${sql(`${PREFIX}-${caseId}-%`)}`)).toBe(0);
}

async function snapshotConfig(password: string, database: string): Promise<ConfigRow[]> {
  const raw = await mysql(password, database, `SELECT REPLACE(TO_BASE64(CAST(JSON_OBJECT('id',id,'configKey',config_key,'configValue',config_value,'valueType',value_type,'configGroup',config_group,'visibility',visibility,'remark',remark,'status',status,'createdAt',DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s'),'updatedAt',DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s'),'isDeleted',is_deleted) AS CHAR CHARACTER SET utf8mb4)), CHAR(10), '') FROM nx_config_item WHERE config_key LIKE ${sql(`${configPrefix}%`)} ORDER BY id`);
  return raw.trim() ? raw.trim().split(/\r?\n/).map((line) => JSON.parse(Buffer.from(line, "base64").toString("utf8")) as ConfigRow) : [];
}
async function restoreConfig(password: string, database: string, rowsBefore: ConfigRow[]) {
  const values = rowsBefore.map((row) => `(${row.id},${sql(row.configKey)},${nullable(row.configValue)},${nullable(row.valueType)},${nullable(row.configGroup)},${nullable(row.visibility)},${nullable(row.remark)},${row.status},${sql(row.createdAt)},${sql(row.updatedAt)},${row.isDeleted})`).join(",");
  const insert = values ? `INSERT INTO nx_config_item(id,config_key,config_value,value_type,config_group,visibility,remark,status,created_at,updated_at,is_deleted) VALUES ${values};` : "";
  await mysql(password, database, `START TRANSACTION; DELETE FROM nx_config_item WHERE config_key LIKE ${sql(`${configPrefix}%`)}; ${insert} COMMIT;`);
}
async function deleteViews(password: string, database: string, _runId: string, caseId: string) { await mysql(password, database, `DELETE FROM nx_admin_funnel_view WHERE view_name LIKE ${sql(`${PREFIX}-${caseId}-%`)}`); }
async function countViews(password: string, database: string, _runId: string, caseId: string) { return scalar(password, database, `SELECT COUNT(*) FROM nx_admin_funnel_view WHERE view_name LIKE ${sql(`${PREFIX}-${caseId}-%`)}`); }

async function put(page: Page, idempotencyKey: string, data: Record<string, unknown>) { return api(await page.request.put("/api/admin/treasury/forecast-config", { headers: keyed(idempotencyKey), data })); }
async function post(page: Page, idempotencyKey: string, data: Record<string, unknown>) { return api(await page.request.post("/api/admin/funnel/view", { headers: keyed(idempotencyKey), data })); }
function keyed(idempotencyKey: string) { return { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }; }
async function api(response: APIResponse): Promise<Evidence> { const text = await response.text(); let body: any; try { body = JSON.parse(text); } catch { body = { raw: text }; } return { status: response.status(), body }; }
function config(data: any) { const value = data?.pendingConfig ?? data ?? {}; return { reserveCategories: value.reserveCategories, liabilityCategories: value.liabilityCategories, forecastWindow: value.forecastWindow, genesisIncluded: value.genesisIncluded, includeFarLiabilities: value.includeFarLiabilities, stakingInterestMode: value.stakingInterestMode, trialStressEnabled: value.trialStressEnabled }; }
function key(runId: string, caseId: string, purpose: string) { const value = `${PREFIX}-${runId}-${caseId}-${purpose}`; if (Buffer.byteLength(value) > 128) throw new Error("FINAL10_B_IDEMPOTENCY_KEY_TOO_LONG"); return value; }

function assertRuntimeLock(lock: RuntimeLock, runId: string, baseUrl: string, database: string, jarPath: string) {
  expect(lock.runId).toBe(runId); expect(lock.candidate).toBe(EXPECTED_CANDIDATE); expect(lock.main.database).toBe(database); expect(new URL(baseUrl).port).toBe(String(lock.main.pcPort)); expect(existsSync(jarPath)).toBe(true); expect(hash(jarPath)).toBe(lock.jarSha256.toUpperCase());
  for (const pid of [lock.main.pcPid, lock.main.backendPid]) { try { process.kill(pid, 0); } catch { throw new Error(`FINAL10_RUNTIME_PID_NOT_LIVE:${pid}`); } }
}
function normalizeRuntimeLock(value: any): RuntimeLock {
  if (value?.main) return value as RuntimeLock;
  if (value?.pc?.main && value?.backend?.main) {
    return {
      runId: value.runId,
      candidate: value.candidate,
      jarSha256: value.backend.jarSha256,
      pcBuildId: value.pc.buildId,
      main: {
        backendPid: value.backend.main.pid,
        backendPort: Number(new URL(value.pc.main.backendUrl).port),
        pcPid: value.pc.main.pid,
        pcPort: Number(new URL(value.pc.main.baseUrl).port),
        database: value.backend.main.database,
      },
    };
  }
  throw new Error("B_RUNTIME_LOCK_SCHEMA_UNSUPPORTED");
}
async function assertCandidateIsLive(baseUrl: string, lock: RuntimeLock) { const response = await fetch(new URL(`/_next/static/${lock.pcBuildId}/_buildManifest.js`, baseUrl)); expect(response.status).toBe(200); }
function required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name}_REQUIRED`); return value; }
function account(value: Account | undefined, label: string) { if (!value?.username || !value.password || !value.totpSecret) throw new Error(`${label}_RESTRICTED_CREDENTIALS_REQUIRED`); return value; }
function accountId(value: Account) { const id = Number(value.id ?? value.accountId); if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`FINAL10_B_ACCOUNT_ID_INVALID:${value.username}`); return id; }
function integer(value: unknown, label: string) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label}_INVALID`); return number; }
function hash(filePath: string) { return createHash("sha256").update(readFileSync(filePath)).digest("hex").toUpperCase(); }
function sql(value: string) { return `CONVERT(UNHEX('${Buffer.from(value, "utf8").toString("hex")}') USING utf8mb4)`; }
function nullable(value: string | null) { return value === null ? "NULL" : sql(value); }
async function mysql(password: string, database: string, statement: string) { return execFileSync(MYSQL, ["--default-character-set=utf8mb4", "--batch", "--raw", "--skip-column-names", "-uroot", "-D", database, "-e", statement], { encoding: "utf8", env: { ...process.env, MYSQL_PWD: password }, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }); }
async function scalar(password: string, database: string, statement: string) { const value = Number((await mysql(password, database, statement)).trim()); if (!Number.isSafeInteger(value) || value < 0) throw new Error("FINAL10_B_INVALID_SCALAR"); return value; }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
const lastTotpStep = new Map<string, number>();
async function freshTotp(secret: string) { for (;;) { const step = Math.floor(Date.now() / 30_000); const remaining = 30_000 - Date.now() % 30_000; if (remaining >= 3_000 && lastTotpStep.get(secret) !== step) { lastTotpStep.set(secret, step); return totp(secret); } await new Promise((resolve) => setTimeout(resolve, remaining + 250)); } }
function totp(secret: string) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase(); let bits = ""; for (const character of normalized) { const index = alphabet.indexOf(character); if (index < 0) throw new Error("FINAL10_B_TOTP_INVALID"); bits += index.toString(2).padStart(5, "0"); } const bytes = Buffer.alloc(Math.floor(bits.length / 8)); for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2); const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + TOTP_COUNTER_OFFSET)); const digest = createHmac("sha1", bytes).update(message).digest(); const offset = digest[digest.length - 1] & 15; const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255); return String(binary % 1_000_000).padStart(6, "0"); }
