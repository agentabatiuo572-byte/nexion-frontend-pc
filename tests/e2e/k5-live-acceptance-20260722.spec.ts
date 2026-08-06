import { expect, test, type Browser, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const EVIDENCE_DIR = process.env.K5_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/k-domain-acceptance-20260722/restricted/k5/live";
const OWNER_USERNAME = requiredEnv("K5_OWNER_USERNAME");
const OWNER_PASSWORD = requiredEnv("K5_OWNER_PASSWORD");
const OWNER_TOTP_SECRET = requiredEnv("K5_OWNER_TOTP_SECRET");
const RISK_USERNAME = requiredEnv("K5_RISK_USERNAME");
const RISK_PASSWORD = requiredEnv("K5_RISK_PASSWORD");
const RISK_TOTP_SECRET = requiredEnv("K5_RISK_TOTP_SECRET");
const READONLY_USERNAME = requiredEnv("K5_READONLY_USERNAME");
const READONLY_PASSWORD = requiredEnv("K5_READONLY_PASSWORD");
const READONLY_TOTP_SECRET = requiredEnv("K5_READONLY_TOTP_SECRET");
const C4_USERNAME = requiredEnv("K5_C4_USERNAME");
const C4_PASSWORD = requiredEnv("K5_C4_PASSWORD");
const C4_TOTP_SECRET = requiredEnv("K5_C4_TOTP_SECRET");
// "Root" here means a fresh browser context rooted at the login page. It is
// intentionally the independent C4-scoped verifier, never a SUPER account.
const ROOT_USERNAME = C4_USERNAME;
const TEMP_ACCOUNT_CLEANUP_USERNAME = process.env.K5_TEMP_ACCOUNT_CLEANUP_USERNAME ?? "";
const TEMP_ACCOUNT_CLEANUP_PASSWORD = process.env.K5_TEMP_ACCOUNT_CLEANUP_PASSWORD ?? "";
const TEMP_ACCOUNT_CLEANUP_TOTP_SECRET = process.env.K5_TEMP_ACCOUNT_CLEANUP_TOTP_SECRET ?? "";
const DB_PASSWORD = requiredEnv("K5_DB_PASSWORD");
const MYSQL = process.env.K5_MYSQL_EXE ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const DB_NAME = process.env.K5_DB_NAME ?? "nexion";
const REVIEW_USER_ID = Number(process.env.K5_REVIEW_USER_ID
  ?? 70_000_000 + Number(String(Date.now()).slice(-7)));
const REVIEW_USER_NO = process.env.K5_REVIEW_USER_NO ?? `U${String(REVIEW_USER_ID).padStart(8, "0")}`;
const REVIEW_PHONE = `167${String(Date.now()).slice(-8)}`;
const REVIEW_REFERRAL = `K5${String(Date.now())}`.slice(0, 32);
const RUN_ID = `K5ACC-${Date.now()}`;
const UNAVAILABLE_USER_NO = `U${String(80_000_000 + Number(String(Date.now()).slice(-7))).padStart(8, "0")}`;
const UNAVAILABLE_TICKET_ID = `KR-K5-${RUN_ID.slice(-12)}`;
const REASON = `${RUN_ID} 真实复审状态机及异常恢复验收`;
const K5_OVERVIEW = "/api/admin/risk/kyc-review/overview?ticketPageNum=1&ticketPageSize=50";
const K5_OVERVIEW_ROUTE = "**/api/admin/risk/kyc-review/overview**";

type Envelope<T> = { code: number; message?: string; data: T };
type K5Ticket = {
  id: string;
  type: string;
  user: string;
  st: string;
  version: number;
  kyc: string;
  info: Array<[string, string]>;
};
type K5Overview = {
  stats: Record<string, number>;
  tickets: { records: K5Ticket[]; total: number };
  alerts: Array<{ eventKey: string; title: string; body: string }>;
  subscription: { alertTypes: string[]; channels: string[]; version: number };
};
type TemporaryAccountState = {
  id: string;
  name: string;
  username: string;
  version: string;
  tfa: boolean;
  role: string;
  status: string;
  sessions: number;
};
type TemporaryAccountEvidence = {
  id: string;
  username: string;
  label: string;
  ownerRunId: string;
};

const mfaSecrets = new Map<string, string>();
mfaSecrets.set(OWNER_USERNAME, OWNER_TOTP_SECRET);
mfaSecrets.set(RISK_USERNAME, RISK_TOTP_SECRET);
mfaSecrets.set(READONLY_USERNAME, READONLY_TOTP_SECRET);
mfaSecrets.set(C4_USERNAME, C4_TOTP_SECRET);
if (TEMP_ACCOUNT_CLEANUP_USERNAME && TEMP_ACCOUNT_CLEANUP_TOTP_SECRET) {
  mfaSecrets.set(TEMP_ACCOUNT_CLEANUP_USERNAME, TEMP_ACCOUNT_CLEANUP_TOTP_SECRET);
}
// Only a same-process fallback creator may append evidence through
// registerTemporaryAccount. Arbitrary environment-provided account IDs are
// deliberately unsupported because cleanup is destructive.
const temporaryAccounts: TemporaryAccountEvidence[] = [];
const usedTotpSteps = new Map<string, number>();
const summary: Record<string, unknown> = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  checks: [],
};
let reviewTicketId = "";
let restoredTicketId = "";
let idempotencyBaseline = 0;
let riskAdminId = "";
let subscriptionSnapshot: string[] | null = null;
let ownsReviewFixture = false;

