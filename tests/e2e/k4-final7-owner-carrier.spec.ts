import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

/**
 * Final7 K4 owner carrier.  It deliberately has no usable defaults: the
 * launcher must bind one immutable candidate and three restricted manifests.
 * Credentials are never copied to the evidence directory.
 */
type Credentials = { username: string; password: string; totpSecret: string };
type Manifest = { runId?: string; lock?: string; candidate?: Candidate; publisher?: Credentials; maker?: Credentials; checker?: Credentials; accounts?: Record<string, Credentials> };
type Candidate = { buildId: string; backendJarSha256: string };
type Envelope<T> = { code?: number; message?: string; data?: T };
type Model = { version: number; rowVersion: number; state: string; weights: Record<string, number>; inputSources: Record<string, boolean>; scoreMappings: Record<string, number>; bandLowMax: number; bandHighMin: number; autoEscalateScore: number };
type Overview = { model: Model; draft: Model | null; recomputePending: number };
type ScoreUser = { userNo: string; modelScore: number; effectiveScore: number; overridden: boolean; rowVersion: number; modelVersion: string };
type LifecycleSnapshot = {
  activeModels: number;
  draftModels: number;
  archivedHistory: number;
  activeOverrides: number;
  operationMutex: number;
  processingIdempotency: number;
};
type BrowserFaultCapture = {
  immediate: string[];
  successfulNavigationPaths: Set<string>;
  cancelledNavigationPaths: string[];
};
type Config = ReturnType<typeof readConfig>;

test.describe.configure({ mode: "serial", timeout: 420_000 });

