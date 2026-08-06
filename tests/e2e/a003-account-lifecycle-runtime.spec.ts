import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Credentials = { accountId?: string; username: string; password: string; totpSecret?: string };
type Operator = { id: string; username: string; name: string; email: string; role: string; status: string; version: string; sessions: number; tfa: boolean };
type LockedManifest = { runId: string; actors: { maker: Credentials; checker: Credentials; cleanup: Credentials } };
type Manifest = { runId: string; baseUrl: string; operators: { primary: Credentials; secondary: Credentials }; cleanup: Credentials };
type Result = { status: number; body: { code?: number; message?: string; data?: unknown } | null; raw: string };

const runManifestPath = process.env.A002_RUN_MANIFEST_PATH?.trim() || "";
const evidenceDir = process.env.A003_EVIDENCE_DIR?.trim() || "";
const writeToken = process.env.A_WRITE_TOKEN?.trim() || "";
const baseUrl = process.env.A003_BASE_URL?.trim() || "http://127.0.0.1:3002";
const expectedManifest = path.resolve("D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/final7-fixture-refresh/final7-a-fixture-manifest.json");

function config(): Manifest | null {
  if (!runManifestPath || !evidenceDir || !writeToken) return null;
  if (path.resolve(runManifestPath).toLowerCase() !== expectedManifest.toLowerCase()) throw new Error("A003 requires the locked Final7 A manifest");
  if (!/bug-pic[\\/]\.restricted[\\/]/i.test(path.resolve(evidenceDir))) throw new Error("A003 evidence must remain restricted");
  const url = new URL(baseUrl);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname) || url.port !== "3002") throw new Error("A003 base URL must use loopback 3002");
  const value = JSON.parse(readFileSync(runManifestPath, "utf8")) as LockedManifest;
  if (value.runId !== "pc-full-acceptance-20260729-114336" || !value.actors?.maker?.username || !value.actors?.checker?.username || !value.actors?.cleanup?.username) throw new Error("A003 manifest binding invalid");
  return { runId: value.runId, baseUrl, operators: { primary: value.actors.maker, secondary: value.actors.checker }, cleanup: value.actors.cleanup };
}