test.describe.configure({ mode: "serial", timeout: 360_000 });
test.use({ trace: "on", video: "on" });

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const snapshot = mysql(`
    SELECT HEX(alert_types_json),HEX(channels_json),version,
           DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s'),DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s')
      FROM nx_admin_risk_kyc_alert_subscription WHERE operator_name='${RISK_USERNAME}' LIMIT 1;
  `).trim();
  subscriptionSnapshot = snapshot ? snapshot.split("\t") : null;
  idempotencyBaseline = Number(mysql("SELECT COALESCE(MAX(id),0) FROM nx_admin_idempotency_record;").trim());
  riskAdminId = mysql(`
    SELECT id FROM nx_admin WHERE username='${RISK_USERNAME}' AND status=1 AND is_deleted=0 LIMIT 1;
  `).trim();
  if (!riskAdminId) throw new Error("K5 run-scoped risk actor is not active");
  const actorUsernames = Array.from(new Set([
    OWNER_USERNAME, RISK_USERNAME, READONLY_USERNAME, C4_USERNAME,
  ]));
  if (new Set([OWNER_USERNAME, READONLY_USERNAME, C4_USERNAME]).size !== 3) {
    throw new Error("K5 Owner, readonly and C4 viewer must be different run-scoped accounts");
  }
  const quotedActorUsernames = actorUsernames.map((username) => `'${username.replace(/'/g, "''")}'`).join(",");
  const nonSuperActors = Number(mysql(`
    SELECT COUNT(*) FROM nx_admin
     WHERE username IN (${quotedActorUsernames}) AND status=1 AND super_admin=0 AND is_deleted=0;
  `).trim());
  if (nonSuperActors !== actorUsernames.length) {
    throw new Error(`K5 actors must all be active non-SUPER accounts: expected=${actorUsernames.length}, actual=${nonSuperActors}`);
  }
  const collisions = mysql(`
    SELECT CONCAT(
      (SELECT COUNT(*) FROM nx_user
        WHERE id=${REVIEW_USER_ID} OR phone='${REVIEW_PHONE}' OR referral_code='${REVIEW_REFERRAL}'),',',
      (SELECT COUNT(*) FROM nx_kyc_profile
        WHERE user_id=${REVIEW_USER_ID} OR kyc_no='KYC-${RUN_ID}'),',',
      (SELECT COUNT(*) FROM nx_admin_risk_kyc_review_ticket
        WHERE ticket_id='${UNAVAILABLE_TICKET_ID}' OR user_no IN ('${REVIEW_USER_NO}','${UNAVAILABLE_USER_NO}'))
    );
  `).trim();
  if (collisions !== "0,0,0") throw new Error(`K5 fixture collision; no cleanup attempted: ${collisions}`);
  mysql(`
    START TRANSACTION;
    INSERT INTO nx_user(id,country_code,phone,password_hash,nickname,referral_code,kyc_status,status,is_deleted)
    SELECT ${REVIEW_USER_ID},'86','${REVIEW_PHONE}',password_hash,'K5独立复审用户','${REVIEW_REFERRAL}','APPROVED','ACTIVE',0
      FROM nx_user WHERE is_deleted=0 LIMIT 1;
    UPDATE nx_kyc_profile
       SET kyc_no='KYC-${RUN_ID}',status='APPROVED',country='JP',
           applicant_name='K5 Acceptance',document_type='PASSPORT',document_last4='K5A2',
           submitted_at=NOW(),reviewed_by='K5_FIXTURE',reviewed_at=NOW(),
           trigger_source='K5_ACCEPTANCE',version=0,is_deleted=0
     WHERE user_id=${REVIEW_USER_ID};
    INSERT INTO nx_admin_risk_kyc_review_ticket(
      ticket_id,ticket_type,user_no,amount_text,amount_usdt,cumulative_text,kyc_text,status,
      sla_pct,sla_text,info_json,history_json,due_at,version,is_deleted)
    VALUES (
      '${UNAVAILABLE_TICKET_ID}','大额提现','${UNAVAILABLE_USER_NO}','>= $5000',5000.00000000,
      '$5000','USER_UNAVAILABLE','in-review',0.5000,'2 个工作日',
          JSON_ARRAY(
            JSON_ARRAY('sourceDomain','K5'),
            JSON_ARRAY('sourceNo','${RUN_ID}'),
            JSON_ARRAY('fixtureOwner','${RUN_ID}')),
          JSON_ARRAY(JSON_ARRAY('刚刚','run fixture created','')),
      DATE_ADD(NOW(),INTERVAL 2 DAY),0,0);
    COMMIT;
  `);
  ownsReviewFixture = true;
  const seeded = mysql(`
    SELECT CONCAT(
      (SELECT COUNT(*) FROM nx_user
        WHERE id=${REVIEW_USER_ID} AND phone='${REVIEW_PHONE}' AND referral_code='${REVIEW_REFERRAL}'
          AND status='ACTIVE' AND kyc_status='APPROVED' AND is_deleted=0),',',
      (SELECT COUNT(*) FROM nx_kyc_profile
        WHERE user_id=${REVIEW_USER_ID} AND kyc_no='KYC-${RUN_ID}' AND status='APPROVED' AND is_deleted=0),',',
      (SELECT COUNT(*) FROM nx_admin_risk_kyc_review_ticket
        WHERE ticket_id='${UNAVAILABLE_TICKET_ID}' AND user_no='${UNAVAILABLE_USER_NO}'
          AND status='in-review' AND is_deleted=0)
    );
  `).trim();
  if (seeded !== "1,1,1") throw new Error(`K5 isolated fixture invalid: ${seeded}`);
});

test.afterEach(async ({ page }) => {
  await safeServerLogout(page);
});

test("K5 首次用户以本 Run 独立 Owner 从登录页、可见侧栏进入并识别权威队列", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await loginAndOpenK5(page, OWNER_USERNAME);

  await expect(page.getByText("复审触发队列", { exact: true })).toBeVisible();
  await expect(page.getByText("异常告警", { exact: true })).toBeVisible();
  await expect(page.getByText("兑换阈值归 G2 · 只读", { exact: true })).toBeVisible();
  await expect(page.getByText("实名状态(C4)", { exact: true }).first()).toBeVisible();

  const unavailableRow = page.locator("tr").filter({ hasText: UNAVAILABLE_TICKET_ID }).filter({ hasText: "用户不可用" }).first();
  await expect(unavailableRow).toBeVisible();
  await unavailableRow.click();
  await expect(page.getByText("用户不存在，无法裁决；请先核对 C4 账户状态", { exact: true })).toBeVisible();
  const detail = page.locator("section.l-card").filter({ hasText: `复审工单 · ${UNAVAILABLE_TICKET_ID}` }).first();
  await expect(detail).toContainText("实名状态(C4)");
  await expect(detail).toContainText("用户不可用");
  await expect(detail.getByRole("button", { name: "通过", exact: true })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "驳回", exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-root-sidebar-authoritative-queue.png"), fullPage: true });

  const overview = await fetchOverview(page);
  expect(overview.tickets.records.some((ticket) => ticket.type === "大额提现" && ticket.st === "in-review")).toBeTruthy();
  expect(overview.tickets.records.some((ticket) => ticket.kyc === "USER_UNAVAILABLE")).toBeTruthy();
  record("run-scoped owner visible entry and authoritative unavailable-user guard", {
    openTickets: overview.stats.openTickets,
    returnedTickets: overview.tickets.records.length,
    alerts: overview.alerts.length,
  });
  expect(runtimeErrors).toEqual([]);
});

