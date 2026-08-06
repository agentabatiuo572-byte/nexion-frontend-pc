import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Actor = { username: string; password: string; totpSecret: string };
type Fixture = { accounts?: { maker?: Actor; a2Approver?: Actor } };
type Envelope<T> = { code?: number; message?: string; data?: T };
type Ticket = { id?: string; operationId?: string; status?: string };
type I3Overview = { capRules?: Array<{ tier: string; cap: string; locked?: boolean }> };

const FIXTURE_PATH = process.env.ADMIN_PERMISSION_FIXTURE;
const fixture = FIXTURE_PATH && existsSync(FIXTURE_PATH)
  ? JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture
  : {};
const makerAccount = fixture.accounts?.maker;
const approverAccount = fixture.accounts?.a2Approver;

const DB_NAME = process.env.NEXION_ACCEPTANCE_DB || "nexion_acceptance_20260729_114336";
const DB_PASSWORD = process.env.NEXION_ACCEPTANCE_DB_PASSWORD || "";
const MYSQL = process.env.NEXION_MYSQL_EXE || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const APP_ROOT = process.env.NEXION_APP_ROOT || "D:/workspace/NX1.0";
const NOTIFICATION_API = path.join(APP_ROOT, "src", "api", "notification-api.ts");
const RUN_TOKEN = process.env.I3_FINAL10_RUN_TOKEN || "";
const EVIDENCE_ROOT = process.env.I3_FINAL9_EVIDENCE_ROOT
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/I/final9-owner/i3-a2";
const runSuffix = Date.now().toString(36);
const pending = new Set<string>();
const operationIds: string[] = [];

test.describe.configure({ mode: "serial", timeout: 240_000 });

function parseCanonicalCapCount(value: string) {
  const match = /^(?:([1-9]\d{0,3})|10000)(?: 条)?$/.exec(value);
  if (!match) throw new Error("I3_CAP_LABEL_INVALID");
  const count = Number(value.replace(" 条", ""));
  if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) {
    throw new Error("I3_CAP_LABEL_INVALID");
  }
  return String(count);
}

function expectCanonicalCapEqual(actual: string, expected: string) {
  expect(parseCanonicalCapCount(actual)).toBe(parseCanonicalCapCount(expected));
}

test("I3 CAP 权威标签只接受规范安全整数和可选“ 条”后缀", () => {
  expect(parseCanonicalCapCount("51")).toBe("51");
  expect(parseCanonicalCapCount("51 条")).toBe("51");
  expect(parseCanonicalCapCount("1")).toBe("1");
  expect(parseCanonicalCapCount("10000 条")).toBe("10000");
  for (const malformed of ["", " 51", "51 ", "51条", "051", "0", "-1", "1.5", "NaN", "10001", "51 条x"]) {
    expect(() => parseCanonicalCapCount(malformed)).toThrow("I3_CAP_LABEL_INVALID");
  }
});

test("I3 overview 与 DB 的 CAP 比较统一按 canonical count 断言", () => {
  expectCanonicalCapEqual("51 条", "51");
  expectCanonicalCapEqual("51", "51 条");
  expect(() => expectCanonicalCapEqual("51 条x", "51")).toThrow("I3_CAP_LABEL_INVALID");
});

