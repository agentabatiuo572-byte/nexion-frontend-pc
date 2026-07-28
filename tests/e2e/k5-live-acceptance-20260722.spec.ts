import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const EVIDENCE_DIR = process.env.K5_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/k-domain-acceptance-20260722/restricted/k5/live";
const PASSWORD = requiredEnv("ADMIN_E2E_PASSWORD");
const ROOT_USERNAME = process.env.K5_ROOT_USERNAME ?? "superadmin";
const RISK_USERNAME = process.env.K5_RISK_USERNAME ?? "d5_V3_i_risk";
const READONLY_USERNAME = process.env.K5_READONLY_USERNAME ?? "d5_V3_i_support";
const ROOT_PASSWORD = process.env.K5_ROOT_PASSWORD ?? PASSWORD;
const RISK_PASSWORD = process.env.K5_RISK_PASSWORD ?? PASSWORD;
const READONLY_PASSWORD = process.env.K5_READONLY_PASSWORD ?? PASSWORD;
const CREATE_TEMP_RISK = process.env.K5_CREATE_TEMP_RISK === "1";
const TEMP_RISK_INITIAL_PASSWORD = process.env.K5_TEMP_RISK_INITIAL_PASSWORD ?? "";
const CREATE_TEMP_READONLY = process.env.K5_CREATE_TEMP_READONLY === "1";
const TEMP_READONLY_INITIAL_PASSWORD = process.env.K5_TEMP_READONLY_INITIAL_PASSWORD ?? "";
const REVIEW_USER_NO = process.env.K5_REVIEW_USER_NO ?? "U00000052";
const REVIEW_USER_ID = process.env.K5_REVIEW_USER_ID ?? "52";
const RUN_ID = `K5ACC-${Date.now()}`;
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

const mfaSecrets = new Map<string, string>();
const usedTotpSteps = new Map<string, number>();
const summary: Record<string, unknown> = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  checks: [],
};
let reviewTicketId = "";
let restoredTicketId = "";
let temporaryRiskAccountId = "";
let temporaryReadonlyAccountId = "";

test.describe.configure({ mode: "serial" });
test.use({ trace: "off", video: "off" });

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("K5 首次用户从根登录页、可见侧栏进入并识别权威队列", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await loginAndOpenK5(page, ROOT_USERNAME);

  await expect(page.getByText("复审触发队列", { exact: true })).toBeVisible();
  await expect(page.getByText("异常告警", { exact: true })).toBeVisible();
  await expect(page.getByText("兑换阈值归 G2 · 只读", { exact: true })).toBeVisible();
  await expect(page.getByText("实名状态(C4)", { exact: true }).first()).toBeVisible();

  const unavailableRow = page.locator("tr").filter({ hasText: /KR-D2-/ }).filter({ hasText: "用户不可用" }).first();
  await expect(unavailableRow).toBeVisible();
  await unavailableRow.click();
  await expect(page.getByText("用户不存在，无法裁决；请先核对 C4 账户状态", { exact: true })).toBeVisible();
  const detail = page.locator("section.l-card").filter({ hasText: /复审工单 · KR-D2-/ }).first();
  await expect(detail).toContainText("实名状态(C4)");
  await expect(detail).toContainText("用户不可用");
  await expect(detail.getByRole("button", { name: "通过", exact: true })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "驳回", exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-root-sidebar-authoritative-queue.png"), fullPage: true });

  const overview = await fetchOverview(page);
  expect(overview.tickets.records.some((ticket) => ticket.type === "大额提现" && ticket.st === "in-review")).toBeTruthy();
  expect(overview.tickets.records.some((ticket) => ticket.kyc === "USER_UNAVAILABLE")).toBeTruthy();
  record("root visible entry and authoritative unavailable-user guard", {
    openTickets: overview.stats.openTickets,
    returnedTickets: overview.tickets.records.length,
    alerts: overview.alerts.length,
  });
  expect(runtimeErrors).toEqual([]);
});