test("K4 Final7: normal-MFA maker/checker/publisher complete visible lifecycle and exact cleanup", async ({ browser }) => {
  const config = readConfig();
  expect(config.mfaBypass).toBe("false");
  mkdirSync(config.evidenceDir, { recursive: true });
  const candidate = verifyCandidate(config);
  const publisher = readRestrictedActor(config, config.publisherManifest, "publisher");
  const maker = readRestrictedActor(config, config.makerManifest, "maker");
  const checker = readRestrictedActor(config, config.checkerManifest, "checker");
  expect(new Set([publisher.username, maker.username, checker.username]).size).toBe(3);

  const run = `${config.runId}:K4:${randomUUID()}`;
  const evidence: Record<string, unknown> = {
    runId: config.runId, lock: config.lock, candidate, actorHashes: {
      publisher: sha(publisher.username), maker: sha(maker.username), checker: sha(checker.username),
    }, startedAt: new Date().toISOString(), cleanup: "pending",
  };
  const publisherContext = await browser.newContext({ baseURL: config.baseUrl });
  const makerContext = await browser.newContext({ baseURL: config.baseUrl });
  const checkerContext = await browser.newContext({ baseURL: config.baseUrl });
  const publisherPage = await publisherContext.newPage();
  const makerPage = await makerContext.newPage();
  const checkerPage = await checkerContext.newPage();
  const faults: BrowserFaultCapture = {
    immediate: [], successfulNavigationPaths: new Set(), cancelledNavigationPaths: [],
  };
  let baseline: Overview | undefined;
  let baselineLifecycle: LifecycleSnapshot | undefined;
  let target: ScoreUser | undefined;

  try {
    await loginWithNormalMfa(publisherPage, publisher);
    await loginWithNormalMfa(makerPage, maker);
    await loginWithNormalMfa(checkerPage, checker);
    // The unauthenticated session probe is part of the login gate, not a K4 page fault.
    // Start the zero-fault window only after all three normal-MFA sessions exist.
    for (const page of [publisherPage, makerPage, checkerPage]) captureBrowserFaults(page, faults);
    await assertAuthority(publisherPage, publisher.username, ["risk_k4_write"], "SUPER_ADMIN");
    await assertAuthority(makerPage, maker.username, ["risk_k4_write", "risk_k4_user_override", "risk_k4_user_recompute"]);
    await assertAuthority(checkerPage, checker.username, ["risk_k4_user_override"]);
    await openK4FromVisibleSidebar(publisherPage);
    await openK4FromVisibleSidebar(makerPage);
    await openK4FromVisibleSidebar(checkerPage);

    baseline = await overview(makerPage);
    baselineLifecycle = lifecycleSnapshot(config);
    expect(baselineLifecycle.activeModels).toBe(1);
    expect(baselineLifecycle.draftModels).toBe(0);
    expect(baselineLifecycle.processingIdempotency).toBe(0);
    expect(baseline.draft, "Final7 K4 must begin with no retained draft").toBeNull();
    target = await scoreUser(makerPage, config.targetUserNo);
    expect(target.overridden, "Final7 target must not retain a manual override").toBe(false);
    await selectUserThroughVisibleUi(makerPage, target.userNo);
    await selectUserThroughVisibleUi(checkerPage, target.userNo);
    await saveDraftThroughVisibleUi(makerPage, run);
    await publisherPage.reload({ waitUntil: "domcontentloaded" });
    await expect(publisherPage.getByText("K4 评分模型", { exact: true })).toBeVisible();
    await publishDraftThroughVisibleUi(publisherPage, run);
    await waitForQueueDrain(makerPage);
    target = await scoreUser(makerPage, target.userNo);

    const cas = await concurrentOverrideCas(makerPage, checkerPage, target, run);
    const idem = await assertIdempotencyReplay(makerPage, cas.user, run);
    const unknown = await assertResultUnknown(makerPage, idem.user, run);
    evidence.operations = { cas: { statuses: cas.statuses }, idempotency: idem.safe, resultUnknown: unknown.safe };
    await assertDatabaseAndEventEvidence(config, run, evidence);
  } finally {
    try {
      if (baseline && baselineLifecycle && target) {
        await restoreBaselineThroughVisibleUi(publisherPage, baseline, run);
        await waitForQueueDrain(publisherPage);
        await recomputeUserThroughVisibleUi(makerPage, target.userNo, run);
        evidence.cleanupTerminal = await assertExactCleanup(
          config,
          publisherPage,
          makerPage,
          baseline,
          baselineLifecycle,
          target.userNo,
          run,
          evidence,
        );
        evidence.cleanup = "complete";
      } else evidence.cleanup = "not-started";
    } finally {
      evidence.finishedAt = new Date().toISOString();
      evidence.browserFaults = unexpectedBrowserFaults(faults);
      evidence.replacedNavigationCancellations = faults.cancelledNavigationPaths.filter(
        (pathname) => faults.successfulNavigationPaths.has(pathname),
      );
      writeSafeEvidence(config, evidence);
      await publisherContext.close(); await makerContext.close(); await checkerContext.close();
    }
  }
  expect(unexpectedBrowserFaults(faults)).toEqual([]);
});