test("K5 风险岗真实订阅、并发合并、未知结果同键重试、驳回后再通过恢复 C4", async ({ page, browser }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await loginAndOpenK5(page, RISK_USERNAME);

  for (const label of ["新复审命中", "复审超时", "短时大额集中", "站内通知"]) {
    const checkbox = page.getByRole("checkbox", { name: label });
    await expect(checkbox).toBeVisible();
    if (!await checkbox.isChecked()) await checkbox.check();
  }
  const subscriptionResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
      && new URL(response.url()).pathname.endsWith("/api/admin/risk/kyc-review/subscription"));
  await page.getByRole("button", { name: "保存订阅", exact: true }).click();
  expect((await subscriptionResponse).status()).toBe(200);
  await expect(page.getByText(/告警订阅已保存到后端/).last()).toBeVisible();

  const search = page.getByRole("combobox", { name: "搜索真实用户" });
  await search.fill(REVIEW_USER_NO);
  const option = page.getByRole("option").filter({ hasText: REVIEW_USER_NO }).first();
  await expect(option).toBeVisible();
  await option.click();
  const manualResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/api/admin/risk/kyc-review/tickets/manual"));
  await page.getByRole("button", { name: "手动补触发", exact: true }).click();
  const manualPayload = await envelope<{ manualResult: { ticketId: string; userNo: string; merged: boolean } }>(await manualResponsePromise);
  reviewTicketId = manualPayload.data.manualResult.ticketId;
  expect(reviewTicketId).toMatch(/^KR-/);
  await expect(page.getByText(new RegExp(`${REVIEW_USER_NO} · 已(?:新建|并入)工单`))).toBeVisible();

  const concurrentReason = `${REASON} 并发入口合并同一开放工单`;
  const concurrent = await Promise.all([1, 2].map((index) => page.request.post("/api/admin/risk/kyc-review/tickets/manual", {
    headers: { "Idempotency-Key": `${RUN_ID}-CONCURRENT-${index}` },
    data: { userNo: REVIEW_USER_NO, reason: concurrentReason, operator: "forged-browser-operator" },
  })));
  expect(concurrent.map((response) => response.status())).toEqual([200, 200]);
  const concurrentPayloads = await Promise.all(concurrent.map((response) => envelope<{ manualResult: { ticketId: string } }>(response)));
  expect(concurrentPayloads.map((payload) => payload.data.manualResult.ticketId)).toEqual([reviewTicketId, reviewTicketId]);

  const replayKey = `${RUN_ID}-MANUAL-REPLAY`;
  const replayBody = { userNo: REVIEW_USER_NO, reason: `${REASON} 幂等同键重放`, operator: "ignored" };
  const replayFirst = await page.request.post("/api/admin/risk/kyc-review/tickets/manual", {
    headers: { "Idempotency-Key": replayKey }, data: replayBody,
  });
  const replaySecond = await page.request.post("/api/admin/risk/kyc-review/tickets/manual", {
    headers: { "Idempotency-Key": replayKey }, data: replayBody,
  });
  expect([replayFirst.status(), replaySecond.status()]).toEqual([200, 200]);
  expect((await envelope<{ manualResult: { ticketId: string } }>(replayFirst)).data.manualResult.ticketId).toBe(reviewTicketId);
  expect((await envelope<{ manualResult: { ticketId: string } }>(replaySecond)).data.manualResult.ticketId).toBe(reviewTicketId);
  const replayConflict = await page.request.post("/api/admin/risk/kyc-review/tickets/manual", {
    headers: { "Idempotency-Key": replayKey },
    data: { ...replayBody, reason: `${REASON} 同键不同载荷必须拒绝` },
  });
  expect(replayConflict.status()).toBe(409);

  let overview = await fetchOverview(page);
  const reviewTicket = findTicket(overview, reviewTicketId);
  expect(reviewTicket.user).toBe(REVIEW_USER_NO);
  expect(reviewTicket.st).toBe("in-review");
  expect(overview.alerts.some((alert) => alert.eventKey.startsWith("threshold-hit"))).toBeTruthy();

  const staleDecision = await decision(page, reviewTicketId, "passed", Math.max(0, reviewTicket.version - 1), `${REASON} 旧版本CAS拒绝`, `${RUN_ID}-STALE`);
  expect(staleDecision.status()).toBe(409);
  expect((await envelope<unknown>(staleDecision, false)).message).toBe("K5_REVIEW_TICKET_VERSION_CONFLICT");
  const invalid = await page.request.post(`/api/admin/risk/kyc-review/tickets/${reviewTicketId}/decision`, {
    headers: { "Idempotency-Key": `${RUN_ID}-INVALID` },
    data: { decision: "rejected", expectedVersion: reviewTicket.version, reasonCode: "NOT_ALLOWED", reason: "short", operator: "ignored" },
  });
  expect(invalid.status()).toBe(422);
  const missingKey = await page.request.post(`/api/admin/risk/kyc-review/tickets/${reviewTicketId}/decision`, {
    data: { decision: "passed", expectedVersion: reviewTicket.version, reason: `${REASON} 缺少命令键`, operator: "ignored" },
  });
  expect(missingKey.status()).toBe(422);

  await page.reload();
  await expect(page.getByText("复审触发队列", { exact: true })).toBeVisible();
  await page.getByLabel("复审触发队列 每页条数").selectOption("50");
  const row = page.locator("tr").filter({ hasText: reviewTicketId }).first();
  await expect(row).toBeVisible();
  await row.click();
  const commandKeys: string[] = [];
  let interceptedAttempts = 0;
  await page.route(`**/api/admin/risk/kyc-review/tickets/${reviewTicketId}/decision`, async (route) => {
    interceptedAttempts += 1;
    commandKeys.push(await route.request().headerValue("idempotency-key") ?? "");
    if (interceptedAttempts === 1) {
      const upstream = await route.fetch();
      expect(upstream.status()).toBe(200);
      await route.fulfill({
        status: 502,
        headers: { "X-Nexion-Upstream-Outcome": "unknown" },
        contentType: "application/json",
        body: JSON.stringify({ code: 502, message: "UPSTREAM_OUTCOME_UNKNOWN", data: null }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "驳回", exact: true }).click();
  const rejectDialog = page.getByRole("dialog");
  await rejectDialog.getByLabel(/操作理由/).fill(`${REASON} 驳回后未知结果同键恢复`);
  await rejectDialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(rejectDialog).toBeVisible();
  await expect(page.getByText(/结果未知|结果暂不确定/).last()).toBeVisible();
  await rejectDialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(rejectDialog).toHaveCount(0);
  expect(commandKeys).toHaveLength(2);
  expect(commandKeys[0]).toBeTruthy();
  expect(commandKeys[1]).toBe(commandKeys[0]);
  await page.unroute(`**/api/admin/risk/kyc-review/tickets/${reviewTicketId}/decision`);

  expect(await c4StatusAsRoot(browser)).toBe("rejected");
  const terminal = await decision(page, reviewTicketId, "passed", reviewTicket.version + 1, `${REASON} 终态禁止再次裁决`, `${RUN_ID}-TERMINAL`);
  expect(terminal.status()).toBe(409);
  expect((await envelope<unknown>(terminal, false)).message).toBe("K5_REVIEW_TICKET_NOT_REVIEWABLE");

  const restoreCreate = await page.request.post("/api/admin/risk/kyc-review/tickets/manual", {
    headers: { "Idempotency-Key": `${RUN_ID}-RESTORE-CREATE` },
    data: { userNo: REVIEW_USER_NO, reason: `${REASON} 通过裁决恢复C4基线`, operator: "ignored" },
  });
  expect(restoreCreate.status()).toBe(200);
  restoredTicketId = (await envelope<{ manualResult: { ticketId: string } }>(restoreCreate)).data.manualResult.ticketId;
  overview = await fetchOverview(page);
  const restoreTicket = findTicket(overview, restoredTicketId);
  expect(restoreTicket.st).toBe("in-review");
  const restored = await decision(page, restoredTicketId, "passed", restoreTicket.version, `${REASON} 通过并恢复C4权威状态`, `${RUN_ID}-RESTORE-PASS`);
  expect(restored.status()).toBe(200);
  expect(await c4StatusAsRoot(browser)).toBe("verified");

  await page.reload();
  await showAllTickets(page);
  await expect(page.locator("tr").filter({ hasText: restoredTicketId }).first()).toContainText("已通过");
  await logout(page);
  await loginAndOpenK5(page, RISK_USERNAME);
  await showAllTickets(page);
  await expect(page.locator("tr").filter({ hasText: restoredTicketId }).first()).toContainText("已通过");
  expect(await c4StatusAsRoot(browser)).toBe("verified");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-risk-state-machine-refresh-relogin.png"), fullPage: true });
  const immutableCounts = mysql(`
    SELECT CONCAT(
      (SELECT COUNT(*) FROM nx_audit_log
        WHERE resource_id IN ('${reviewTicketId}','${restoredTicketId}') AND is_deleted=0),',',
      (SELECT COUNT(*) FROM nx_event_outbox
        WHERE event_type='admin.kyc_status_changed'
          AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.evidenceRef'))
              IN ('${reviewTicketId}','${restoredTicketId}')
          AND is_deleted=0)
    );
  `).trim().split(",").map(Number);
  expect(immutableCounts[0], "K5 decisions must retain A2 audit evidence").toBeGreaterThanOrEqual(2);
  expect(immutableCounts[1], "K5 decisions must retain A4/outbox evidence").toBeGreaterThanOrEqual(2);
  summary.auditCount = immutableCounts[0];
  summary.outboxCount = immutableCounts[1];

  record("risk role subscription, concurrency, idempotency, CAS and reversible state machine", {
    reviewTicketId,
    restoredTicketId,
    concurrentStatuses: concurrent.map((response) => response.status()),
    unknownOutcomeAttempts: interceptedAttempts,
    sameCommandKey: commandKeys[0] === commandKeys[1],
    finalC4Status: "verified",
  });
  expect(runtimeErrors).toEqual([]);
});

test("K5 只读角色页面无写入口、服务器拒绝越权，匿名拒绝且不存在用户拒绝无写入", async ({ page, browser }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await loginAndOpenK5(page, READONLY_USERNAME);
  await expect(page.getByText("复审触发队列", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "搜索真实用户" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "手动补触发", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存订阅", exact: true })).toHaveCount(0);

  const forbidden = await decision(page, restoredTicketId, "passed", 0, `${REASON} 只读角色越权直调拒绝`, `${RUN_ID}-FORBIDDEN`);
  expect(forbidden.status()).toBe(403);

  const anonymous = await browser.newContext({ baseURL: "http://127.0.0.1:3002" });
  try {
    const response = await anonymous.request.get(K5_OVERVIEW);
    expect(response.status()).toBe(401);
  } finally {
    await anonymous.close();
  }

  await logout(page);
  await loginAndOpenK5(page, RISK_USERNAME);
  const before = findTicket(await fetchOverview(page), UNAVAILABLE_TICKET_ID);
  const unavailable = await decision(page, before.id, "passed", before.version, `${REASON} 不存在用户必须失败关闭`, `${RUN_ID}-UNAVAILABLE`);
  expect(unavailable.status()).toBe(404);
  expect((await envelope<unknown>(unavailable, false)).message).toBe("K5_REVIEW_USER_NOT_FOUND");
  const after = findTicket(await fetchOverview(page), before.id);
  expect({ st: after.st, version: after.version }).toEqual({ st: before.st, version: before.version });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-readonly-and-unavailable-user-guards.png"), fullPage: true });
  record("401, 403 and unavailable-user 404 guards", {
    readonlyUser: READONLY_USERNAME,
    unavailableTicketId: before.id,
    statusPreserved: after.st,
    versionPreserved: after.version,
  });
  expect(runtimeErrors).toEqual([]);
});

test("K5 墨菲异常：503、断网、畸形成功均隐藏陈旧数据并可只重试恢复", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page, [
    /Failed to load resource: net::ERR_CONNECTION_FAILED/,
    /K5 response validation failed kycReview\.stats/,
  ]);
  await loginAndOpenK5(page, OWNER_USERNAME);

  await page.route(K5_OVERVIEW_ROUTE, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ code: 503, message: "RISK_K5_TEMPORARILY_UNAVAILABLE", data: null }),
  }));
  await page.reload();
  await assertFailClosed(page);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-503-fail-closed.png"), fullPage: true });
  await page.unroute(K5_OVERVIEW_ROUTE);
  await page.getByRole("button", { name: "仅重试 K5", exact: true }).click();
  await expect(page.getByText("复审触发队列", { exact: true })).toBeVisible();

  await page.route(K5_OVERVIEW_ROUTE, (route) => route.abort("connectionfailed"));
  await page.reload();
  await assertFailClosed(page);
  await page.unroute(K5_OVERVIEW_ROUTE);
  await page.getByRole("button", { name: "仅重试 K5", exact: true }).click();
  await expect(page.getByText("复审触发队列", { exact: true })).toBeVisible();

  await page.route(K5_OVERVIEW_ROUTE, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, message: "success", data: { unexpectedShape: true } }),
  }));
  await page.reload();
  await assertFailClosed(page);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "05-malformed-success-fail-closed.png"), fullPage: true });
  await page.unroute(K5_OVERVIEW_ROUTE);
  await page.getByRole("button", { name: "仅重试 K5", exact: true }).click();
  await expect(page.getByText("复审触发队列", { exact: true })).toBeVisible();
  await showAllTickets(page);
  await expect(page.locator("tr").filter({ hasText: restoredTicketId }).first()).toContainText("已通过");

  record("503, network failure and malformed 200 fail closed then recover", { recoveredTicketId: restoredTicketId });
  expect(runtimeErrors).toEqual([]);
});

