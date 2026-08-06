import { expect, test, type Page } from "@playwright/test";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const RUN_ID = requiredEnv("K3_FINAL7_RUN_ID");
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const BACKEND_URL = process.env.K3_BACKEND_URL ?? "http://127.0.0.1:8110";
const EXPECTED_BUILD_ID = requiredEnv("K3_FINAL7_EXPECTED_BUILD_ID");
const EXPECTED_JAR_SHA256 = requiredEnv("K3_FINAL7_EXPECTED_JAR_SHA256").toUpperCase();
const GLOBAL_LOCK_TOKEN = requiredEnv("K3_FINAL7_GLOBAL_LOCK_TOKEN");
const WRITE_TOKEN = requiredEnv("K3_FINAL7_WRITE_TOKEN");
const MFA_BYPASS = requiredEnv("K3_FINAL7_MFA_BYPASS");
const MANIFEST_PATH = requiredEnv("K3_FINAL7_RESTRICTED_MANIFEST");
const BACKEND_JAR_PATH = requiredEnv("K3_FINAL7_BACKEND_JAR_PATH");
const BUILD_ID_PATH = process.env.K3_FINAL7_BUILD_ID_PATH ?? ".next/BUILD_ID";
const EVIDENCE_DIR = requiredEnv("K3_FINAL7_EVIDENCE_DIR");
const CHILD_EVIDENCE_DIR = path.join(EVIDENCE_DIR, "k3-live");
const CHILD_OUTPUT_DIR = path.join(EVIDENCE_DIR, "playwright-k3-live");
const DB_NAME = requiredEnv("K3_DB_NAME");
const DB_PASSWORD = requiredEnv("K3_DB_PASSWORD");
const MYSQL = process.env.K3_MYSQL ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const expectedLockToken = `GLOBAL_J1+B1:${RUN_ID}:${EXPECTED_BUILD_ID}:${EXPECTED_JAR_SHA256}`;
const expectedWriteToken = `K3_WRITE:${RUN_ID}:${EXPECTED_BUILD_ID}:${EXPECTED_JAR_SHA256}`;
const VOUCHER = `CHAIN:K3F7-${RUN_ID.replace(/[^A-Za-z0-9_-]/g, "-").slice(-40)}-${randomUUID().slice(0, 8)}`;
const STARTED_AT = new Date().toISOString();

type Account = { username: string; password: string; totpSecret: string };
type RestrictedManifest = {
  runId?: string;
  globalLockToken?: string;
  writeToken?: string;
  candidate?: { pcBuildId?: string; backendJarSha256?: string };
  accounts: { j1B1Operator: Account };
};
type SettingRow = {
  id: number;
  settingKey: string;
  settingValue: string;
  valueType: string;
  groupCode: string;
  remark: string | null;
  operator: string | null;
  createdAt: string;
  updatedAt: string;
  isDeleted: number;
};
type Coverage = { reserveUsd: number; liabilitiesUsd: number; coverageRatio: number; redlinePct: number };
type Gate = { key: string; name: string; enabled: boolean; emergency: boolean };
type Envelope<T> = { code?: number; message?: string; data: T };

const restrictedManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as RestrictedManifest;
if (restrictedManifest.runId !== RUN_ID) throw new Error("K3_FINAL7_MANIFEST_RUN_MISMATCH");
if (restrictedManifest.globalLockToken !== GLOBAL_LOCK_TOKEN
    || restrictedManifest.writeToken !== WRITE_TOKEN) {
  throw new Error("K3_FINAL7_MANIFEST_LOCK_TOKEN_MISMATCH");
}
if (restrictedManifest.candidate?.pcBuildId !== EXPECTED_BUILD_ID
    || restrictedManifest.candidate?.backendJarSha256?.toUpperCase() !== EXPECTED_JAR_SHA256) {
  throw new Error("K3_FINAL7_MANIFEST_CANDIDATE_MISMATCH");
}
const operator = restrictedManifest.accounts?.j1B1Operator;
if (!operator?.username || !operator.password || !operator.totpSecret) {
  throw new Error("K3_FINAL7_RESTRICTED_MANIFEST_MISSING_J1_B1_OPERATOR");
}