const usedTotpSteps = new Map<string, number>();
async function freshTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const c of normalized) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, i) => Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2)));
  const previous = usedTotpSteps.get(normalized) ?? -1;
  const remaining = 30_000 - (Date.now() % 30_000);
  if (Math.floor(Date.now() / 30_000) <= previous || remaining <= 3_000) await new Promise((resolve) => setTimeout(resolve, remaining + 500));
  const step = Math.floor(Date.now() / 30_000);
  usedTotpSteps.set(normalized, step);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function login(page: Page, account: Credentials, baseUrl: string) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const loginResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const login = await loginResponse;
  const loginRaw = await login.text().catch(() => "");
  expect(login.status(), `A003 login: ${loginRaw}`).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  if (await otp.isVisible({ timeout: 10_000 }).catch(() => false)) {
    if (!account.totpSecret) throw new Error("A003_MFA_SECRET_REQUIRED");
    if (30_000 - (Date.now() % 30_000) < 3_000) await page.waitForTimeout(3_500);
    await otp.fill(await freshTotp(account.totpSecret));
    const verified = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/mfa/verify" && response.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verified;
    const raw = await response.text().catch(() => "");
    expect(response.status(), `A003 MFA verify: ${raw}`).toBe(200);
    if (raw) expect(JSON.parse(raw) as { code?: number }).toMatchObject({ code: 0 });
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function request(page: Page, method: "POST" | "PATCH", url: string, key: string, data: Record<string, unknown>): Promise<Result> {
  const response = await page.request.fetch(url, { method, headers: { "Content-Type": "application/json", "Idempotency-Key": key }, data });
  const raw = await response.text();
  let body: Result["body"] = null;
  try { body = JSON.parse(raw) as Result["body"]; } catch { /* evidence keeps only structured envelopes */ }
  return { status: response.status(), body, raw };
}

function ok(result: Result, label: string) {
  expect(result.status, `${label}: ${result.raw}`).toBe(200);
  expect(result.body?.code, `${label}: ${result.raw}`).toBe(0);
}
function stale(result: Result, label: string) {
  expect(result.status, `${label}: ${result.raw}`).toBe(409);
  expect(result.body?.message, `${label}: ${result.raw}`).toContain("ACCOUNT_VERSION_STALE");
}
async function overview(page: Page, id: string): Promise<Operator> {
  const response = await page.request.get("/api/admin/platform/accounts/overview");
  const raw = await response.text();
  expect(response.status(), raw).toBe(200);
  const json = JSON.parse(raw) as { code?: number; data?: { operators?: Operator[] } };
  const value = json.data?.operators?.find((entry) => entry.id === id);
  expect(value, `missing account ${id}`).toBeTruthy();
  return value!;
}
function compact(result: Result) { return { status: result.status, code: result.body?.code ?? null, message: result.body?.message ?? "" }; }

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("A-003: dedicated A1 profile/role/password lifecycle is CAS-safe and retired", async ({ page, browser }) => {
  const active = config();
  test.skip(!active, "A003 explicit write token, restricted manifest/evidence and cleanup-only fixture-admin are required");
  mkdirSync(evidenceDir, { recursive: true });
  const suffix = randomBytes(5).toString("hex");
  const probe = `A003-${Date.now()}-${suffix}`;
  const evidence: Record<string, unknown> = { runId: active!.runId, probe, writeToken: `${writeToken.slice(0, 12)}…${writeToken.slice(-4)}` };
  let secondary: BrowserContext | undefined;
  let fixtureContext: BrowserContext | undefined;
  let targetId = "";
  let initial: Operator | undefined;
  try {
    await login(page, active!.operators.primary, active!.baseUrl);
    secondary = await browser.newContext({ baseURL: active!.baseUrl });
    const checker = await secondary.newPage();
    await login(checker, active!.operators.secondary, active!.baseUrl);
    const create = await request(page, "POST", "/api/admin/platform/accounts", `${probe}:create`, {
      username: `a003_lifecycle_${suffix}`,
      displayName: `A003 lifecycle ${suffix}`,
      email: `a003_lifecycle_${suffix}@nexion.invalid`,
      role: "unassigned",
      deliver: "handoff",
      initialPassword: `A003!${suffix}xY9`,
      operator: active!.operators.primary.username,
      reason: `${probe} dedicated disposable lifecycle account`,
    });
    ok(create, "create dedicated account");
    targetId = String((create.body?.data as { id?: unknown })?.id ?? "");
    expect(targetId).toMatch(/^\d+$/);
    initial = await overview(page, targetId);
    evidence.created = { id: targetId, username: initial.username, role: initial.role, status: initial.status, version: initial.version, tfa: initial.tfa, sessions: initial.sessions };

    const v0 = initial.version;
    const profileA = { username: initial.username, displayName: `${initial.name} A`, email: initial.email, operator: active!.operators.primary.username, reason: `${probe} profile CAS primary`, expectedVersion: v0 };
    const profileB = { username: initial.username, displayName: `${initial.name} B`, email: initial.email, operator: active!.operators.secondary.username, reason: `${probe} profile CAS secondary`, expectedVersion: v0 };
    const [pa, pb] = await Promise.all([
      request(page, "PATCH", `/api/admin/platform/accounts/${targetId}/profile`, `${probe}:profile-a`, profileA),
      request(checker, "PATCH", `/api/admin/platform/accounts/${targetId}/profile`, `${probe}:profile-b`, profileB),
    ]);
    expect([pa, pb].filter((item) => item.status === 200 && item.body?.code === 0)).toHaveLength(1);
    expect([pa, pb].filter((item) => item.status === 409 && item.body?.message?.includes("ACCOUNT_VERSION_STALE"))).toHaveLength(1);
    const winning = pa.status === 200 ? { result: pa, body: profileA, key: `${probe}:profile-a` } : { result: pb, body: profileB, key: `${probe}:profile-b` };
    const afterProfile = await overview(page, targetId);
    const replay = await request(page, "PATCH", `/api/admin/platform/accounts/${targetId}/profile`, winning.key, winning.body);
    ok(replay, "profile same-key replay");
    expect((await overview(page, targetId)).version).toBe(afterProfile.version);
    const mismatch = await request(page, "PATCH", `/api/admin/platform/accounts/${targetId}/profile`, winning.key, { ...winning.body, displayName: `${initial.name} mismatch` });
    expect(mismatch.status).toBe(409);
    const unknownKey = `${probe}:profile-unknown`;
    const unknownBody = { username: initial.username, displayName: `${initial.name} unknown`, email: initial.email, operator: active!.operators.primary.username, reason: `${probe} unknown outcome must replay`, expectedVersion: afterProfile.version };
    const observation = await page.evaluate(async ({ url, key, body }) => {
      const pending = fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) })
        .then(() => "observed", () => "network-failed");
      return Promise.race([pending, new Promise<string>((resolve) => setTimeout(() => resolve("outcome-unknown"), 0))]);
    }, { url: `/api/admin/platform/accounts/${targetId}/profile`, key: unknownKey, body: unknownBody });
    expect(observation).toBe("outcome-unknown");
    await expect.poll(async () => (await overview(page, targetId)).version, { timeout: 20_000 }).not.toBe(afterProfile.version);
    const afterUnknown = await overview(page, targetId);
    const unknownReplay = await request(page, "PATCH", `/api/admin/platform/accounts/${targetId}/profile`, unknownKey, unknownBody);
    ok(unknownReplay, "profile unknown-outcome replay");
    expect((await overview(page, targetId)).version).toBe(afterUnknown.version);
    evidence.profile = { concurrent: [compact(pa), compact(pb)], replay: compact(replay), mismatch: compact(mismatch), unknownOutcome: { observation, replay: compact(unknownReplay), version: afterUnknown.version } };

    const roleVersion = (await overview(page, targetId)).version;
    const role = await request(page, "PATCH", `/api/admin/platform/accounts/${targetId}/role`, `${probe}:role`, { role: "super", operator: active!.operators.primary.username, reason: `${probe} role lifecycle`, expectedVersion: roleVersion });
    ok(role, "role assign");
    const staleRole = await request(checker, "PATCH", `/api/admin/platform/accounts/${targetId}/role`, `${probe}:role-stale`, { role: "unassigned", operator: active!.operators.secondary.username, reason: `${probe} stale role must fail`, expectedVersion: roleVersion });
    stale(staleRole, "role stale CAS");
    const afterRole = await overview(page, targetId);
    evidence.role = { assign: compact(role), stale: compact(staleRole), version: afterRole.version, role: afterRole.role };

    const password = await request(page, "POST", `/api/admin/platform/accounts/${targetId}/password/reset`, `${probe}:password`, { operator: active!.operators.primary.username, reason: `${probe} disposable password reset`, expectedVersion: afterRole.version });
    ok(password, "password reset");
    const afterPassword = await overview(page, targetId);
    const stalePassword = await request(checker, "POST", `/api/admin/platform/accounts/${targetId}/password/reset`, `${probe}:password-stale`, { operator: active!.operators.secondary.username, reason: `${probe} stale password must fail`, expectedVersion: afterRole.version });
    stale(stalePassword, "password stale CAS");
    const protectedRevoke = await request(page, "POST", `/api/admin/platform/accounts/${targetId}/sessions/revoke`, `${probe}:revoke-super-protected`, { operator: active!.operators.primary.username, reason: `${probe} super target must fail closed`, expectedVersion: afterPassword.version });
    expect(protectedRevoke.status).toBe(403);
    expect(protectedRevoke.body?.message).toBe("FORCE_LOGOUT_SUPER_TARGET_FORBIDDEN");
    const demote = await request(page, "PATCH", `/api/admin/platform/accounts/${targetId}/role`, `${probe}:demote`, { role: "unassigned", operator: active!.operators.primary.username, reason: `${probe} retire temporary super role before session revoke`, expectedVersion: afterPassword.version });
    ok(demote, "demote temporary super");
    const afterDemote = await overview(page, targetId);
    const revoke = await request(page, "POST", `/api/admin/platform/accounts/${targetId}/sessions/revoke`, `${probe}:revoke`, { operator: active!.operators.primary.username, reason: `${probe} revoke disposable sessions`, expectedVersion: afterDemote.version });
    ok(revoke, "session revoke");
    evidence.passwordAndSession = { reset: compact(password), stale: compact(stalePassword), superTargetProtected: compact(protectedRevoke), demote: compact(demote), revoke: compact(revoke) };
  } finally {
    if (targetId && initial) {
      fixtureContext = await browser.newContext({ baseURL: active!.baseUrl });
      const restore = await fixtureContext.newPage();
      await login(restore, active!.cleanup, active!.baseUrl);
      let current = await overview(restore, targetId);
      if (current.name !== initial.name || current.email !== initial.email || current.username !== initial.username) {
        ok(await request(restore, "PATCH", `/api/admin/platform/accounts/${targetId}/profile`, `${probe}:cleanup-profile`, { username: initial.username, displayName: initial.name, email: initial.email, operator: active!.cleanup.username, reason: `${probe} exact profile restore`, expectedVersion: current.version }), "cleanup profile");
        current = await overview(restore, targetId);
      }
      if (current.role !== "unassigned") {
        ok(await request(restore, "PATCH", `/api/admin/platform/accounts/${targetId}/role`, `${probe}:cleanup-role`, { role: "unassigned", operator: active!.cleanup.username, reason: `${probe} retire disposable role`, expectedVersion: current.version }), "cleanup role");
        current = await overview(restore, targetId);
      }
      if (current.status !== "disabled") {
        ok(await request(restore, "PATCH", `/api/admin/platform/accounts/${targetId}/status`, `${probe}:cleanup-status`, { status: "disabled", operator: active!.cleanup.username, reason: `${probe} retire disposable account`, expectedVersion: current.version }), "cleanup status");
      }
      const final = await overview(restore, targetId);
      evidence.cleanup = { id: final.id, username: final.username, name: final.name, email: final.email, role: final.role, status: final.status, sessions: final.sessions, tfa: final.tfa, version: final.version };
    }
    await fixtureContext?.close();
    await secondary?.close();
    writeFileSync(path.join(evidenceDir, `${probe}.json`), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
});