function readConfig() {
  const config = {
    runId: required("K4_FINAL7_RUN_ID"), lock: required("K4_FINAL7_LOCK"), baseUrl: required("K4_FINAL7_BASE_URL"),
    mfaBypass: required("K4_FINAL7_MFA_BYPASS"), evidenceDir: required("K4_FINAL7_EVIDENCE_DIR"), restrictedDir: required("K4_FINAL7_RESTRICTED_DIR"),
    publisherManifest: required("K4_FINAL7_PUBLISHER_MANIFEST"), makerManifest: required("K4_FINAL7_MAKER_MANIFEST"), checkerManifest: required("K4_FINAL7_CHECKER_MANIFEST"),
    expectedBuildId: required("K4_FINAL7_EXPECTED_BUILD_ID"), buildIdPath: required("K4_FINAL7_BUILD_ID_PATH"), candidateJar: required("K4_FINAL7_CANDIDATE_JAR"), expectedJarSha256: required("K4_FINAL7_EXPECTED_JAR_SHA256").toUpperCase(),
    dbName: required("K4_FINAL7_DB_NAME"), dbPassword: required("K4_FINAL7_DB_PASSWORD"), targetUserNo: required("K4_FINAL7_TARGET_USER_NO"),
    mysql: process.env.K4_FINAL7_MYSQL_EXE?.trim() || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe",
  };
  const url = new URL(config.baseUrl);
  expect(new URL(config.baseUrl).hostname, "Final7 carrier only accepts loopback candidate").toMatch(/^(127\.0\.0\.1|localhost)$/);
  expect(url.protocol).toBe("http:");
  expect(config.lock).toBe(`K4_WRITE:${config.runId}:${config.expectedBuildId}:${config.expectedJarSha256}`);
  const restricted = path.resolve(config.restrictedDir);
  const evidence = path.resolve(config.evidenceDir);
  expect(restricted.toLowerCase()).toContain(`${path.sep}.restricted${path.sep}`);
  expect(evidence.startsWith(`${restricted}${path.sep}`)).toBe(true);
  expect(evidence).toContain(config.runId);
  return config;
}
function required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name}_REQUIRED`); return value; }
function sha(value: string) { return createHash("sha256").update(value, "utf8").digest("hex").toUpperCase(); }
function verifyCandidate(config: Config): Candidate {
  const buildId = readFileSync(config.buildIdPath, "utf8").trim();
  const backendJarSha256 = createHash("sha256").update(readFileSync(config.candidateJar)).digest("hex").toUpperCase();
  expect(buildId).toBe(config.expectedBuildId); expect(backendJarSha256).toBe(config.expectedJarSha256);
  return { buildId, backendJarSha256 };
}
function readRestrictedActor(config: Config, manifestPath: string, preferred: "publisher" | "maker" | "checker"): Credentials {
  const base = path.resolve(config.restrictedDir); const resolved = path.resolve(manifestPath);
  if (!resolved.startsWith(`${base}${path.sep}`)) throw new Error("K4_FINAL7_MANIFEST_OUTSIDE_RESTRICTED_DIR");
  const manifest = JSON.parse(readFileSync(resolved, "utf8")) as Manifest;
  if (!manifest.runId) throw new Error("K4_FINAL7_MANIFEST_RUN_REQUIRED");
  if (manifest.runId !== config.runId) throw new Error("K4_FINAL7_MANIFEST_RUN_MISMATCH");
  if (!manifest.lock) throw new Error("K4_FINAL7_MANIFEST_LOCK_REQUIRED");
  if (manifest.lock !== config.lock) throw new Error("K4_FINAL7_MANIFEST_LOCK_MISMATCH");
  if (manifest.candidate?.buildId !== config.expectedBuildId
      || manifest.candidate?.backendJarSha256?.toUpperCase() !== config.expectedJarSha256) {
    throw new Error("K4_FINAL7_MANIFEST_CANDIDATE_MISMATCH");
  }
  const actor = manifest[preferred] ?? manifest.accounts?.[preferred];
  if (!actor?.username || !actor.password || !actor.totpSecret) throw new Error(`K4_FINAL7_${preferred.toUpperCase()}_MFA_CREDENTIAL_REQUIRED`);
  return actor;
}

async function loginWithNormalMfa(page: Page, actor: Credentials) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(actor.username);
  await page.locator('input[autocomplete="current-password"]').fill(actor.password);
  const loginPending = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const login = await loginPending; const loginPayload = await login.json().catch(() => null) as { code?: number } | null;
  if (login.status() !== 200 || (loginPayload?.code ?? 0) !== 0) throw new Error(`LOGIN_FAILED status=${login.status()} code=${loginPayload?.code ?? "UNKNOWN"}`);
  const otp = page.getByLabel("一次性验证码"); await expect(otp, "normal-MFA actor must not bypass OTP").toBeVisible({ timeout: 20_000 });
  const verification = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify"); // once `verification` request is observed, fail immediately on non-200.
  await otp.fill(await freshTotp(actor.totpSecret)); await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  const response = await verification; const payload = await response.json().catch(() => null) as { code?: number } | null;
  if (response.status() !== 200 || (payload?.code ?? 0) !== 0) throw new Error(`MFA_VERIFY_FAILED status=${response.status()} code=${payload?.code ?? "UNKNOWN"}`);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}
async function assertAuthority(page: Page, username: string, authorities: string[], requiredRole?: string) {
  const data = await ok<{ session?: { username?: string; roleCode?: string; authorities?: string[] } }>(await page.request.get("/api/admin/auth/session"));
  expect(data.session?.username).toBe(username); if (requiredRole) expect(data.session?.roleCode).toBe(requiredRole);
  for (const authority of authorities) expect(data.session?.authorities ?? []).toContain(authority);
}
async function openK4FromVisibleSidebar(page: Page) {
  const link = page.locator('aside a[href="/risk/scoring"]').first();
  if (!await link.isVisible().catch(() => false)) { const group = page.locator('button[aria-controls="nav-group-K"]'); await expect(group).toBeVisible(); if (await group.getAttribute("aria-expanded") !== "true") await group.click(); }
  await expect(link).toBeVisible(); await link.click(); await expect(page).toHaveURL(/\/risk\/scoring/); await expect(page.getByText("K4 评分模型", { exact: true })).toBeVisible();
}
async function selectUserThroughVisibleUi(page: Page, userNo: string) { const box = page.getByRole("combobox", { name: "搜索用户编号或用户名" }); await box.fill(""); await box.fill(userNo); const listId = await box.getAttribute("aria-controls"); expect(listId).toBeTruthy(); await page.locator(`#${listId}`).getByRole("option").filter({ hasText: userNo }).first().click(); await expect(page.locator(".score-hero")).toContainText(userNo); }
async function saveDraftThroughVisibleUi(page: Page, run: string) { const card = page.locator("section.l-card").filter({ hasText: "K4 评分模型" }).first(); const inputs = card.locator('input[type="number"]'); const one = Number(await inputs.nth(0).inputValue()); const two = Number(await inputs.nth(1).inputValue()); await inputs.nth(0).fill(String(one < 100 ? one + 1 : one - 1)); await inputs.nth(1).fill(String(two > 0 ? two - 1 : two + 1)); await card.getByRole("button", { name: "保存模型草稿" }).click(); await confirmUi(page, `${run}: visible maker draft`, (r) => r.request().method() === "PUT" && r.url().endsWith("/api/admin/risk/scoring/model/draft")); }
async function publishDraftThroughVisibleUi(page: Page, run: string) { const card = page.locator("section.l-card").filter({ hasText: "K4 评分模型" }).first(); await card.getByRole("button", { name: "发布模型草稿" }).click(); await confirmUi(page, `${run}: publisher approval and publish`, (r) => r.request().method() === "POST" && r.url().endsWith("/api/admin/risk/scoring/model/publish")); }
async function confirmUi(page: Page, reason: string, match: (response: Response) => boolean) { const dialog = page.getByRole("dialog").last(); await expect(dialog).toBeVisible(); const textarea = dialog.locator("textarea"); if (await textarea.count()) await textarea.fill(reason); const pending = page.waitForResponse(match); await dialog.getByRole("button", { name: /确认/ }).last().click(); const response = await pending; expect(response.status(), await response.text()).toBe(200); }
async function overview(page: Page) { return ok<Overview>(await page.request.get("/api/admin/risk/scoring/overview?overridePageNum=1&overridePageSize=10")); }
async function scoreUser(page: Page, userNo: string) { return ok<ScoreUser>(await page.request.get(`/api/admin/risk/scoring/users/${encodeURIComponent(userNo)}`)); }
async function waitForQueueDrain(page: Page) { await expect.poll(async () => (await overview(page)).recomputePending, { timeout: 120_000 }).toBe(0); }
async function concurrentOverrideCas(maker: Page, checker: Page, before: ScoreUser, run: string) { const score = before.modelScore === 100 ? 99 : before.modelScore + 1; const [left, right] = await Promise.all([maker.request.post(`/api/admin/risk/scoring/users/${encodeURIComponent(before.userNo)}/override`, { headers: { "Idempotency-Key": `${run}:cas:maker` }, data: { score, expectedVersion: before.rowVersion, reason: `${run}: maker CAS` } }), checker.request.post(`/api/admin/risk/scoring/users/${encodeURIComponent(before.userNo)}/override`, { headers: { "Idempotency-Key": `${run}:cas:checker` }, data: { score: score === 100 ? 99 : score + 1, expectedVersion: before.rowVersion, reason: `${run}: checker CAS` } })]); expect([left.status(), right.status()].sort()).toEqual([200, 409]); const user = await scoreUser(maker, before.userNo); expect(user.overridden).toBe(true); return { statuses: [left.status(), right.status()], user }; }
async function assertIdempotencyReplay(page: Page, before: ScoreUser, run: string) { const key = `${run}:idem`; const score = before.effectiveScore === 100 ? 99 : before.effectiveScore + 1; const request = { headers: { "Idempotency-Key": key }, data: { score, expectedVersion: before.rowVersion, reason: `${run}: idempotency replay` } }; const first = await page.request.post(`/api/admin/risk/scoring/users/${encodeURIComponent(before.userNo)}/override`, request); expect(first.status(), await first.text()).toBe(200); const replay = await page.request.post(`/api/admin/risk/scoring/users/${encodeURIComponent(before.userNo)}/override`, request); expect(replay.status(), await replay.text()).toBe(200); const user = await scoreUser(page, before.userNo); return { user, safe: { first: first.status(), replay: replay.status(), idempotencyKeySha256: sha(key) } }; }
async function assertResultUnknown(page: Page, before: ScoreUser, run: string) {
  await selectUserThroughVisibleUi(page, before.userNo);
  const endpoint = `**/api/admin/risk/scoring/users/${encodeURIComponent(before.userNo)}/override`;
  const keys: string[] = [];
  let attempt = 0;
  let upstreamStatus = 0;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempt += 1;
    keys.push(await route.request().headerValue("idempotency-key") ?? "");
    if (attempt !== 1) return route.continue();
    const upstream = await route.fetch();
    upstreamStatus = upstream.status();
    await route.fulfill({
      response: upstream,
      headers: { ...upstream.headers(), "X-Nexion-Upstream-Outcome": "unknown" },
    });
  });
  try {
    const score = before.effectiveScore === 100 ? 99 : before.effectiveScore + 1;
    await page.getByRole("button", { name: "人工覆盖评分", exact: true }).click();
    const dialog = page.getByRole("dialog").last();
    await dialog.locator('input[type="number"]').fill(String(score));
    await dialog.locator("textarea").fill(`${run}: result unknown reconciliation`);
    const firstPending = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/scoring/users/${encodeURIComponent(before.userNo)}/override`));
    await dialog.getByRole("button", { name: "确认覆盖", exact: true }).click();
    const first = await firstPending;
    expect(first.status()).toBe(200);
    expect(first.headers()["x-nexion-upstream-outcome"]).toBe("unknown");
    expect(upstreamStatus).toBe(200);
    await expect(dialog).toBeVisible();
    await expect(page.getByText(/K4 结果未知/).last()).toBeVisible();
    const replayPending = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/scoring/users/${encodeURIComponent(before.userNo)}/override`));
    await dialog.getByRole("button", { name: "确认覆盖", exact: true }).click();
    const replay = await replayPending;
    expect(replay.status(), await replay.text()).toBe(200);
    await expect(dialog).toBeHidden();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    const user = await scoreUser(page, before.userNo);
    return { user, safe: { upstreamCommitted: true, reconciledBySameKeyReplay: true, first: first.status(), replay: replay.status(), idempotencyKeySha256: sha(keys[0]) } };
  } finally {
    await page.unroute(endpoint);
  }
}
async function restoreBaselineThroughVisibleUi(page: Page, baseline: Overview, run: string) { const current = await overview(page); if (current.draft || !sameModel(current.model, baseline.model)) { const history = page.locator("section.l-card").filter({ hasText: "模型版本历史" }); const row = history.locator(".ktint").filter({ hasText: new RegExp(`v${baseline.model.version}`) }).first(); await expect(row).toBeVisible(); await row.getByRole("button", { name: "恢复为草稿" }).click(); await confirmUi(page, `${run}: restore baseline`, (r) => r.url().endsWith("/api/admin/risk/scoring/model/restore-draft")); await publishDraftThroughVisibleUi(page, `${run}: restore baseline`); } }
async function recomputeUserThroughVisibleUi(page: Page, userNo: string, run: string) { const user = await scoreUser(page, userNo); if (!user.overridden) return; await selectUserThroughVisibleUi(page, userNo); await page.getByRole("button", { name: "重算回模型分", exact: true }).click(); await confirmUi(page, `${run}: cleanup override`, (r) => /\/api\/admin\/risk\/scoring\/users\/[^/]+\/recompute$/.test(new URL(r.url()).pathname)); }
async function assertDatabaseAndEventEvidence(config: Config, run: string, evidence: Record<string, unknown>) { const audit = mysql(config, `SELECT COUNT(*) FROM nx_audit_log WHERE detail_json LIKE '%${sql(run)}%'`); const outbox = mysql(config, `SELECT COUNT(*) FROM nx_event_outbox WHERE payload LIKE '%${sql(run)}%'`); const idem = mysql(config, `SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE idempotency_key LIKE '${sql(run)}%'`); evidence.database = { auditRows: Number(audit), outboxRows: Number(outbox), idempotencyRows: Number(idem), tables: ["nx_admin_risk_score_model", "nx_audit_log", "nx_event_outbox"] }; expect(Number(audit)).toBeGreaterThan(0); expect(Number(outbox)).toBeGreaterThan(0); }
async function assertExactCleanup(
  config: Config,
  publisher: Page,
  maker: Page,
  baseline: Overview,
  baselineLifecycle: LifecycleSnapshot,
  userNo: string,
  run: string,
  evidence: Record<string, unknown>,
) {
  await expect.poll(async () => (await scoreUser(maker, userNo)).overridden, {
    timeout: 30_000,
    message: "K4 cleanup must remain observable after the recompute transaction commits",
  }).toBe(false);
  const model = await overview(publisher);
  const user = await scoreUser(maker, userNo);
  expect(model.draft).toBeNull(); expect(sameModel(model.model, baseline.model)).toBe(true);
  expect(user.overridden).toBe(false); expect(user.effectiveScore).toBe(user.modelScore);
  const terminal = lifecycleSnapshot(config);
  expect(terminal.activeModels, "exactly one active K4 model").toBe(1);
  expect(terminal.draftModels, "no retained K4 draft").toBe(baselineLifecycle.draftModels);
  expect(terminal.activeOverrides, "active overrides return to baseline").toBe(baselineLifecycle.activeOverrides);
  expect(terminal.operationMutex, "K4/risk mutex rows return to baseline").toBe(baselineLifecycle.operationMutex);
  expect(terminal.processingIdempotency, "no K4 processing idempotency remains").toBe(baselineLifecycle.processingIdempotency);
  expect(terminal.archivedHistory, "immutable model version history may only grow").toBeGreaterThanOrEqual(baselineLifecycle.archivedHistory);
  const auditRows = Number(mysql(config, `SELECT COUNT(*) FROM nx_audit_log WHERE detail_json LIKE '%${sql(run)}%'`));
  const terminalOutboxRows = Number(mysql(config, `SELECT COUNT(*) FROM nx_event_outbox WHERE payload LIKE '%${sql(run)}%'`));
  const observedOutboxRows = Number((evidence.database as { outboxRows?: number } | undefined)?.outboxRows ?? 0);
  // The carrier never deletes audit/outbox rows. The outbox dispatcher may consume
  // delivered rows before terminal cleanup, so durable production is asserted at
  // the operation boundary and the terminal count is retained as evidence only.
  expect(auditRows).toBeGreaterThan(0);
  mysql(config, `DELETE FROM nx_admin_idempotency_record WHERE LEFT(idempotency_key,CHAR_LENGTH('${sql(run)}'))='${sql(run)}'`);
  const residue = mysql(config, `SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE LEFT(idempotency_key,CHAR_LENGTH('${sql(run)}'))='${sql(run)}'`);
  expect(Number(residue)).toBe(0);
  return {
    baseline: baselineLifecycle,
    terminal,
    semanticConfigRestored: true,
    activeVersionIdentity: { before: baseline.model.version, after: model.model.version },
    archivedHistoryRetained: terminal.archivedHistory >= baselineLifecycle.archivedHistory,
    immutableEvidence: { auditRows, observedOutboxRows, terminalOutboxRows },
    mutableIdempotencyResidue: Number(residue),
  };
}
function lifecycleSnapshot(config: Config): LifecycleSnapshot {
  const raw = mysql(config, `
    SELECT
      (SELECT COUNT(*) FROM nx_admin_risk_score_model WHERE state='active' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_admin_risk_score_model WHERE state='draft' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_admin_risk_score_model WHERE state='archived' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_admin_risk_score_override WHERE active=1 AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_admin_operation_mutex WHERE UPPER(lock_key) LIKE 'K4%' OR UPPER(lock_key) LIKE 'RISK%'),
      (SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE status='PROCESSING' AND (UPPER(scope) LIKE 'K4%' OR UPPER(scope) LIKE 'RISK%'))
  `);
  const values = raw.split("\t").map(Number);
  expect(values).toHaveLength(6);
  return {
    activeModels: values[0],
    draftModels: values[1],
    archivedHistory: values[2],
    activeOverrides: values[3],
    operationMutex: values[4],
    processingIdempotency: values[5],
  };
}
function mysql(config: Config, statement: string) { return execFileSync(config.mysql, ["-uroot", "-D", config.dbName, "-N", "-B", "-e", statement], { encoding: "utf8", windowsHide: true, env: { ...process.env, MYSQL_PWD: config.dbPassword } }).trim(); }
function sql(value: string) { return value.replaceAll("'", "''"); }
function sameModel(left: Model, right: Model) { return isDeepStrictEqual(modelConfig(left), modelConfig(right)); }
function modelConfig(model: Model) { return { weights: model.weights, inputSources: model.inputSources, scoreMappings: model.scoreMappings, bandLowMax: model.bandLowMax, bandHighMin: model.bandHighMin, autoEscalateScore: model.autoEscalateScore }; }
async function ok<T>(response: APIResponse) { const text = await response.text(); expect(response.status(), text).toBeLessThan(400); const body = JSON.parse(text) as Envelope<T>; expect(body.code ?? 0, text).toBe(0); return body.data as T; }
function captureBrowserFaults(page: Page, into: BrowserFaultCapture) {
  page.on("pageerror", (error) => into.immediate.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") into.immediate.push(`console:${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() === 200) into.successfulNavigationPaths.add(new URL(response.url()).pathname);
  });
  page.on("requestfailed", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.failure()?.errorText === "net::ERR_ABORTED") {
      into.cancelledNavigationPaths.push(pathname);
      return;
    }
    into.immediate.push(`requestfailed:${pathname}:${request.failure()?.errorText ?? "unknown"}`);
  });
}
function unexpectedBrowserFaults(capture: BrowserFaultCapture) {
  return [
    ...capture.immediate,
    ...capture.cancelledNavigationPaths
      .filter((pathname) => !capture.successfulNavigationPaths.has(pathname))
      .map((pathname) => `requestfailed:${pathname}:net::ERR_ABORTED-without-replacement-200`),
  ];
}
function writeSafeEvidence(config: Config, evidence: Record<string, unknown>) { const file = path.join(config.evidenceDir, "k4-final7-owner-safe-summary.json"); writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`); }
async function freshTotp(secret: string) { const remaining = 30_000 - (Date.now() % 30_000); if (remaining < 4_000) await new Promise((resolve) => setTimeout(resolve, remaining + 500)); return totp(secret); }
function totp(secret: string) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const item of secret.replace(/[^A-Z2-7]/gi, "").toUpperCase()) bits += alphabet.indexOf(item).toString(2).padStart(5, "0"); const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2)); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000))); const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1] & 15; return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0"); }