let j1Before: SettingRow[] = [];
let coverageBefore: Coverage | null = null;
let reserveLedgerBaseline = "";
let reserveLedgerId = 0;
let idempotencyBaseline = 0;
let auditBaseline = 0;
let outboxBaseline = 0;
let withdrawalEnabledByRun = false;
const runCommandKeys = new Set<string>();
const evidence: Record<string, unknown> = {
  runId: RUN_ID,
  candidate: { pcBuildId: EXPECTED_BUILD_ID, backendJarSha256: EXPECTED_JAR_SHA256 },
  startedAt: STARTED_AT,
  mfaBypass: false,
  globalLock: "GLOBAL_J1+B1",
};

test.describe.configure({ mode: "serial", timeout: 1_200_000 });
test.use({ trace: "on", video: "on" });

test.beforeAll(() => {
  assertStaticExecutionGate();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  mkdirSync(CHILD_EVIDENCE_DIR, { recursive: true });
  mkdirSync(CHILD_OUTPUT_DIR, { recursive: true });
  j1Before = readWithdrawRows();
  expect(j1Before.some((row) => row.settingKey === "killswitch.withdraw")).toBe(true);
  reserveLedgerBaseline = reserveLedgerFingerprint();
  idempotencyBaseline = Number(mysql("SELECT COALESCE(MAX(id),0) FROM nx_admin_idempotency_record;"));
  auditBaseline = Number(mysql("SELECT COALESCE(MAX(id),0) FROM nx_audit_log;"));
  outboxBaseline = Number(mysql("SELECT COALESCE(MAX(id),0) FROM nx_event_outbox;"));
});

test.afterAll(async ({ browser }) => {
  const cleanupErrors: string[] = [];
  if (withdrawalEnabledByRun) {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    try {
      await loginWithMfa(page, operator);
      await openJ1FromVisibleSidebar(page);
      const gate = await currentGate(page, "withdraw");
      if (gate.enabled) await killWithdrawThroughVisibleUi(page, gate.name, "Final7 K3 RED/PASS 清理，恢复提现关停基线");
      withdrawalEnabledByRun = false;
    } catch (error) {
      cleanupErrors.push(`VISIBLE_J1_DISABLE_FAILED:${messageOf(error)}`);
    } finally {
      await context.close();
    }
  }

  try {
    restoreJ1Snapshot(j1Before);
  } catch (error) {
    cleanupErrors.push(`J1_SNAPSHOT_RESTORE_FAILED:${messageOf(error)}`);
  }
  try {
    const ownedReserveIds = mysql(`
      SELECT id FROM nx_treasury_reserve_ledger
       WHERE voucher_no=${sqlValue(VOUCHER)}
         AND direction='IN'
         AND reason='Final7 K3 锁内临时覆盖夹具，终验后按唯一凭证精确恢复'
         AND is_deleted=0
       ORDER BY id;
    `).split(/\r?\n/).filter(Boolean).map(Number);
    expect(ownedReserveIds.length).toBeLessThanOrEqual(1);
    if (ownedReserveIds.length === 1) {
      reserveLedgerId = ownedReserveIds[0];
      mysql(`
        DELETE FROM nx_treasury_reserve_ledger
         WHERE voucher_no=${sqlValue(VOUCHER)}
           AND direction='IN'
           AND reason='Final7 K3 锁内临时覆盖夹具，终验后按唯一凭证精确恢复'
           AND is_deleted=0;
      `);
    }
    expect(Number(mysql(`
      SELECT COUNT(*) FROM nx_treasury_reserve_ledger
       WHERE voucher_no=${sqlValue(VOUCHER)};
    `))).toBe(0);
  } catch (error) {
    cleanupErrors.push(`B1_RESERVE_FIXTURE_CLEANUP_FAILED:${messageOf(error)}`);
  }
  try {
    if (runCommandKeys.size > 0) {
      mysql(`
        DELETE FROM nx_admin_idempotency_record
         WHERE id>${idempotencyBaseline}
           AND idempotency_key IN (${[...runCommandKeys].map(sqlValue).join(",")});
      `);
    }
    const residual = Number(mysql(`
      SELECT COUNT(*) FROM nx_admin_idempotency_record
       WHERE id>${idempotencyBaseline}
         AND idempotency_key IN (${[...runCommandKeys].length > 0 ? [...runCommandKeys].map(sqlValue).join(",") : "''"});
    `));
    expect(residual).toBe(0);
  } catch (error) {
    cleanupErrors.push(`IDEMPOTENCY_CLEANUP_FAILED:${messageOf(error)}`);
  }
  try {
    assertRestoredJ1Rows(j1Before);
    expect(reserveLedgerFingerprint()).toBe(reserveLedgerBaseline);
  } catch (error) {
    cleanupErrors.push(`FINAL_RESTORE_ASSERTION_FAILED:${messageOf(error)}`);
  }

  evidence.finishedAt = new Date().toISOString();
  evidence.cleanup = {
    passed: cleanupErrors.length === 0,
    mutableReserveRows: reserveLedgerId > 0 ? 0 : "not-created",
    j1SnapshotRestored: cleanupErrors.every((entry) => !entry.includes("J1_")),
    idempotencyResidual: 0,
    immutableAuditOutboxRetained: true,
    errors: cleanupErrors,
  };
  writeFileSync(
    path.join(EVIDENCE_DIR, "k3-final7-ui-gate-summary.json"),
    `${JSON.stringify(redactSensitive(evidence), null, 2)}\n`,
    "utf8",
  );
  if (cleanupErrors.length > 0) throw new Error(cleanupErrors.join(" | "));
});