test.afterAll(async ({ browser }) => {
  const cleanupErrors: string[] = [];
  try {
    if (ownsReviewFixture) {
      try {
        summary.cleanupCounts = cleanupK5Fixture();
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : String(error));
      }
    } else {
      summary.fixtureCleanup = "not-owned-no-cleanup";
    }
    if (temporaryAccounts.length > 0) {
      if (!TEMP_ACCOUNT_CLEANUP_USERNAME || !TEMP_ACCOUNT_CLEANUP_PASSWORD || !TEMP_ACCOUNT_CLEANUP_TOTP_SECRET) {
        cleanupErrors.push("K5 temporary-account cleanup actor credentials are incomplete");
      } else {
        const context = await browser.newContext({ baseURL: "http://127.0.0.1:3002" });
        const page = await context.newPage();
        try {
          await login(page, TEMP_ACCOUNT_CLEANUP_USERNAME);
          const cleanupActor = await authenticatedSession(page);
          expect(cleanupActor.role).toBe("superadmin");
          expect(cleanupActor.roleCode).toBe("SUPER_ADMIN");
          for (const authority of [
            "platform_a1_account_role_change", "platform_a1_account_disable",
            "platform_a1_account_2fa_reset", "platform_a1_account_sessions_revoke",
          ]) {
            expect(cleanupActor.authorities).toContain(authority);
          }
          for (const account of temporaryAccounts) {
            try {
              await sanitizeTemporaryAccount(page, account, String(cleanupActor.adminId));
            } catch (error) {
              cleanupErrors.push(`temporary account ${account.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } catch (error) {
          cleanupErrors.push(`temporary-account cleanup session: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          await safeServerLogout(page);
          await context.close().catch(() => undefined);
        }
      }
    }
    summary.cleanupErrors = cleanupErrors;
    if (cleanupErrors.length > 0) {
      throw new Error(`K5 cleanup failed after all phases: ${cleanupErrors.join(" | ")}`);
    }
    summary.cleanup = "completed";
  } catch (error) {
    summary.cleanup = error instanceof Error ? error.message : "cleanup failed";
    throw error;
  } finally {
    summary.finishedAt = new Date().toISOString();
    await writeFile(path.join(EVIDENCE_DIR, "browser-api-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    await writeFile(path.join(EVIDENCE_DIR, "README.txt"), [
      "K5 real Chromium and API acceptance evidence.",
      "Normal reads and writes used the live 3002 frontend and 8110 backend.",
      "Only the named 502 unknown-outcome response, 503, network abort and malformed-response Murphy branches used route injection.",
      "The isolated user, mutable K5 tickets/sources/alerts/idempotency rows and actor subscription are exactly cleaned or restored.",
      "Immutable A2/A4 audit and outbox evidence is intentionally retained.",
      "No password, access token, cookie or HAR is stored in this folder.",
    ].join("\n"), "utf8");
  }
});

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for K5 live acceptance`);
  return value;
}

async function loginAndOpenK5(page: Page, username: string) {
  await login(page, username);
  await openK5FromSidebar(page);
}

async function openK5FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /风控.*K|K.*风控/ }).first();
  const link = page.locator('a[href="/risk/kyc-review"]').first();
  for (let attempt = 0; attempt < 3 && !await link.isVisible().catch(() => false); attempt += 1) {
    await expect(group).toBeVisible({ timeout: 5_000 });
    await group.click();
    await page.waitForTimeout(350);
  }
  await expect(link, "K5 必须可从当前角色可见侧栏进入").toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/risk\/kyc-review(?:\?.*)?$/);
  await expect(page.getByText("复审触发队列", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function login(page: Page, username: string, suppliedPassword = passwordFor(username), changedPassword?: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  if (await page.locator("aside").isVisible().catch(() => false)) await logout(page);
  const usernameInput = page.locator('input[autocomplete="username"]');
  const passwordInput = page.locator('input[autocomplete="current-password"]');
  await expect(usernameInput).toBeVisible({ timeout: 10_000 });
  await usernameInput.fill(username);
  await passwordInput.fill(suppliedPassword);
  await page.waitForTimeout(150);
  if (await usernameInput.inputValue() !== username) await usernameInput.fill(username);
  if (await passwordInput.inputValue() !== suppliedPassword) await passwordInput.fill(suppliedPassword);
  await expect(usernameInput).toHaveValue(username);
  await expect(passwordInput).toHaveValue(suppliedPassword);
  const loginResponsePromise = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const loginResponse = await loginResponsePromise;
  const payload = await loginResponse.json().catch(() => ({})) as { data?: { mfa?: { manualKey?: string | null } } };
  for (let step = 0; step < 40; step += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) break;
    if (await page.getByRole("heading", { name: "首次登录修改密码" }).isVisible().catch(() => false)) {
      if (!changedPassword) throw new Error(`K5 role ${username} requires a first-login password change`);
      await page.getByLabel("新密码", { exact: true }).fill(changedPassword);
      await page.getByLabel("确认新密码", { exact: true }).fill(changedPassword);
      await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
    }
    const otpInput = page.getByLabel("一次性验证码");
    if (await otpInput.isVisible().catch(() => false)) {
      const visibleSecret = (await page.locator("code").textContent().catch(() => null))?.trim();
      const secret = payload.data?.mfa?.manualKey ?? visibleSecret ?? mfaSecrets.get(username);
      if (!secret) throw new Error(`K5 role ${username} requires an unavailable external TOTP secret`);
      mfaSecrets.set(username, secret);
      await otpInput.fill(await freshTotp(username, secret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
    await page.waitForTimeout(250);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  await assertRunScopedSession(page, username);
}

function passwordFor(username: string) {
  if (username === OWNER_USERNAME) return OWNER_PASSWORD;
  if (username === RISK_USERNAME) return RISK_PASSWORD;
  if (username === READONLY_USERNAME) return READONLY_PASSWORD;
  if (username === C4_USERNAME) return C4_PASSWORD;
  if (username === TEMP_ACCOUNT_CLEANUP_USERNAME && TEMP_ACCOUNT_CLEANUP_PASSWORD) {
    return TEMP_ACCOUNT_CLEANUP_PASSWORD;
  }
  throw new Error(`No run-scoped K5 credential is configured for ${username}`);
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

async function fetchOverview(page: Page): Promise<K5Overview> {
  const response = await page.request.get(K5_OVERVIEW);
  expect(response.status()).toBe(200);
  return (await envelope<K5Overview>(response)).data;
}

async function showAllTickets(page: Page) {
  const pageSize = page.getByRole("combobox", { name: "复审触发队列 每页条数" });
  await expect(pageSize).toBeVisible();
  await pageSize.selectOption("50");
}

async function c4StatusAsRoot(browser: Browser) {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3002" });
  const page = await context.newPage();
  try {
    await login(page, ROOT_USERNAME);
    const group = page.getByRole("button", { name: /用户与账户.*C|C.*用户与账户/ }).first();
    const link = page.locator('a[href="/users/kyc"]').first();
    if (!await link.isVisible().catch(() => false)) await group.click();
    await expect(link, "C4 viewer must enter through its visible sidebar").toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/users\/kyc(?:\?.*)?$/);
    await expect(page.getByText("KYC 状态列表", { exact: true })).toBeVisible({ timeout: 20_000 });
    const response = await page.request.get(`/api/admin/users/kyc/users/${REVIEW_USER_ID}`);
    expect(response.status()).toBe(200);
    const payload = await envelope<{ status: string }>(response);
    return payload.data.status;
  } finally {
    await safeServerLogout(page);
    await context.close();
  }
}

async function temporaryAccountById(page: Page, accountId: string) {
  const overview = await envelope<{ operators: TemporaryAccountState[] }>(
    await page.request.get("/api/admin/platform/accounts/overview"),
  );
  const current = overview.data.operators.find((operator) => String(operator.id) === accountId);
  if (!current) throw new Error(`K5 temporary account ${accountId} was not found for cleanup`);
  return current;
}

function registerTemporaryAccount(evidence: TemporaryAccountEvidence) {
  if (!/^[1-9]\d*$/.test(evidence.id)) {
    throw new Error(`K5 temporary account id is not a positive numeric identifier: ${evidence.id}`);
  }
  if (evidence.ownerRunId !== RUN_ID || !evidence.label.includes(RUN_ID)) {
    throw new Error("K5 temporary account evidence is not owned by this Run");
  }
  if ([OWNER_USERNAME, RISK_USERNAME, READONLY_USERNAME, C4_USERNAME, TEMP_ACCOUNT_CLEANUP_USERNAME]
    .includes(evidence.username)) {
    throw new Error(`K5 protected acceptance actor cannot be registered for cleanup: ${evidence.username}`);
  }
  if (temporaryAccounts.some((account) => account.id === evidence.id || account.username === evidence.username)) {
    throw new Error(`K5 duplicate temporary account cleanup evidence: ${evidence.id}`);
  }
  temporaryAccounts.push({ ...evidence });
}

async function sanitizeTemporaryAccount(
  page: Page,
  evidence: TemporaryAccountEvidence,
  cleanupActorId: string,
) {
  const { id: accountId, label } = evidence;
  if (!/^[1-9]\d*$/.test(accountId) || evidence.ownerRunId !== RUN_ID || !label.includes(RUN_ID)) {
    throw new Error("K5 temporary account cleanup provenance is invalid");
  }
  if (accountId === cleanupActorId) {
    throw new Error("K5 temporary account cleanup refuses to mutate the cleanup actor");
  }
  const assertOwnedTarget = async () => {
    const current = await temporaryAccountById(page, accountId);
    if (current.username !== evidence.username || !current.name.includes(RUN_ID)) {
      throw new Error(`K5 temporary account ${accountId} no longer matches this Run's creation evidence`);
    }
    if ([OWNER_USERNAME, RISK_USERNAME, READONLY_USERNAME, C4_USERNAME, TEMP_ACCOUNT_CLEANUP_USERNAME]
      .includes(current.username)) {
      throw new Error(`K5 protected acceptance actor cannot be sanitized: ${current.username}`);
    }
    return current;
  };
  const mutate = async (method: "PATCH" | "POST", suffix: string, data: Record<string, unknown>) => {
    const current = await assertOwnedTarget();
    const response = await page.request.fetch(`/api/admin/platform/accounts/${accountId}/${suffix}`, {
      method,
      headers: { "Idempotency-Key": `${RUN_ID}-TEMP-${accountId}-${suffix}` },
      data: {
        ...data,
        expectedVersion: current.version,
        operator: "ignored",
      },
    });
    expect(response.status(), await response.text()).toBeLessThan(400);
  };

  let current = await assertOwnedTarget();
  if (current.tfa) {
    await mutate("POST", "reset-2fa", { reason: `${REASON} 清除独立复审${label}账号 MFA` });
  }
  current = await assertOwnedTarget();
  if (current.role !== "unassigned") {
    await mutate("PATCH", "role", {
      role: "unassigned",
      reason: `${REASON} 移除独立复审${label}角色`,
    });
  }
  current = await assertOwnedTarget();
  if (current.status !== "disabled") {
    await mutate("PATCH", "status", {
      status: "disabled",
      reason: `${REASON} 停用独立复审${label}账号`,
    });
  }
  current = await assertOwnedTarget();
  if (Number(current.sessions) > 0) {
    await mutate("POST", "sessions/revoke", {
      reason: `${REASON} 撤销独立复审${label}账号会话`,
    });
  }
  current = await assertOwnedTarget();
  expect({
    role: current.role,
    status: current.status,
    tfa: current.tfa,
    sessions: Number(current.sessions),
  }).toEqual({ role: "unassigned", status: "disabled", tfa: false, sessions: 0 });
}

