import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

type Credentials = { username: string; password: string; totpSecret: string };
type Candidate = { buildId: string; backendJarSha256: string };
type Manifest = {
  runId?: string;
  lock?: string;
  candidate?: Candidate;
  publisher?: Credentials;
  maker?: Credentials;
  accounts?: Record<string, Credentials>;
};
type Envelope<T> = { code?: number; message?: string; data?: T };
type Overview = { model: { version: number }; draft: unknown | null; recomputePending: number };
type ScoreUser = {
  userNo: string;
  modelScore: number;
  effectiveScore: number;
  overridden: boolean;
  modelVersion: string;
  rowVersion: number;
};
type BrowserFaultCapture = {
  immediate: string[];
  successfulNavigationPaths: Set<string>;
  cancelledNavigationPaths: string[];
};
type Config = ReturnType<typeof readConfig>;

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("K4 Final11: two MFA operators recompute the same users in inverse order without a K4 deadlock", async ({ browser }) => {
  const config = readConfig();
  mkdirSync(config.evidenceDir, { recursive: true });
  const candidate = verifyCandidate(config);
  const manifest = readManifest(config);
  const publisher = actor(manifest, "publisher");
  const maker = actor(manifest, "maker");
  expect(publisher.username).not.toBe(maker.username);
  const userNos = config.userNos;
  expect(userNos).toHaveLength(2);

  const operationRun = `${config.runId}:K4-CONC:${randomUUID()}`;
  const leftKey = `${operationRun}:left`;
  const rightKey = `${operationRun}:right`;
  const beforeDeadlock = latestDeadlock(mysql(config, "SHOW ENGINE INNODB STATUS"));
  const evidence: Record<string, unknown> = {
    runId: config.runId,
    operationRunSha256: sha(operationRun),
    lock: config.lock,
    candidate,
    actorHashes: [sha(publisher.username), sha(maker.username)],
    startedAt: new Date().toISOString(),
  };

  const leftContext = await browser.newContext({ baseURL: config.baseUrl });
  const rightContext = await browser.newContext({ baseURL: config.baseUrl });
  const leftPage = await leftContext.newPage();
  const rightPage = await rightContext.newPage();
  const browserFaults: BrowserFaultCapture = {
    immediate: [], successfulNavigationPaths: new Set(), cancelledNavigationPaths: [],
  };

  try {
    await loginWithNormalMfa(leftPage, publisher);
    await loginWithNormalMfa(rightPage, maker);
    captureBrowserFaults(leftPage, browserFaults);
    captureBrowserFaults(rightPage, browserFaults);
    await assertAuthority(leftPage, "risk_k4_user_recompute");
    await assertAuthority(rightPage, "risk_k4_user_recompute");
    await openK4FromVisibleSidebar(leftPage);
    await openK4FromVisibleSidebar(rightPage);

    const overview = await ok<Overview>(await leftPage.request.get("/api/admin/risk/scoring/overview?overridePageNum=1&overridePageSize=10"));
    expect(overview.draft).toBeNull();
    const beforeUsers = await Promise.all(userNos.map((userNo) => scoreUser(leftPage, userNo)));
    expect(beforeUsers.every((user) => !user.overridden)).toBe(true);

    const started = Date.now();
    const [left, right] = await Promise.all([
      leftPage.request.post("/api/admin/risk/scoring/users/recompute", {
        timeout: 60_000,
        headers: { "Idempotency-Key": leftKey },
        data: {
          userNos: [userNos[0], userNos[1]],
          expectedModelVersion: overview.model.version,
          reason: `${operationRun}: inverse-order left`,
        },
      }),
      rightPage.request.post("/api/admin/risk/scoring/users/recompute", {
        timeout: 60_000,
        headers: { "Idempotency-Key": rightKey },
        data: {
          userNos: [userNos[1], userNos[0]],
          expectedModelVersion: overview.model.version,
          reason: `${operationRun}: inverse-order right`,
        },
      }),
    ]);
    const elapsedMs = Date.now() - started;
    const statuses = [left.status(), right.status()];
    expect(statuses.every((status) => [200, 409].includes(status))).toBe(true);
    expect(statuses.some((status) => status === 200)).toBe(true);
    const responseEvidence = await Promise.all([safeResponse(left), safeResponse(right)]);

    const afterUsers = await Promise.all(userNos.map((userNo) => scoreUser(leftPage, userNo)));
    expect(afterUsers.every((user) => !user.overridden)).toBe(true);
    expect(afterUsers.map((user) => user.modelScore)).toEqual(beforeUsers.map((user) => user.modelScore));
    expect(afterUsers.every((user) => user.effectiveScore === user.modelScore)).toBe(true);
    expect(afterUsers.every((user) => user.modelVersion === beforeUsers[0].modelVersion)).toBe(true);

    const afterDeadlock = latestDeadlock(mysql(config, "SHOW ENGINE INNODB STATUS"));
    const latestChanged = sha(afterDeadlock) !== sha(beforeDeadlock);
    const k4TableNames = [
      "nx_admin_risk_score_model", "nx_admin_risk_score_user",
      "nx_admin_risk_score_override", "nx_admin_risk_score_contribution",
    ];
    const containsK4ModelOrScoreTables = k4TableNames.some((table) => afterDeadlock.toLowerCase().includes(table));
    if (latestChanged) expect(containsK4ModelOrScoreTables, "new latest deadlock must not contain K4 model/score tables").toBe(false);

    const auditRows = Number(mysql(config, `SELECT COUNT(*) FROM nx_audit_log WHERE detail_json LIKE '%${sql(operationRun)}%'`));
    const outboxRows = Number(mysql(config, `SELECT COUNT(*) FROM nx_event_outbox WHERE payload LIKE '%${sql(operationRun)}%'`));
    const idempotencyRows = Number(mysql(config, `SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE idempotency_key IN ('${sql(leftKey)}','${sql(rightKey)}')`));
    expect(auditRows).toBeGreaterThan(0);
    // Both batches recompute the already-current model score. K4 deliberately emits no
    // score_updated outbox fact when score, model version and contributions are unchanged.
    expect(outboxRows).toBe(0);
    expect(idempotencyRows).toBeGreaterThan(0);
    expect(unexpectedBrowserFaults(browserFaults)).toEqual([]);

    evidence.concurrency = { statuses, responseEvidence, elapsedMs };
    evidence.users = {
      before: beforeUsers.map(safeUser),
      after: afterUsers.map(safeUser),
    };
    evidence.database = { auditRows, outboxRows, idempotencyRows };
    evidence.deadlock = {
      beforeSha256: sha(beforeDeadlock),
      afterSha256: sha(afterDeadlock),
      latestChanged,
      containsK4ModelOrScoreTables,
    };
  } finally {
    mysql(config, `DELETE FROM nx_admin_idempotency_record WHERE idempotency_key IN ('${sql(leftKey)}','${sql(rightKey)}')`);
    const idempotencyResidue = Number(mysql(config, `SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE idempotency_key IN ('${sql(leftKey)}','${sql(rightKey)}')`));
    evidence.idempotencyResidue = idempotencyResidue;
    evidence.browserFaults = unexpectedBrowserFaults(browserFaults);
    evidence.replacedNavigationCancellations = browserFaults.cancelledNavigationPaths.filter(
      (pathname) => browserFaults.successfulNavigationPaths.has(pathname),
    );
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(path.join(config.evidenceDir, "k4-final11-inverse-batch-safe-summary.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    await leftContext.close();
    await rightContext.close();
    expect(idempotencyResidue).toBe(0);
  }
});

function readConfig() {
  const config = {
    runId: required("K4_FINAL11_CONCURRENCY_RUN_ID"),
    lock: required("K4_FINAL11_CONCURRENCY_LOCK"),
    baseUrl: required("K4_FINAL11_CONCURRENCY_BASE_URL"),
    evidenceDir: required("K4_FINAL11_CONCURRENCY_EVIDENCE_DIR"),
    restrictedDir: required("K4_FINAL11_CONCURRENCY_RESTRICTED_DIR"),
    manifest: required("K4_FINAL11_CONCURRENCY_MANIFEST"),
    expectedBuildId: required("K4_FINAL11_CONCURRENCY_EXPECTED_BUILD_ID"),
    buildIdPath: required("K4_FINAL11_CONCURRENCY_BUILD_ID_PATH"),
    candidateJar: required("K4_FINAL11_CONCURRENCY_CANDIDATE_JAR"),
    expectedJarSha256: required("K4_FINAL11_CONCURRENCY_EXPECTED_JAR_SHA256").toUpperCase(),
    dbName: required("K4_FINAL11_CONCURRENCY_DB_NAME"),
    dbPassword: required("K4_FINAL11_CONCURRENCY_DB_PASSWORD"),
    userNos: required("K4_FINAL11_CONCURRENCY_USER_NOS").split(",").map((value) => value.trim()).filter(Boolean),
    mysql: process.env.K4_FINAL11_CONCURRENCY_MYSQL_EXE?.trim() || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe",
  };
  expect(new URL(config.baseUrl).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  expect(config.lock).toBe(`K4_WRITE:${config.runId}:${config.expectedBuildId}:${config.expectedJarSha256}`);
  expect(path.resolve(config.evidenceDir).startsWith(`${path.resolve(config.restrictedDir)}${path.sep}`)).toBe(true);
  return config;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function verifyCandidate(config: Config): Candidate {
  const buildId = readFileSync(config.buildIdPath, "utf8").trim();
  const backendJarSha256 = createHash("sha256").update(readFileSync(config.candidateJar)).digest("hex").toUpperCase();
  expect(buildId).toBe(config.expectedBuildId);
  expect(backendJarSha256).toBe(config.expectedJarSha256);
  return { buildId, backendJarSha256 };
}

function readManifest(config: Config): Manifest {
  const resolved = path.resolve(config.manifest);
  const restricted = path.resolve(config.restrictedDir);
  expect(resolved.startsWith(`${restricted}${path.sep}`)).toBe(true);
  const manifest = JSON.parse(readFileSync(resolved, "utf8")) as Manifest;
  expect(manifest.runId).toBe(config.runId);
  expect(manifest.lock).toBe(config.lock);
  expect(manifest.candidate?.buildId).toBe(config.expectedBuildId);
  expect(manifest.candidate?.backendJarSha256?.toUpperCase()).toBe(config.expectedJarSha256);
  return manifest;
}

function actor(manifest: Manifest, key: "publisher" | "maker"): Credentials {
  const value = manifest[key] ?? manifest.accounts?.[key];
  if (!value?.username || !value.password || !value.totpSecret) throw new Error(`K4_FINAL11_${key.toUpperCase()}_MFA_REQUIRED`);
  return value;
}

async function loginWithNormalMfa(page: Page, credentials: Credentials) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(credentials.username);
  await page.locator('input[autocomplete="current-password"]').fill(credentials.password);
  const loginPending = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await loginPending).status()).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 20_000 });
  const verifyPending = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
  await otp.fill(await freshTotp(credentials.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  expect((await verifyPending).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function assertAuthority(page: Page, authority: string) {
  const session = await ok<{ session?: { authorities?: string[] } }>(await page.request.get("/api/admin/auth/session"));
  expect(session.session?.authorities ?? []).toContain(authority);
}

async function openK4FromVisibleSidebar(page: Page) {
  const link = page.locator('aside a[href="/risk/scoring"]').first();
  if (!await link.isVisible().catch(() => false)) {
    const group = page.locator('button[aria-controls="nav-group-K"]');
    await expect(group).toBeVisible();
    if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/risk\/scoring/);
  await expect(page.locator("section.l-card").filter({ hasText: "K4 评分模型" }).first()).toBeVisible();
}

async function scoreUser(page: Page, userNo: string) {
  return ok<ScoreUser>(await page.request.get(`/api/admin/risk/scoring/users/${encodeURIComponent(userNo)}`));
}

async function ok<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.status(), text).toBeLessThan(400);
  const body = JSON.parse(text) as Envelope<T>;
  expect(body.code ?? 0, text).toBe(0);
  return body.data as T;
}

async function safeResponse(response: APIResponse) {
  const text = await response.text();
  const body = JSON.parse(text) as Envelope<unknown>;
  return { status: response.status(), code: body.code ?? 0, message: body.message ?? "" };
}

function safeUser(user: ScoreUser) {
  return {
    userNoSha256: sha(user.userNo), modelScore: user.modelScore, effectiveScore: user.effectiveScore,
    overridden: user.overridden, modelVersion: user.modelVersion, rowVersion: user.rowVersion,
  };
}

function captureBrowserFaults(page: Page, faults: BrowserFaultCapture) {
  page.on("pageerror", (error) => faults.immediate.push(`pageerror:${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") faults.immediate.push(`console:${message.text()}`); });
  page.on("response", (response) => {
    if (response.status() === 200) faults.successfulNavigationPaths.add(new URL(response.url()).pathname);
  });
  page.on("requestfailed", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.failure()?.errorText === "net::ERR_ABORTED") {
      faults.cancelledNavigationPaths.push(pathname);
      return;
    }
    faults.immediate.push(`requestfailed:${pathname}:${request.failure()?.errorText ?? "unknown"}`);
  });
}

function unexpectedBrowserFaults(faults: BrowserFaultCapture) {
  return [
    ...faults.immediate,
    ...faults.cancelledNavigationPaths
      .filter((pathname) => !faults.successfulNavigationPaths.has(pathname))
      .map((pathname) => `requestfailed:${pathname}:net::ERR_ABORTED-without-replacement-200`),
  ];
}

function mysql(config: Config, statement: string) {
  return execFileSync(config.mysql, ["-uroot", "-D", config.dbName, "-N", "-B", "-e", statement], {
    encoding: "utf8", windowsHide: true, env: { ...process.env, MYSQL_PWD: config.dbPassword },
  }).trim();
}

function latestDeadlock(status: string) {
  const normalized = status.replaceAll("\\n", "\n");
  const marker = "LATEST DETECTED DEADLOCK";
  const start = normalized.lastIndexOf(marker);
  if (start < 0) return "";
  const end = normalized.indexOf("------------\nTRANSACTIONS", start);
  return normalized.slice(start, end < 0 ? undefined : end);
}

function sha(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex").toUpperCase();
}

function sql(value: string) {
  return value.replaceAll("'", "''");
}

async function freshTotp(secret: string) {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 4_000) await new Promise((resolve) => setTimeout(resolve, remaining + 500));
  return totp(secret);
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const item of secret.replace(/[^A-Z2-7]/gi, "").toUpperCase()) bits += alphabet.indexOf(item).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