test("Final7 K3 uses visible B1 and J1 controls under the exclusive lock, then runs the complete K3 carrier", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await loginWithMfa(page, operator);
  await assertOperatorSession(page);

  await openB1FromVisibleSidebar(page);
  coverageBefore = await readCoverage(page);
  expect(coverageBefore.liabilitiesUsd).toBeGreaterThan(0);
  expect(coverageBefore.coverageRatio).toBeLessThan(coverageBefore.redlinePct);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-b1-visible-redline-baseline.png"), fullPage: true });

  await openJ1FromVisibleSidebar(page);
  const initialGate = await currentGate(page, "withdraw");
  expect(initialGate.enabled, "Final7 K3 requires the locked withdraw baseline to start disabled").toBe(false);
  const blockedControl = gateRow(page, initialGate.name)
    .getByRole("button", { name: "恢复受阻", exact: true });
  await expect(blockedControl).toBeVisible();
  await expect(blockedControl).toBeDisabled();
  await expect(blockedControl).toHaveAttribute("title", /备付金|覆盖率|红线/);
  const blockedKey = `k3-final7-redline-${randomUUID()}`;
  runCommandKeys.add(blockedKey);
  const blockedResponse = await page.request.put("/api/admin/emergency/kill-switches/withdraw", {
    headers: { "Idempotency-Key": blockedKey },
    data: {
      enabled: "enabled",
      reason: "Final7 K3 先证明红线下恢复必须失败关闭",
      operator: "ignored",
    },
  });
  expect(blockedResponse.status()).toBe(422);
  expect((await blockedResponse.json() as { message?: string }).message).toBe("COVERAGE_BELOW_REDLINE");
  expect((await currentGate(page, "withdraw")).enabled).toBe(false);
  evidence.redlineFailClosed = { uiBlocked: true, backendStatus: blockedResponse.status() };
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-j1-visible-coverage-blocked.png"), fullPage: true });

  await openB1FromVisibleSidebar(page);
  const fixtureAmount = Math.ceil(Math.max(
    1,
    coverageBefore.liabilitiesUsd * (coverageBefore.redlinePct + 5) / 100 - coverageBefore.reserveUsd,
  ) * 100) / 100;
  const injectionKeys: string[] = [];
  let injectionAttempt = 0;
  let injectionUpstreamStatus = 0;
  await page.route("**/api/admin/treasury/reserve-injection", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    injectionAttempt += 1;
    const key = await route.request().headerValue("idempotency-key") ?? "";
    injectionKeys.push(key);
    if (key) runCommandKeys.add(key);
    if (injectionAttempt === 1) {
      const upstream = await route.fetch();
      injectionUpstreamStatus = upstream.status();
      await route.fulfill({
        status: 503,
        headers: { "X-Nexion-Upstream-Outcome": "unknown" },
        contentType: "application/json",
        body: JSON.stringify({ code: 503, message: "TREASURY_BACKEND_UNAVAILABLE", data: null }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "登记储备注入" }).click();
  const injectionDialog = page.getByRole("dialog");
  await injectionDialog.getByLabel("注资金额 (USDT)").fill(fixtureAmount.toFixed(2));
  await injectionDialog.getByLabel("凭证类型").selectOption("CHAIN");
  await injectionDialog.getByLabel("凭证编号 / 哈希").fill(VOUCHER.replace(/^CHAIN:/, ""));
  await injectionDialog.getByLabel(/操作理由/).fill("Final7 K3 锁内临时覆盖夹具，终验后按唯一凭证精确恢复");
  await injectionDialog.getByRole("button", { name: "确认提交" }).click();
  await expect(injectionDialog.getByRole("alert")).toContainText(/结果暂未确认|提交未完成|结果未知/);
  expect(injectionUpstreamStatus).toBe(200);
  const created = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/treasury/reserve-injection");
  await injectionDialog.getByRole("button", { name: "确认提交" }).click();
  const createdResponse = await created;
  expect(createdResponse.status(), await createdResponse.text()).toBe(200);
  await expect(injectionDialog).toBeHidden();
  await page.unroute("**/api/admin/treasury/reserve-injection");
  expect(injectionKeys).toHaveLength(2);
  expect(injectionKeys[0]).toBeTruthy();
  expect(injectionKeys[1]).toBe(injectionKeys[0]);
  reserveLedgerId = Number(mysql(`
    SELECT id FROM nx_treasury_reserve_ledger
     WHERE voucher_no=${sqlValue(VOUCHER)} AND direction='IN' AND is_deleted=0;
  `));
  expect(reserveLedgerId).toBeGreaterThan(0);
  const coverageWithFixture = await readCoverage(page);
  expect(coverageWithFixture.coverageRatio).toBeGreaterThanOrEqual(coverageWithFixture.redlinePct);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-b1-ui-coverage-fixture-green.png"), fullPage: true });

  await openJ1FromVisibleSidebar(page);
  const withdrawGate = await currentGate(page, "withdraw");
  const resumeKeys: string[] = [];
  let resumeAttempt = 0;
  let resumeUpstreamStatus = 0;
  await page.route("**/api/admin/emergency/kill-switches/withdraw", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    resumeAttempt += 1;
    const key = await route.request().headerValue("idempotency-key") ?? "";
    resumeKeys.push(key);
    if (key) runCommandKeys.add(key);
    if (resumeAttempt === 1) {
      const upstream = await route.fetch();
      resumeUpstreamStatus = upstream.status();
      await route.fulfill({
        status: 503,
        headers: { "X-Nexion-Upstream-Outcome": "unknown" },
        contentType: "application/json",
        body: JSON.stringify({ code: 503, message: "EMERGENCY_BACKEND_UNAVAILABLE", data: null }),
      });
      return;
    }
    await route.continue();
  });
  await beginResumeWithdraw(page, withdrawGate.name, "Final7 K3 锁内临时恢复提现闸并执行整域验收");
  const resumeDialog = page.getByRole("dialog");
  await expect(resumeDialog.getByRole("alert")).toContainText(/结果暂未确认|提交未完成|结果未知/);
  expect(resumeUpstreamStatus).toBe(200);
  const resumed = page.waitForResponse((response) => isWithdrawMutation(response));
  await resumeDialog.getByRole("button", { name: "确认提交" }).click();
  const resumedResponse = await resumed;
  expect(resumedResponse.status(), await resumedResponse.text()).toBe(200);
  await expect(resumeDialog).toBeHidden();
  await page.unroute("**/api/admin/emergency/kill-switches/withdraw");
  expect(resumeKeys).toHaveLength(2);
  expect(resumeKeys[0]).toBeTruthy();
  expect(resumeKeys[1]).toBe(resumeKeys[0]);
  withdrawalEnabledByRun = true;
  expect((await currentGate(page, "withdraw")).enabled).toBe(true);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-j1-ui-withdraw-temporarily-enabled.png"), fullPage: true });

  const child = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "playwright", "test", "tests/e2e/k3-final-acceptance-20260722.spec.ts",
      "--workers=1", "--reporter=line", `--output=${CHILD_OUTPUT_DIR}`,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 900_000,
      shell: process.platform === "win32",
      env: {
        ...process.env,
        K3_EVIDENCE_DIR: CHILD_EVIDENCE_DIR,
        K3_ACCEPTANCE_RUN_ID: `${RUN_ID}-FINAL7`,
        K3_FINAL7_LOCK_TOKEN: GLOBAL_LOCK_TOKEN,
        K3_FINAL7_WRITE_TOKEN: WRITE_TOKEN,
        K3_FINAL7_EXPECTED_BUILD_ID: EXPECTED_BUILD_ID,
        K3_FINAL7_EXPECTED_JAR_SHA256: EXPECTED_JAR_SHA256,
      },
    },
  );
  writeFileSync(path.join(EVIDENCE_DIR, "k3-child-output.txt"), [
    `status=${child.status ?? ""}`,
    `signal=${child.signal ?? ""}`,
    child.stdout ?? "",
    child.stderr ?? "",
  ].join("\n"), "utf8");
  expect(child.error?.message ?? "", "K3 child carrier process must start cleanly").toBe("");
  expect(child.status, child.stderr || child.stdout || "K3 child failed").toBe(0);
  const childSummary = JSON.parse(readFileSync(path.join(CHILD_EVIDENCE_DIR, "run-summary.json"), "utf8")) as {
    assertions?: { resilience?: { outcomeUnknownStableKey?: boolean; casRejected?: boolean; archived409?: boolean } };
    cleanup?: string;
  };
  expect(childSummary.assertions?.resilience).toMatchObject({
    outcomeUnknownStableKey: true,
    casRejected: true,
    archived409: true,
  });
  expect(childSummary.cleanup).toMatch(/immutable audit\/outbox retained/);

  await openJ1FromVisibleSidebar(page);
  const enabledGate = await currentGate(page, "withdraw");
  const killed = await killWithdrawThroughVisibleUi(page, enabledGate.name, "Final7 K3 完成，立即恢复提现关停基线");
  const killKey = await killed.request().headerValue("idempotency-key") ?? "";
  if (killKey) runCommandKeys.add(killKey);
  withdrawalEnabledByRun = false;
  expect((await currentGate(page, "withdraw")).enabled).toBe(false);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "05-j1-ui-withdraw-restored-disabled.png"), fullPage: true });

  const businessEvidence = jsonRows(`
    SELECT JSON_OBJECT('kind','audit','id',id,'action',action,'resourceId',resource_id)
      FROM nx_audit_log
     WHERE id>${auditBaseline}
       AND (resource_id=${sqlValue(VOUCHER)} OR action LIKE 'K3_%' OR action LIKE 'J1_%')
    UNION ALL
    SELECT JSON_OBJECT('kind','outbox','id',id,'action',event_type,'resourceId',aggregate_id)
      FROM nx_event_outbox
     WHERE id>${outboxBaseline}
       AND (aggregate_id=${sqlValue(VOUCHER)} OR event_type LIKE '%withdraw%' OR event_type LIKE '%risk%');
  `);
  expect(businessEvidence.some((row) => row.kind === "audit" && row.action === "D3_TREASURY_RESERVE_INJECTION")).toBe(true);
  expect(businessEvidence.some((row) => row.kind === "outbox" && row.action === "admin.treasury_reserve_injected")).toBe(true);
  evidence.outcomeUnknown = {
    upstreamCommitted: injectionUpstreamStatus === 200 && resumeUpstreamStatus === 200,
    b1SameIdempotencyKey: sha256(injectionKeys[0]) === sha256(injectionKeys[1]),
    j1SameIdempotencyKey: sha256(resumeKeys[0]) === sha256(resumeKeys[1]),
  };
  evidence.coverage = { before: coverageBefore, withFixture: coverageWithFixture };
  evidence.child = { status: child.status, assertions: childSummary.assertions, cleanup: childSummary.cleanup };
  evidence.dbA2A4Outbox = businessEvidence;
  expect(runtimeErrors).toEqual([]);
});