async function assertRunScopedSession(page: Page, username: string) {
  const session = await authenticatedSession(page);
  expect(session.username).toBe(username);
  if (username === TEMP_ACCOUNT_CLEANUP_USERNAME) {
    // The optional temporary-account fallback is the only SUPER exception:
    // A1's real service contract rejects role/status/MFA cleanup otherwise.
    expect(session.role).toBe("superadmin");
    expect(session.roleCode).toBe("SUPER_ADMIN");
    return;
  }
  expect(session.role).not.toBe("superadmin");
  if (username === READONLY_USERNAME) {
    expect(session.authorities).toContain("risk_k5_read");
    expect(session.authorities.some((authority) =>
      authority.startsWith("risk_k5_") && authority !== "risk_k5_read")).toBe(false);
  } else if (username === C4_USERNAME) {
    expect(session.authorities).toContain("user_c4_read");
    expect(session.authorities).not.toContain("risk_k5_write");
  } else {
    for (const authority of [
      "risk_k5_read", "risk_k5_write", "risk_k5_ticket_manual", "risk_k5_ticket_pass", "risk_k5_ticket_reject",
    ]) {
      expect(session.authorities).toContain(authority);
    }
  }
}

async function authenticatedSession(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await envelope<{
    session: {
      adminId: number;
      username: string;
      role: string;
      roleCode: string;
      authorities: string[];
    };
  }>(response);
  return payload.data.session;
}