test("I3 maker 从可见侧栏提案、独立 A2 审批、权限拒绝并精确恢复 CAP", async ({ browser }) => {
  test.skip(!RUN_TOKEN, "Final10 I3 fixture/token not issued; collection and --list must remain side-effect free.");
  if (!FIXTURE_PATH || !makerAccount || !approverAccount || !DB_PASSWORD) {
    throw new Error("I3_FINAL10_RUNTIME_FIXTURE_REQUIRED");
  }
  expect(existsSync(NOTIFICATION_API), `NEXION_APP_ROOT must contain real notification API: ${NOTIFICATION_API}`).toBeTruthy();
  const makerContext = await browser.newContext();
  const approverContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const approver = await approverContext.newPage();
  const evidence: Record<string, unknown> = {
    runId: "pc-full-acceptance-20260729-114336",
    candidate: { pcBuild: "WF2Bg3fIWMQRSwSJCTh5E", backendJarSha256Prefix: "AD3EE7ED47E0" },
    actors: { maker: safeHash(makerAccount.username), a2Approver: safeHash(approverAccount.username), independent: true },
  };
  let tier = "";
  let originalCap = "";
  let originalNumeric = "";
  let primaryError: unknown;
  try {
    await login(maker, makerAccount);
    await login(approver, approverAccount);
    await openI3(maker);
    const before = await overview(maker);
    const rule = (before.capRules ?? []).find((row) => !row.locked && /\d+/.test(row.cap));
    expect(rule, "I3 must expose an unlocked numeric CAP for isolated restore").toBeTruthy();
    tier = rule!.tier;
    originalCap = rule!.cap;
    originalNumeric = parseCanonicalCapCount(originalCap);
    expect(originalNumeric).not.toBe("");
    expect(parseCanonicalCapCount(mysqlScalar(`SELECT cap_label FROM nx_notification_cap_rule WHERE tier='${sql(tier)}' AND is_deleted=0;`))).toBe(originalNumeric);
    const targetCap = String(Number(originalNumeric) + 1);

    const changeId = await proposeFromVisibleI3(maker, originalCap, targetCap, `Final9 I3 CAP 隔离调整 ${runSuffix}`);
    pending.add(changeId);
    operationIds.push(changeId);
    await maker.screenshot({ path: evidencePath("01-maker-pending.png"), fullPage: true });

    const selfApprove = await maker.request.post(`/api/admin/platform/audit/operations/${encodeURIComponent(changeId)}/approve`, {
      headers: { "Idempotency-Key": `i3-final9-self-${runSuffix}` },
      data: { reason: `Final9 I3 maker 不得自批 ${runSuffix}` },
    });
    expect(selfApprove.status()).toBe(403);
    evidence.selfApprove = { http: selfApprove.status(), denied: true };

    await approveThroughVisibleA2(approver, changeId, `Final9 I3 独立审批调整 ${runSuffix}`);
    pending.delete(changeId);
    expectCanonicalCapEqual((await overview(maker)).capRules?.find((row) => row.tier === tier)?.cap ?? "", targetCap);
    expectCanonicalCapEqual(mysqlScalar(`SELECT cap_label FROM nx_notification_cap_rule WHERE tier='${sql(tier)}' AND is_deleted=0;`), targetCap);

    await maker.reload({ waitUntil: "domcontentloaded" });
    const restoreId = await proposeFromVisibleI3(maker, targetCap, originalNumeric, `Final9 I3 CAP 可见值恢复 ${runSuffix}`);
    pending.add(restoreId);
    operationIds.push(restoreId);
    await approveThroughVisibleA2(approver, restoreId, `Final9 I3 独立审批恢复 ${runSuffix}`);
    pending.delete(restoreId);
    await maker.reload({ waitUntil: "domcontentloaded" });
    expectCanonicalCapEqual((await overview(maker)).capRules?.find((row) => row.tier === tier)?.cap ?? "", originalNumeric);
    expectCanonicalCapEqual(mysqlScalar(`SELECT cap_label FROM nx_notification_cap_rule WHERE tier='${sql(tier)}' AND is_deleted=0;`), originalNumeric);
    await maker.screenshot({ path: evidencePath("02-restored-visible.png"), fullPage: true });

    const db = databaseEvidence(operationIds, tier);
    expect(db.pendingTickets).toBe(0);
    expect(db.activeLocks).toBe(0);
    expect(db.auditRows).toBeGreaterThanOrEqual(operationIds.length);
    evidence.lifecycle = { tier, originalCap, changedCap: targetCap, visibleRestoredCap: originalNumeric, operationCount: operationIds.length };
    evidence.database = db;
  } catch (error) {
    primaryError = error;
    evidence.primaryError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    let cleanupError: unknown;
    try {
      evidence.cleanup = await cleanupFinally(maker, approver, pending, tier, originalCap);
    } catch (error) {
      cleanupError = error;
      evidence.cleanup = { failed: true, message: error instanceof Error ? error.message : String(error) };
    }
    evidence.finishedAt = new Date().toISOString();
    mkdirSync(EVIDENCE_ROOT, { recursive: true });
    writeFileSync(path.join(EVIDENCE_ROOT, "i3-a2-safe.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await Promise.allSettled([makerContext.close(), approverContext.close()]);
    if (cleanupError && !primaryError) throw cleanupError;
    if (cleanupError && primaryError) throw new AggregateError([primaryError, cleanupError], "I3 lifecycle and cleanup both failed");
  }
});

async function proposeFromVisibleI3(page: Page, currentCap: string, targetCap: string, reason: string) {
  const row = page.locator(".p-row").filter({ hasText: currentCap }).filter({ has: page.getByRole("button", { name: "调整", exact: true }) }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "调整", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await dialog.getByLabel("目标新值").fill(targetCap);
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/platform/audit/operations");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const body = await success<Ticket>(await responsePromise, "I3 proposal");
  await expect(dialog).toHaveCount(0);
  const id = String(body.id ?? body.operationId ?? "");
  expect(id).toMatch(/^(?:WO|OP)-/);
  return id;
}

async function approveThroughVisibleA2(page: Page, operationId: string, reason: string) {
  const group = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
  const link = page.locator('a[href="/platform/audit"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operationId })
    .filter({ has: page.getByRole("button", { name: "执行", exact: true }) }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/operations/${operationId}/approve`));
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await success(await responsePromise, `approve ${operationId}`);
}

async function openI3(page: Page) {
  const group = page.getByRole("button", { name: /内容与合规 CMS\s+I|I\s+内容与合规 CMS/ }).first();
  const link = page.locator('a[href="/content/notifications"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/content\/notifications(?:\?.*)?$/);
  await expect(page.getByText("本月 campaign", { exact: true })).toBeVisible();
}

async function overview(page: Page) {
  const response = await page.request.get("/api/admin/content/campaigns/overview");
  return success<I3Overview>(response, "I3 overview");
}

async function success<T>(response: APIResponse | Response, label: string): Promise<T> {
  const body = await response.json() as Envelope<T>;
  expect(response.status(), `${label}: ${JSON.stringify(body)}`).toBe(200);
  expect(body.code, `${label}: ${JSON.stringify(body)}`).toBe(0);
  return body.data as T;
}

async function login(page: Page, account: Actor) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  const password = page.locator('input[autocomplete="current-password"]');
  // Preserve human input ordering; the controlled login form can otherwise
  // coalesce two same-tick synthetic fills and retain only the password.
  await username.fill(account.username);
  await page.waitForTimeout(120);
  await password.fill(account.password);
  await page.waitForTimeout(120);
  if (await username.inputValue() !== account.username) {
    await username.fill(account.username);
    await page.waitForTimeout(120);
  }
  await expect(username).toHaveValue(account.username);
  await expect(password).toHaveValue(account.password);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const otp = page.getByLabel("一次性验证码");
  const shell = page.locator("aside");
  await expect.poll(async () => await otp.isVisible().catch(() => false)
    || await shell.isVisible().catch(() => false), { timeout: 15_000 }).toBe(true);
  if (await shell.isVisible().catch(() => false)) return;
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

let lastTotpStep = -1;
async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const char of normalized) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function cleanupFinally(maker: Page, approver: Page, pendingIds: Set<string>, tier: string, originalCap: string) {
  try {
    for (const operationId of pendingIds) {
      const response = await approver.request.post(`/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/reject`, {
        headers: { "Idempotency-Key": `i3-final9-clean-${operationId}-${runSuffix}` },
        data: { reason: `Final9 I3 finally 精确拒绝未终态票据 ${runSuffix}` },
      });
      const body = await response.json() as Envelope<unknown>;
      if (body.code !== 0 && body.code !== 409) throw new Error(`I3 pending cleanup failed: ${body.code}/${body.message}`);
    }
    pendingIds.clear();
    const current = tier ? mysqlScalar(`SELECT cap_label FROM nx_notification_cap_rule WHERE tier='${sql(tier)}' AND is_deleted=0;`) : "";
    const originalCount = originalCap ? parseCanonicalCapCount(originalCap) : "";
    const currentCount = current ? parseCanonicalCapCount(current) : "";
    if (tier && originalCount && currentCount !== originalCount) {
      const proposal = await maker.request.post("/api/admin/platform/audit/operations", {
        headers: { "Idempotency-Key": `i3-final9-finally-restore-${runSuffix}` },
        data: {
          action: `调整 CAP · ${tier}`, obj: tier, beforeValue: current, afterValue: originalCap,
          type: "param", amplifies: false, roleGate: "门槛者", reason: `Final9 I3 finally 精确恢复 ${runSuffix}`,
          sourceDomain: "I3", command: { domain: "I", op: "i3_cap_adjust", params: { tier, cap: originalCap, expectedCap: current } },
          target: { domain: "I", type: "notification_cap", id: tier },
        },
      });
      const ticket = await success<Ticket>(proposal, "I3 finally restore proposal");
      const operationId = String(ticket.id ?? ticket.operationId ?? "");
      await success(await approver.request.post(`/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/approve`, {
        headers: { "Idempotency-Key": `i3-final9-finally-approve-${runSuffix}` },
        data: { reason: `Final9 I3 finally 审批恢复 ${runSuffix}` },
      }), "I3 finally restore approve");
    }
    const finalCap = tier ? mysqlScalar(`SELECT cap_label FROM nx_notification_cap_rule WHERE tier='${sql(tier)}' AND is_deleted=0;`) : "";
    const finalCount = finalCap ? parseCanonicalCapCount(finalCap) : "";
    if (tier && originalCount) expectCanonicalCapEqual(finalCap, originalCap);
    return { pendingTickets: tier ? mysqlNumber(`SELECT COUNT(*) FROM nx_audit_operation_ticket WHERE source_domain='I3' AND status='PENDING' AND is_deleted=0;`) : 0,
      activeLocks: tier ? mysqlNumber(`SELECT COUNT(*) FROM nx_audit_object_lock WHERE target_domain='I' AND target_type='notification_cap' AND target_id='${sql(tier)}' AND is_deleted=0;`) : 0,
      finalCap, restored: !tier || !originalCount || finalCount === originalCount };
  } finally {
    // The owning test closes both authenticated contexts after evidence is written.
  }
}

function databaseEvidence(ids: string[], tier: string) {
  const list = ids.map((id) => `'${sql(id)}'`).join(",") || "''";
  return {
    ticketStatuses: mysqlScalar(`SELECT GROUP_CONCAT(CONCAT(operation_id,':',status) ORDER BY operation_id) FROM nx_audit_operation_ticket WHERE operation_id IN (${list}) AND is_deleted=0;`),
    pendingTickets: mysqlNumber(`SELECT COUNT(*) FROM nx_audit_operation_ticket WHERE operation_id IN (${list}) AND status='PENDING' AND is_deleted=0;`),
    activeLocks: mysqlNumber(`SELECT COUNT(*) FROM nx_audit_object_lock WHERE ticket_id IN (${list}) AND is_deleted=0;`),
    auditRows: mysqlNumber(`SELECT COUNT(*) FROM nx_audit_log WHERE is_deleted=0 AND (${ids.map((id) => `CAST(detail_json AS CHAR) LIKE '%${sql(id)}%'`).join(" OR ") || "1=0"});`),
    finalCap: mysqlScalar(`SELECT cap_label FROM nx_notification_cap_rule WHERE tier='${sql(tier)}' AND is_deleted=0;`),
  };
}

function mysql(query: string) {
  return execFileSync(MYSQL, ["--host", "127.0.0.1", "--port", "3306", "--user", "root", `--password=${DB_PASSWORD}`, "--database", DB_NAME, "--default-character-set=utf8mb4", "--batch", "--skip-column-names", "--execute", query], { encoding: "utf8" }).trim();
}
function mysqlScalar(query: string) { return mysql(query); }
function mysqlNumber(query: string) { return Number(mysql(query) || 0); }
function sql(value: string) { return value.replaceAll("\\", "\\\\").replaceAll("'", "''"); }
function safeHash(value: string) { return createHmac("sha256", "i3-final9-safe-evidence").update(value).digest("hex").slice(0, 16); }
function evidencePath(name: string) { mkdirSync(EVIDENCE_ROOT, { recursive: true }); return path.join(EVIDENCE_ROOT, name); }