test("A-003: A3/A4 reversible runtime writes restore their authoritative values", async ({ page }) => {
  const active = config();
  test.skip(!active, "A003 explicit write token, restricted manifest/evidence and cleanup-only fixture-admin are required");
  mkdirSync(evidenceDir, { recursive: true });
  const probe = `A304-${Date.now()}-${randomBytes(5).toString("hex")}`;
  const evidence: Record<string, unknown> = { runId: active!.runId, probe, writeToken: `${writeToken.slice(0, 12)}…${writeToken.slice(-4)}` };
  let originalFlag: { key: string; status: string } | undefined;
  let originalDay0: string | undefined;
  try {
    await login(page, active!.operators.primary, active!.baseUrl);
    const platform = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
    if ((await platform.getAttribute("aria-expanded")) !== "true") await platform.click();
    await page.locator('aside a[href="/platform/config"]').click();
    await expect(page).toHaveURL(/\/platform\/config$/);
    const configOverview = await page.request.get("/api/admin/platform/config/overview");
    const configJson = await configOverview.json() as { code?: number; data?: { featureFlags?: Array<{ key: string; status: string; allowedValues?: string[]; writable?: boolean }> } };
    expect(configOverview.status()).toBe(200);
    const flag = configJson.data?.featureFlags?.find((entry) => entry.writable && entry.allowedValues?.includes("on") && entry.allowedValues?.includes("off"));
    expect(flag, "a reversible A3 feature flag is required").toBeTruthy();
    originalFlag = { key: flag!.key, status: flag!.status };
    const nextFlag = flag!.status === "on" ? "off" : "on";
    const a3Response = await page.request.fetch("/api/admin/platform/config", { method: "PUT", headers: { "Content-Type": "application/json", "Idempotency-Key": `${probe}:a3` }, data: { kind: "flag", flagKey: flag!.key, value: nextFlag, expectedValue: flag!.status, reason: `${probe} reversible A3 write`, operator: active!.operators.primary.username } });
    const a3Raw = await a3Response.text();
    let a3Body: Result["body"] = null; try { a3Body = JSON.parse(a3Raw) as Result["body"]; } catch { /* preserve structured evidence only */ }
    const a3 = { status: a3Response.status(), body: a3Body, raw: a3Raw };
    ok(a3, "A3 reversible write");
    evidence.a3 = { key: flag!.key, original: flag!.status, changedTo: nextFlag, write: compact(a3) };

    await page.locator('aside a[href="/platform/events"]').click();
    await expect(page).toHaveURL(/\/platform\/events$/);
    const eventOverview = await page.request.get("/api/admin/platform/events/overview");
    const eventJson = await eventOverview.json() as { code?: number; data?: { dimensionParams?: Array<{ key: string; value: string }> } };
    expect(eventOverview.status()).toBe(200);
    const day0 = eventJson.data?.dimensionParams?.find((entry) => entry.key === "day0");
    expect(day0, "A4 day0 parameter is required").toBeTruthy();
    originalDay0 = day0!.value;
    const currentSeconds = Number.parseInt(originalDay0, 10);
    expect(currentSeconds).toBeGreaterThanOrEqual(30);
    expect(currentSeconds).toBeLessThanOrEqual(600);
    const nextDay0 = String(currentSeconds === 600 ? 599 : currentSeconds + 1);
    const a4 = await request(page, "PATCH", "/api/admin/platform/events/params/day0", `${probe}:a4`, { value: nextDay0, reason: `${probe} reversible A4 day0 write` });
    ok(a4, "A4 reversible write");
    evidence.a4 = { key: "day0", original: originalDay0, changedTo: nextDay0, write: compact(a4) };
  } finally {
    if (originalDay0 !== undefined) {
      const restoreA4 = await request(page, "PATCH", "/api/admin/platform/events/params/day0", `${probe}:cleanup-a4`, { value: originalDay0, reason: `${probe} exact A4 restore` });
      ok(restoreA4, "A4 restore");
      evidence.a4Restore = compact(restoreA4);
    }
    if (originalFlag) {
      const current = await page.request.get("/api/admin/platform/config/overview");
      const snapshot = await current.json() as { data?: { featureFlags?: Array<{ key: string; status: string }> } };
      const observed = snapshot.data?.featureFlags?.find((entry) => entry.key === originalFlag!.key)?.status;
      expect(observed).toBeTruthy();
      const restore = await page.request.fetch("/api/admin/platform/config", { method: "PUT", headers: { "Content-Type": "application/json", "Idempotency-Key": `${probe}:cleanup-a3` }, data: { kind: "flag", flagKey: originalFlag.key, value: originalFlag.status, expectedValue: observed, reason: `${probe} exact A3 restore`, operator: active!.operators.primary.username } });
      const raw = await restore.text();
      let body: Result["body"] = null; try { body = JSON.parse(raw) as Result["body"]; } catch { /* preserve structured evidence only */ }
      ok({ status: restore.status(), body, raw }, "A3 restore");
      evidence.a3Restore = compact({ status: restore.status(), body, raw });
    }
    writeFileSync(path.join(evidenceDir, `${probe}.json`), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
});