async function safeServerLogout(page: Page) {
  await page.request.post("/api/admin/auth/logout").catch(() => null);
  await page.context().clearCookies().catch(() => undefined);
}

function findTicket(overview: K5Overview, ticketId: string) {
  const ticket = overview.tickets.records.find((candidate) => candidate.id === ticketId);
  if (!ticket) throw new Error(`K5 ticket ${ticketId} was not returned by the authoritative overview`);
  return ticket;
}

function decision(page: Page, ticketId: string, decisionValue: "passed" | "rejected", expectedVersion: number, reason: string, key: string) {
  return page.request.post(`/api/admin/risk/kyc-review/tickets/${ticketId}/decision`, {
    headers: { "Idempotency-Key": key },
    data: {
      decision: decisionValue,
      expectedVersion,
      reasonCode: decisionValue === "rejected" ? "KYC_MATERIAL_INVALID" : undefined,
      reason,
      operator: "forged-browser-operator",
    },
  });
}

async function envelope<T>(response: { json(): Promise<unknown> }, requireSuccess = true): Promise<Envelope<T>> {
  const payload = await response.json() as Envelope<T>;
  if (requireSuccess) expect(payload.code).toBe(0);
  return payload;
}

function mysql(sql: string) {
  return execFileSync(MYSQL, ["-uroot", "-D", DB_NAME, "-N", "-B", "-e", sql], {
    encoding: "utf8",
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
  });
}