test("K5 风险岗真实订阅、并发合并、未知结果同键重试、驳回后再通过恢复 C4", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  if (CREATE_TEMP_RISK) await createTemporaryRiskAndOpenK5(page);
  else await loginAndOpenK5(page, RISK_USERNAME);

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

  expect(await c4Status(page)).toBe("rejected");
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
  expect(await c4Status(page)).toBe("verified");

  await page.reload();
  await showAllTickets(page);
  await expect(page.locator("tr").filter({ hasText: restoredTicketId }).first()).toContainText("已通过");
  await logout(page);
  await loginAndOpenK5(page, RISK_USERNAME);
  await showAllTickets(page);
  await expect(page.locator("tr").filter({ hasText: restoredTicketId }).first()).toContainText("已通过");
  expect(await c4Status(page)).toBe("verified");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-risk-state-machine-refresh-relogin.png"), fullPage: true });

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
  if (CREATE_TEMP_READONLY) await createTemporaryReadonlyAndOpenK5(page);
  else await loginAndOpenK5(page, READONLY_USERNAME);
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
  await loginAndOpenK5(page, ROOT_USERNAME);
  const before = findTicket(await fetchOverview(page), "KR-D2-C5343068");
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
  await loginAndOpenK5(page, ROOT_USERNAME);

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
  const temporaryAccounts = [
    { id: temporaryRiskAccountId, label: "风险" },
    { id: temporaryReadonlyAccountId, label: "只读" },
  ].filter((account) => account.id);
  if (temporaryAccounts.length > 0) {
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:3002" });
    const page = await context.newPage();
    try {
      await login(page, ROOT_USERNAME);
      for (const account of temporaryAccounts) {
        const overview = await envelope<{
          operators: Array<{ id: string; version: string }>;
        }>(await page.request.get("/api/admin/platform/accounts/overview"));
        const current = overview.data.operators.find((operator) => operator.id === account.id);
        if (!current) throw new Error(`K5 temporary ${account.label} account ${account.id} was not found for cleanup`);
        const disabled = await page.request.patch(`/api/admin/platform/accounts/${account.id}/status`, {
          headers: { "Idempotency-Key": `${RUN_ID}-TEMP-${account.id}-DISABLE` },
          data: {
            status: "disabled",
            expectedVersion: current.version,
            reason: `${REASON} 清理独立复审${account.label}账号`,
            operator: "ignored",
          },
        });
        const disabledRaw = await disabled.text();
        expect(disabled.status(), disabledRaw).toBeLessThan(400);
        const disabledPayload = JSON.parse(disabledRaw) as Envelope<{ version: string }>;
        expect(disabledPayload.code).toBe(0);
        const unassigned = await page.request.patch(`/api/admin/platform/accounts/${account.id}/role`, {
          headers: { "Idempotency-Key": `${RUN_ID}-TEMP-${account.id}-UNASSIGN` },
          data: {
            role: "unassigned",
            expectedVersion: disabledPayload.data.version,
            reason: `${REASON} 移除独立复审${account.label}角色`,
            operator: "ignored",
          },
        });
        expect(unassigned.status(), await unassigned.text()).toBeLessThan(400);
      }
    } finally {
      await context.close();
    }
  }
  summary.finishedAt = new Date().toISOString();
  await writeFile(path.join(EVIDENCE_DIR, "browser-api-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(path.join(EVIDENCE_DIR, "README.txt"), [
    "K5 real Chromium and API acceptance evidence.",
    "Normal reads and writes used the live 3002 frontend and 8110 backend.",
    "Only the named 502 unknown-outcome response, 503, network abort and malformed-response Murphy branches used route injection.",
    "No password, access token, cookie, HAR, trace archive or video is stored in this folder.",
  ].join("\n"), "utf8");
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
    if (await page.locator("aside").isVisible().catch(() => false)) return;
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
}

function passwordFor(username: string) {
  if (username === ROOT_USERNAME) return ROOT_PASSWORD;
  if (username === RISK_USERNAME) return RISK_PASSWORD;
  if (username === READONLY_USERNAME) return READONLY_PASSWORD;
  return PASSWORD;
}

async function createTemporaryRiskAndOpenK5(page: Page) {
  temporaryRiskAccountId = await createTemporaryRoleAndOpenK5(
    page, RISK_USERNAME, "risk", TEMP_RISK_INITIAL_PASSWORD, RISK_PASSWORD, "风险");
}

async function createTemporaryReadonlyAndOpenK5(page: Page) {
  temporaryReadonlyAccountId = await createTemporaryRoleAndOpenK5(
    page, READONLY_USERNAME, "support", TEMP_READONLY_INITIAL_PASSWORD, READONLY_PASSWORD, "只读");
}

async function createTemporaryRoleAndOpenK5(
  page: Page,
  username: string,
  role: string,
  initialPassword: string,
  finalPassword: string,
  label: string,
) {
  if (!initialPassword) throw new Error(`K5 temporary ${label} initial password is required`);
  await login(page, ROOT_USERNAME);
  const created = await page.request.post("/api/admin/platform/accounts", {
    headers: { "Idempotency-Key": `${RUN_ID}-TEMP-${role.toUpperCase()}-CREATE` },
    data: {
      username,
      displayName: `K5 Independent ${label} ${RUN_ID.slice(-8)}`,
      email: `${username}@nexion.invalid`,
      role,
      deliver: "handoff",
      initialPassword,
      reason: `${REASON} 创建独立复审${label}账号`,
      operator: "ignored",
    },
  });
  expect(created.status(), await created.text()).toBeLessThan(400);
  const createdPayload = await envelope<{
    id?: string | number;
    accountId?: string | number;
    temporaryPassword?: string | null;
  }>(created);
  const accountId = String(createdPayload.data.id ?? createdPayload.data.accountId ?? "");
  expect(accountId).toBeTruthy();
  const issuedPassword = createdPayload.data.temporaryPassword;
  if (!issuedPassword) throw new Error(`K5 temporary ${label} credential was not returned`);
  await logout(page);
  await login(page, username, issuedPassword, finalPassword);
  await openK5FromSidebar(page);
  return accountId;
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

async function c4Status(page: Page) {
  const response = await page.request.get(`/api/admin/users/kyc/users/${REVIEW_USER_ID}`);
  expect(response.status()).toBe(200);
  const payload = await envelope<{ status: string }>(response);
  return payload.data.status;
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