function assertStaticExecutionGate() {
  expect(MFA_BYPASS, "MFA_BYPASS_MUST_BE_FALSE").toBe("false");
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BACKEND_URL).hostname);
  expect(readFileSync(BUILD_ID_PATH, "utf8").trim()).toBe(EXPECTED_BUILD_ID);
  expect(sha256File(BACKEND_JAR_PATH)).toBe(EXPECTED_JAR_SHA256);
  expect(GLOBAL_LOCK_TOKEN).toBe(expectedLockToken);
  expect(WRITE_TOKEN).toBe(expectedWriteToken);
  expect(path.resolve(MANIFEST_PATH).toLowerCase()).toContain(`${path.sep}.restricted${path.sep}`);
  expect(path.resolve(MANIFEST_PATH)).toContain(RUN_ID);
  expect(path.resolve(EVIDENCE_DIR).toLowerCase()).toContain(`${path.sep}.restricted${path.sep}`);
  expect(path.resolve(EVIDENCE_DIR)).toContain(RUN_ID);
}

async function loginWithMfa(page: Page, account: Account) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const login = await loginResponse;
  expect(login.status(), await login.text()).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 15_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  const verify = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  const verified = await verify;
  const payload = await verified.json().catch(() => null) as { code?: number; message?: string } | null;
  if (verified.status() !== 200 || payload?.code !== 0) {
    throw new Error(`K3_FINAL7_MFA_FAILED:${verified.status()}:${payload?.message ?? "unknown"}`);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function assertOperatorSession(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as Envelope<{ session?: { authorities?: string[]; effectiveMenus?: unknown[] } }>;
  const authorities = payload.data.session?.authorities ?? [];
  for (const required of ["overview_b1_read", "finance_d3_injection_create", "emergency_j1_read", "emergency_j1_gate_resume", "emergency_j1_gate_kill"]) {
    expect(authorities, `operator missing ${required}`).toContain(required);
  }
}

async function openB1FromVisibleSidebar(page: Page) {
  const link = page.locator('aside a[href="/overview/dual-ledger"]').first();
  if (!await link.isVisible().catch(() => false)) {
    const group = page.getByRole("button", { name: /总览驾驶舱.*B|B.*总览驾驶舱/ }).first();
    await expect(group).toBeVisible();
    await group.click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/overview\/dual-ledger/);
  await expect(page.getByRole("heading", { name: "双账本总览", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function openJ1FromVisibleSidebar(page: Page) {
  const link = page.locator('aside a[href="/emergency/kill-switch"]').first();
  if (!await link.isVisible().catch(() => false)) {
    const group = page.getByRole("button", { name: /紧急与合规控制.*J|J.*紧急与合规控制/ }).first();
    await expect(group).toBeVisible();
    await group.click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/emergency\/kill-switch/);
  await expect(page.getByText("功能开关总表 · 5 个业务闸", { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function beginResumeWithdraw(page: Page, gateName: string, reason: string) {
  await gateRow(page, gateName).getByRole("button", { name: "恢复", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/操作理由/).fill(reason);
  await dialog.getByRole("button", { name: "确认提交" }).click();
}

async function killWithdrawThroughVisibleUi(page: Page, gateName: string, reason: string) {
  const response = page.waitForResponse((candidate) => isWithdrawMutation(candidate));
  await gateRow(page, gateName).getByRole("button", { name: "关停", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const basis = dialog.locator("label").filter({ hasText: "触发依据" }).locator("select");
  await basis.selectOption({ label: "安全事件" });
  await dialog.getByLabel(/操作理由/).fill(reason);
  await dialog.getByRole("button", { name: "确认提交" }).click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(200);
  await expect(dialog).toBeHidden();
  return result;
}

function gateRow(page: Page, name: string) {
  return page.locator(".matrix-tbl .rw").filter({ hasText: name }).first();
}

async function currentGate(page: Page, key: string): Promise<Gate> {
  const response = await page.request.get("/api/admin/emergency/kill-switches");
  expect(response.status(), await response.text()).toBe(200);
  const payload = await response.json() as Envelope<{ activeGates: Gate[] }>;
  const gate = payload.data.activeGates.find((candidate) => candidate.key === key);
  if (!gate) throw new Error(`J1_GATE_MISSING:${key}`);
  return gate;
}

function isWithdrawMutation(response: { request(): { method(): string }; url(): string }) {
  return response.request().method() === "PUT"
    && new URL(response.url()).pathname === "/api/admin/emergency/kill-switches/withdraw";
}

async function readCoverage(page: Page): Promise<Coverage> {
  const response = await page.request.get("/api/admin/treasury/dual-ledger");
  expect(response.status(), await response.text()).toBe(200);
  const payload = await response.json() as Envelope<{ snapshot: Coverage }>;
  return payload.data.snapshot;
}

function reserveLedgerFingerprint() {
  return mysql(`
    SET SESSION group_concat_max_len=10485760;
    SELECT SHA2(COALESCE(GROUP_CONCAT(
      CONCAT_WS(CHAR(31),
        id,reserve_no,voucher_no,direction,amount_usd,
        COALESCE(reason,''),COALESCE(operator,''),COALESCE(idempotency_key,''),status,
        DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f'),
        DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f'),is_deleted
      )
      ORDER BY id SEPARATOR 0x1E
    ),''),256)
      FROM nx_treasury_reserve_ledger;
  `);
}

function readWithdrawRows(): SettingRow[] {
  return jsonRows(`
    SELECT JSON_OBJECT(
      'id',id,'settingKey',setting_key,'settingValue',setting_value,'valueType',value_type,
      'groupCode',group_code,'remark',remark,'operator',operator,
      'createdAt',DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f'),
      'updatedAt',DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f'),'isDeleted',is_deleted)
      FROM nx_emergency_control_setting
     WHERE setting_key='killswitch.withdraw' OR setting_key LIKE 'emergency.killswitch.withdraw.%'
     ORDER BY setting_key;
  `) as SettingRow[];
}

function restoreJ1Snapshot(before: SettingRow[]) {
  mysql(`
    START TRANSACTION;
    ${before.map((row) => `
      UPDATE nx_emergency_control_setting
         SET setting_value=${sqlValue(row.settingValue)},value_type=${sqlValue(row.valueType)},
             group_code=${sqlValue(row.groupCode)},remark=${sqlValue(row.remark)},operator=${sqlValue(row.operator)},
             created_at=${sqlValue(row.createdAt)},updated_at=${sqlValue(row.updatedAt)},is_deleted=${row.isDeleted}
       WHERE id=${row.id} AND setting_key=${sqlValue(row.settingKey)};
    `).join("\n")}
    COMMIT;
  `);
}

function assertRestoredJ1Rows(before: SettingRow[]) {
  const after = readWithdrawRows();
  expect(after).toEqual(before);
}

function jsonRows(sql: string): Array<Record<string, unknown>> {
  return mysql(sql).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function mysql(sql: string) {
  return execFileSync(MYSQL, ["--default-character-set=utf8mb4", "-uroot", "-D", DB_NAME, "-N", "-B", "-e", sql], {
    encoding: "utf8",
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
  }).trim();
}

function sqlValue(value: unknown) {
  if (value == null) return "NULL";
  return `CONVERT(0x${Buffer.from(String(value), "utf8").toString("hex")} USING utf8mb4)`;
}

async function freshTotp(secret: string) {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 4_000) await new Promise((resolve) => setTimeout(resolve, remaining + 500));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/[^A-Z2-7]/gi, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("INVALID_TOTP_SECRET");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/status of (?:401|403|409|422|502|503)/i.test(message.text())) {
      errors.push(`console:${message.text()}`);
    }
  });
  return errors;
}

function sha256File(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    /password|secret|token|authorization|cookie|manualKey|totp/i.test(key) ? "[REDACTED]" : redactSensitive(entry),
  ]));
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