function cleanupK5Fixture() {
  const errors: string[] = [];
  const runPhase = <T>(name: string, action: () => T): T | undefined => {
    try {
      return action();
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };
  const discoveredTicketIds = runPhase("discover tickets", () => mysql(`
    SELECT ticket_id FROM nx_admin_risk_kyc_review_ticket
     WHERE (user_no='${REVIEW_USER_NO}' OR ticket_id='${UNAVAILABLE_TICKET_ID}') AND is_deleted=0;
  `).trim().split(/\s+/).filter(Boolean)) ?? [];
  const ticketIds = Array.from(new Set([
    ...discoveredTicketIds,
    reviewTicketId,
    restoredTicketId,
    UNAVAILABLE_TICKET_ID,
  ].filter(Boolean)));
  const quotedTicketIds = ticketIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
  const ticketFilter = quotedTicketIds ? `IN (${quotedTicketIds})` : `='__none__'`;
  const alertFilter = ticketIds.length > 0
    ? ticketIds.map((id) => `event_key LIKE 'threshold-hit:${id.replace(/'/g, "''")}%'`).join(" OR ")
    : "1=0";
  const idempotencyScopes = [
    `scope='K5_MANUAL:${REVIEW_USER_NO}'`,
    ...(ticketIds.map((id) => `scope='K5_DECISION:${id.replace(/'/g, "''")}'`)),
    ...(riskAdminId ? [`scope='K5_ALERT_SUBSCRIPTION:${riskAdminId}'`] : []),
  ].join(" OR ");
  runPhase("delete review sources", () =>
    mysql(`DELETE FROM nx_admin_risk_kyc_review_source WHERE ticket_id ${ticketFilter};`));
  runPhase("delete review alerts", () =>
    mysql(`DELETE FROM nx_admin_risk_kyc_alert WHERE ${alertFilter};`));
  runPhase("delete review tickets", () =>
    mysql(`DELETE FROM nx_admin_risk_kyc_review_ticket WHERE ticket_id ${ticketFilter};`));
  runPhase("delete idempotency records", () => mysql(`
    DELETE FROM nx_admin_idempotency_record
     WHERE id>${idempotencyBaseline}
       AND (${idempotencyScopes || "1=0"} OR idempotency_key LIKE '${RUN_ID.replace(/'/g, "''")}-%');
  `));
  runPhase("delete KYC profile", () =>
    mysql(`DELETE FROM nx_kyc_profile WHERE user_id=${REVIEW_USER_ID} AND kyc_no='KYC-${RUN_ID}';`));
  runPhase("delete user sessions", () => mysql(`
    DELETE FROM nx_user_session WHERE user_id IN (
      SELECT id FROM nx_user
       WHERE id=${REVIEW_USER_ID} AND phone='${REVIEW_PHONE}' AND referral_code='${REVIEW_REFERRAL}');
  `));
  runPhase("delete user", () => mysql(`
    DELETE FROM nx_user
     WHERE id=${REVIEW_USER_ID} AND phone='${REVIEW_PHONE}' AND referral_code='${REVIEW_REFERRAL}';
  `));

  if (riskAdminId) {
    if (subscriptionSnapshot) {
      const [alertTypesHex, channelsHex, version, createdAt, updatedAt] = subscriptionSnapshot;
      runPhase("restore subscription snapshot", () => mysql(`
        INSERT INTO nx_admin_risk_kyc_alert_subscription(
          operator_name,alert_types_json,channels_json,version,created_at,updated_at)
        VALUES (
          '${RISK_USERNAME}',CONVERT(UNHEX('${alertTypesHex}') USING utf8mb4),
          CONVERT(UNHEX('${channelsHex}') USING utf8mb4),${Number(version)},
          '${createdAt}','${updatedAt}')
        ON DUPLICATE KEY UPDATE
          alert_types_json=VALUES(alert_types_json),channels_json=VALUES(channels_json),
          version=VALUES(version),created_at=VALUES(created_at),updated_at=VALUES(updated_at);
      `));
    } else {
      runPhase("remove run-created subscription", () =>
        mysql(`DELETE FROM nx_admin_risk_kyc_alert_subscription WHERE operator_name='${RISK_USERNAME}';`));
    }
  }

  const labels = [
    "sources", "alerts", "tickets", "idempotency", "kycProfiles", "userSessions", "users", "mutexes", "objectLocks",
  ];
  let result: Record<string, number> = Object.fromEntries(labels.map((label) => [label, Number.NaN]));
  runPhase("verify mutable fixture cleanup", () => {
    const counts = mysql(`
      SELECT CONCAT_WS(',',
        (SELECT COUNT(*) FROM nx_admin_risk_kyc_review_source WHERE ticket_id ${ticketFilter}),
        (SELECT COUNT(*) FROM nx_admin_risk_kyc_alert WHERE ${alertFilter}),
        (SELECT COUNT(*) FROM nx_admin_risk_kyc_review_ticket WHERE ticket_id ${ticketFilter}),
        (SELECT COUNT(*) FROM nx_admin_idempotency_record
          WHERE id>${idempotencyBaseline} AND (${idempotencyScopes || "1=0"} OR idempotency_key LIKE '${RUN_ID.replace(/'/g, "''")}-%')),
        (SELECT COUNT(*) FROM nx_kyc_profile WHERE user_id=${REVIEW_USER_ID}),
        (SELECT COUNT(*) FROM nx_user_session WHERE user_id=${REVIEW_USER_ID}),
        (SELECT COUNT(*) FROM nx_user WHERE id=${REVIEW_USER_ID} OR phone='${REVIEW_PHONE}' OR referral_code='${REVIEW_REFERRAL}'),
        (SELECT COUNT(*) FROM nx_admin_operation_mutex
          WHERE lock_key='${REVIEW_USER_NO}' OR lock_key ${ticketFilter}),
        (SELECT COUNT(*) FROM nx_audit_object_lock
          WHERE is_deleted=0 AND target_domain='K'
            AND (target_id='${REVIEW_USER_NO}' OR target_id ${ticketFilter}))
      );
    `).trim().split(",").map(Number);
    result = Object.fromEntries(labels.map((label, index) => [label, counts[index] ?? Number.NaN]));
    if (counts.length !== labels.length || counts.some((count) => count !== 0)) {
      throw new Error(`K5 mutable fixture cleanup incomplete: ${JSON.stringify(result)}`);
    }
  });
  if (riskAdminId) {
    runPhase("verify subscription snapshot", () => {
      const restoredSnapshot = mysql(`
        SELECT HEX(alert_types_json),HEX(channels_json),version,
               DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s'),DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s')
          FROM nx_admin_risk_kyc_alert_subscription WHERE operator_name='${RISK_USERNAME}' LIMIT 1;
      `).trim();
      const expected = subscriptionSnapshot?.join("\t") ?? "";
      if (restoredSnapshot !== expected) {
        throw new Error("K5 actor subscription was not restored to the exact pre-run snapshot");
      }
    });
  }
  summary.cleanupPhaseErrors = errors;
  if (errors.length > 0) {
    throw new Error(`K5 cleanup phases failed: ${errors.join(" | ")}`);
  }
  return result;
}

async function assertFailClosed(page: Page) {
  await expect(page.getByText("K5 数据加载失败", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "仅重试 K5", exact: true })).toBeVisible();
  await expect(page.getByText("复审触发队列", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "通过", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "驳回", exact: true })).toHaveCount(0);
}

function collectRuntimeErrors(page: Page, expected: RegExp[] = []) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error"
      && !/favicon|Failed to load resource.*(?:401|403|404|409|422|502|503)|ERR_FAILED/i.test(message.text())
      && !expected.some((pattern) => pattern.test(message.text()))) {
      errors.push(`console:${message.text()}`);
    }
  });
  return errors;
}

function record(name: string, detail: Record<string, unknown>) {
  const checks = summary.checks as Array<Record<string, unknown>>;
  checks.push({ name, pass: true, detail });
}

async function waitForStableTotpWindow() {
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 4) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
}

async function freshTotp(username: string, secret: string) {
  const previousStep = usedTotpSteps.get(username);
  let currentStep = Math.floor(Date.now() / 30_000);
  if (previousStep !== undefined && currentStep <= previousStep) {
    await new Promise((resolve) => setTimeout(resolve, ((previousStep + 1) * 30_000) - Date.now() + 1_000));
  }
  await waitForStableTotpWindow();
  currentStep = Math.floor(Date.now() / 30_000);
  usedTotpSteps.set(username, currentStep);
  return currentTotp(secret);
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const counter = Math.floor(Date.now() / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
