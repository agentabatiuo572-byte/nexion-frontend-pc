import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import net from "node:net";
import { chromium } from "playwright";
import sharp from "sharp";

const reportPath = process.argv[process.argv.indexOf("--report") + 1];
const socket = net.createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { windowsHide: true, stdio: "pipe" });
let serverLog = "";
for (const output of [server.stdout, server.stderr]) output.on("data", (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-6000); });
let browser;
const checks = [];
const mutations = [];
const errors = [];
const unhandled = new Set();
let activeAdminId = 7;
let activeRole = "superadmin";
let failNextMaintenance = false;
let failNextTransfer = false;
let failNextRules = false;
let failNextRules400 = false;
let failNextReply = false;
let rejectNextReply = false;
let holdCustomerDetail = false;
let releaseCustomerDetail = null;
let failNextCreate = false;
let failNextTicketDetail = false;
let restrictNextTicketDetail = false;
let blockedConversationDetailNo = "";
const unrepliedMessageIds = new Set();
let readCalls = 0;
let holdRulesWrite = false;
let releaseRulesWrite = null;
const stamp = "2026-09-29T08:00:00Z";
const customer = { customerId: 101, assignmentId: 501, agentAdminId: 7, version: 3, customerNo: "C-101", displayName: "测试客户甲", accountState: "UNKNOWN", maintenanceEnabled: true, maintenanceStatus: "DUE", lastEffectiveAt: null, nextMaintenanceAt: stamp, waitingReply: true, firstContact: false, maintenanceVersion: 2 };
const wireCustomer = () => ({ customerId: customer.customerId, assignmentId: customer.assignmentId, assignmentVersion: customer.version, agentAdminId: customer.agentAdminId, preferenceVersion: customer.maintenanceVersion, version: customer.maintenanceVersion, customerNo: customer.customerNo, nickname: customer.displayName, activityStatus: customer.accountState, windowStatus: "UNKNOWN", enabled: customer.maintenanceEnabled, lastEffectiveAt: customer.lastEffectiveAt, nextDueAt: customer.nextMaintenanceAt, due: customer.maintenanceEnabled, openCycleId: null, waitingReply: customer.waitingReply, firstContact: customer.firstContact, pendingReplyCount: customer.waitingReply ? 1 : 0, pendingConversationNo: customer.waitingReply ? "CV-101" : null, pendingThroughMessageId: customer.waitingReply ? 11 : null });
const pool = [{ customerId: 201, reason: "NO_INVITER", enteredAt: stamp, version: 1, displayName: "待分配甲", pendingMessageCount: 1 }, { customerId: 202, reason: "DEPTH_LIMIT", enteredAt: stamp, version: 1, displayName: "待分配乙", pendingMessageCount: 0 }];
const agent = { adminId: 7, name: "顾问甲", seatType: "DEDICATED", serviceTypes: ["advisor"], enabled: true, busy: false, assignedUserCount: 1, maxConcurrent: 5, currentActiveSessions: 1, version: 1 };
let rules = { version: 2, dormantDays: null, maintenanceDays: 7, activityWindowDays: null, inheritanceMode: "LIMITED", maxInheritanceDepth: 0, updatedAt: stamp, updatedBy: "fixture" };
const convo = { id: 1, conversationNo: "CV-101", customerId: 101, userId: 101, assignmentId: 501, ownerAdminId: 7, conversationType: "ADVISOR", status: "OPEN", ownerAgentId: "agent-7", ownerAgentName: "顾问甲", unreadCount: 1, version: 3, updatedAt: stamp, lastMessageAt: stamp, lastMessage: "请协助处理", lastMessageKind: "TEXT" };
const messages = [{ id: 11, senderType: "USER", senderName: "测试客户甲", content: "请协助处理", receiptStatus: "sent", createdAt: stamp }];
let extraConvo = null;
let bulkConvos = [];
const conversationDetailReads = [];
let convertedTicket = null;
const extraMessages = [];
const templateOverview = { categories: ["advisor", "support", "ai"].map((type) => ({ type, name: type, roleKey: type, managedBy: "客服", enabled: true, readOnly: type === "ai" })), advisorPolicy: { enabled: false, delayMs: 0, cooldownHours: 24, maxPerSession: 1, audience: "全部" }, workbenchPolicy: { timeoutFallback: false }, audienceOptions: ["全部"], segmentFields: [], scripts: [{ id: "quick-1", scriptGroup: "开场", text: "快捷话术只填稿", ctaPath: "", status: "published", audience: "全部" }], replyTemplates: [] };
const envelope = (data, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify({ code: status === 200 ? 0 : status, message: status === 200 ? "OK" : "FIXTURE_UNAVAILABLE", data }) });
const pageResult = (records, url) => ({ records, total: records.length, pageNum: Number(url.searchParams.get("pageNum") || 1), pageSize: Number(url.searchParams.get("pageSize") || 10) });
const session = { tokenType: "Bearer", session: { adminId: 7, username: "s5a-fixture", operator: "顾问甲", role: "superadmin", authorities: ["service_m1_read", "service_m1_write", "service_m2_read", "service_m3_read", "service_m3_write", "service_m4_read", "service_m5_read", "service_m5_write"], menuCodes: ["M", "M1", "M2", "M3", "M4", "M5"] } };
const check = async (id, page, act) => {
  const screenshot = `${reportPath ? dirname(reportPath) : process.cwd()}/${id}.png`;
  await mkdir(dirname(screenshot), { recursive: true });
  try { await act(); }
  catch (error) { await page.screenshot({ path: screenshot, fullPage: true }); throw error; }
  await page.screenshot({ path: screenshot, fullPage: true });
  checks.push({ id, status: "pass", evidence: [`Playwright browser assertion on ${page.url()}`, screenshot] });
};

try {
  let ready = false;
  for (let attempt = 0; attempt < 160; attempt++) {
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.ok(ready, serverLog);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, timezoneId: "America/Los_Angeles" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/admin/auth/session") return route.fulfill(envelope({ ...session, session: { ...session.session, adminId: activeAdminId, username: `s5a-fixture-${activeAdminId}`, operator: activeAdminId === 7 ? "顾问甲" : "顾问乙", role: activeRole, authorities: activeRole === "support" ? ["service_m1_read", "service_m3_read", "service_m5_read"] : activeRole === "supervisor" ? [...session.session.authorities, "service_m1_write"] : session.session.authorities } }));
    if (path === "/api/admin/platform/flags") return route.fulfill(envelope({}));
    if (path === "/api/admin/platform/audit/reason-policy") return route.fulfill(envelope({ minChars: 8, maxChars: 200, sourceKey: "admin.a2.reason_min_chars" }));
    if (path === "/api/admin/content/support-workbench/customers") {
      const bound = activeAdminId === 7 ? 1 : 0;
      return route.fulfill(envelope({ snapshotId: "fixture-snapshot", evaluatedAt: stamp, rulesVersion: rules.version, scope: { actorId: activeAdminId, agentAdminId: activeAdminId, mode: "AGENT" }, rules: { dormantDays: rules.dormantDays, maintenanceDays: rules.maintenanceDays, activityWindowDays: rules.activityWindowDays }, overview: { boundTotal: bound, activeTotal: null, dormantTotal: null, dueTotal: bound && customer.maintenanceEnabled ? 1 : 0, waitingReplyTotal: bound && customer.waitingReply ? 1 : 0, firstContactTotal: 0, stoppedTotal: bound && !customer.maintenanceEnabled ? 1 : 0, knownActiveCount: 0, unknownWindowCount: bound, unknownCount: bound, todoTotal: bound }, customers: { ...pageResult(bound ? [wireCustomer()] : [], url), filter: url.searchParams.get("filter") || "ALL", available: true }, performance: { executionCount: bound ? 6 : 0, successfulCycleCount: bound ? 3 : 0, successfulCustomerCount: bound ? 1 : 0, from: "2026-09-23T00:00:00Z", to: stamp, timeZone: "Asia/Shanghai", days: ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"].map((day, index) => ({ day, executionCount: bound ? index % 3 : 0, successfulCycleCount: bound ? index % 2 : 0 })) }, completeness: { unknownCount: bound, unknownWindowCount: bound, coverageStartAt: stamp, observedThroughAt: stamp, observationLagMillis: 0, activitySource: "INTERACTIVE_LOGIN" } }));
    }
    if (path === "/api/admin/content/support-workbench/customers/101") {
      if (holdCustomerDetail) await new Promise((resolve) => { releaseCustomerDetail = resolve; });
      return route.fulfill(activeAdminId === 7 ? envelope({ customer: wireCustomer() }) : envelope(null, 403));
    }
    if (path === "/api/admin/content/support-workbench/customers/101/maintenance/history") return route.fulfill(activeAdminId === 7 ? envelope({ customerId: 101, cycles: [{ id: 801, status: "OPEN", openedAt: "2026-09-29T08:00:00" }, { id: 802, status: "SUCCEEDED", openedAt: "2026-09-29T00:00:00Z" }], executions: [], totalCycles: 2, totalExecutions: 0, pageNum: 1, pageSize: 10 }) : envelope(null, 403));
    if (path === "/api/admin/content/support-workbench/customers/101/maintenance") {
      const body = request.postDataJSON();
      mutations.push({ path, body, key: request.headers()["idempotency-key"] });
      assert.equal(body.expectedAssignmentId, 501);
      assert.ok(body.reason.length >= 8);
      if (failNextMaintenance) { failNextMaintenance = false; return route.fulfill(envelope(null, 503)); }
      customer.maintenanceEnabled = body.enabled; customer.maintenanceStatus = body.enabled ? "DUE" : "STOPPED"; customer.maintenanceVersion += 1;
      return route.fulfill(envelope({ customerId: 101, assignmentId: 501, enabled: customer.maintenanceEnabled, version: customer.maintenanceVersion }));
    }
    if (path === "/api/admin/content/support-agents/binding-pool") return route.fulfill(envelope(pageResult(pool, url)));
    if (path === "/api/admin/content/support-agents" && activeRole === "supervisor") return route.fulfill(envelope({ agents: [{ ...agent, id: String(agent.adminId), email: "fixture@example.invalid", adminRole: "supervisor", status: "ACTIVE", position: "客服主管", tags: [], transferable: false, updatedAt: stamp }], advisorAssignments: [], transferTargets: [] }));
    if (path === "/api/admin/content/support-agents/page") return route.fulfill(envelope(pageResult([agent], url)));
    if (path === "/api/admin/content/support-agents/assignments/transfer" && method === "POST") {
      const body = request.postDataJSON(); mutations.push({ path, body, key: request.headers()["idempotency-key"] });
      if (failNextTransfer) { failNextTransfer = false; return route.fulfill(envelope(null, 409)); }
      for (const item of body.customers) if (item.expectedAssignmentId === null) { const index = pool.findIndex((row) => row.customerId === item.id); if (index >= 0) pool.splice(index, 1); }
      return route.fulfill(envelope(body.customers.map((item) => ({ customerId: item.id, id: 900 + item.id, agentAdminId: body.targetAgentAdminId, version: 2 }))));
    }
    if (path === "/api/admin/content/support-agents/rules") {
      if (method === "GET") return route.fulfill(envelope(rules));
      const body = request.postDataJSON(); mutations.push({ path, body, key: request.headers()["idempotency-key"] });
      if (holdRulesWrite) {
        await new Promise((resolve) => { releaseRulesWrite = resolve; });
        return route.fulfill(envelope({ ...rules, ...body, version: rules.version + 1 }));
      }
      if (failNextRules400) { failNextRules400 = false; return route.fulfill(envelope(null, 400)); }
      if (failNextRules) { failNextRules = false; rules = { ...rules, activityWindowDays: 4, version: rules.version + 1 }; return route.fulfill(envelope(null, 409)); }
      rules = { ...rules, ...body, version: rules.version + 1 }; return route.fulfill(envelope(rules));
    }
    if (path === "/api/admin/content/session-templates/overview") return route.fulfill(envelope(templateOverview));
    if (path === "/api/admin/content/conversations/attachments/policy") return route.fulfill(envelope({ available: true, allowedMimeTypes: ["image/png", "image/jpeg"], maxBytes: 5000000, maxPixels: 10000000, ttlSeconds: 86400, unavailableReason: null }));
    if (path === "/api/admin/content/conversations" && method === "GET") return route.fulfill(envelope(pageResult(activeAdminId === 7 ? [convo, ...(extraConvo ? [extraConvo] : []), ...bulkConvos] : [], url)));
    if (path === "/api/admin/content/conversations" && method === "POST") {
      const body = request.postDataJSON(); mutations.push({ path, body, key: request.headers()["idempotency-key"] });
      if (failNextCreate) { failNextCreate = false; return route.fulfill(envelope(null, 503)); }
      for (const target of body.replyTargets ?? []) if (target.conversationNo === "CV-101") for (const id of unrepliedMessageIds) if (id <= target.throughMessageId) unrepliedMessageIds.delete(id);
      extraConvo = { ...convo, id: 2, conversationNo: "CV-102", status: "OPEN", version: 1, unreadCount: 0, lastMessage: body.openingText };
      extraMessages.push({ id: 41, senderType: "AGENT", senderName: "顾问甲", content: body.openingText, createdAt: stamp });
      return route.fulfill(envelope({ conversationNo: "CV-102", messageId: 41, clientMessageId: body.clientMessageId, assignmentId: 501 }));
    }
    if (path === "/api/admin/content/conversations/CV-101") { conversationDetailReads.push(path); return route.fulfill(blockedConversationDetailNo === "CV-101" ? envelope(null, 503) : activeAdminId === 7 ? envelope({ conversation: convo, messages }) : envelope(null, 403)); }
    if (path === "/api/admin/content/conversations/CV-102") { conversationDetailReads.push(path); return route.fulfill(path.endsWith(blockedConversationDetailNo) && blockedConversationDetailNo ? envelope(null, 503) : activeAdminId === 7 && extraConvo ? envelope({ conversation: extraConvo, messages: extraMessages }) : envelope(null, 403)); }
    if (/^\/api\/admin\/content\/conversations\/CV-BULK-\d+$/.test(path)) { conversationDetailReads.push(path); const row = bulkConvos.find((item) => path.endsWith(item.conversationNo)); return route.fulfill(row && activeAdminId === 7 ? envelope({ conversation: row, messages: [] }) : envelope(null, 403)); }
    if (path.startsWith("/api/admin/content/support-workbench/commands/") && method === "GET") return route.fulfill(envelope(null, 404));
    if (path === "/api/admin/content/conversations/CV-101/replies" && method === "POST") {
      const body = request.postDataJSON(); mutations.push({ path, body, key: request.headers()["idempotency-key"] });
      assert.equal(body.expectedAssignmentId, 501);
      if (failNextReply) { failNextReply = false; return route.fulfill(envelope(null, 503)); }
      if (rejectNextReply) { rejectNextReply = false; return route.fulfill(envelope(null, 409)); }
      for (const target of body.replyTargets ?? []) if (target.conversationNo === "CV-101") for (const id of unrepliedMessageIds) if (id <= target.throughMessageId) unrepliedMessageIds.delete(id);
      const messageId = 12 + messages.length;
      messages.push({ id: messageId, senderType: "AGENT", senderName: "顾问甲", content: body.body ?? body.content, createdAt: stamp });
      convo.version += 1;
      customer.waitingReply = unrepliedMessageIds.size > 0;
      return route.fulfill(envelope({ conversationNo: "CV-101", messageId, clientMessageId: body.clientMessageId, assignmentId: 501 }));
    }
    if (path === "/api/admin/content/conversations/CV-101/status" && method === "PATCH") {
      const body = request.postDataJSON(); mutations.push({ path, body, key: request.headers()["idempotency-key"] });
      if (unrepliedMessageIds.size) return route.fulfill(envelope(null, 409));
      convo.status = body.status; convo.version += 1;
      return route.fulfill(envelope(convo));
    }
    if (path === "/api/admin/content/conversations/CV-101/ticket" && method === "POST") {
      const body = request.postDataJSON(); mutations.push({ path, body, key: request.headers()["idempotency-key"] });
      if (unrepliedMessageIds.size) return route.fulfill(envelope(null, 409));
      convertedTicket = { ticketNo: "T-101", sourceConversationNo: "CV-101", userId: 101, userExists: true, title: body.title, category: body.category, status: "OPEN", priority: body.priority, createdAt: stamp, updatedAt: stamp, assignedAdminId: 7, assignedAdminName: "顾问甲", version: 1, messages: [] };
      return route.fulfill(envelope({ ticketNo: "T-101" }));
    }
    if (path === "/api/admin/content/conversations/CV-101/read") { readCalls += 1; return route.fulfill(envelope({})); }
    if (path === "/api/admin/content/tickets") return route.fulfill(envelope(pageResult(convertedTicket ? [convertedTicket] : [], url)));
    if (path === "/api/admin/content/tickets/T-101" && convertedTicket) {
      if (failNextTicketDetail) { failNextTicketDetail = false; return route.fulfill(envelope(null, 503)); }
      if (restrictNextTicketDetail) { restrictNextTicketDetail = false; convertedTicket = { ...convertedTicket, contentRestricted: true }; }
      return route.fulfill(envelope({ ticket: convertedTicket, messages: [], slaTarget: { ruleVersion: 1, firstResponseMins: 30, resolutionHours: 24, queue: "客服", escalation: "主管", firstResponseDeadlineAt: stamp, resolutionDeadlineAt: stamp, firstResponseOverdue: false, resolutionOverdue: false, evaluatedAt: stamp } }));
    }
    if (path === "/api/admin/content/tickets/assignee-candidates") return route.fulfill(envelope([]));
    if (path === "/api/admin/content/conversations/transfer-targets") return route.fulfill(envelope([]));
    unhandled.add(`${method} ${path}`);
    return route.fulfill(envelope(null, 503));
  });

  await page.goto(`${origin}/service/overview`);
  await check("s5a-dashboard", page, async () => {
    await page.getByRole("heading", { name: "我的工作台" }).waitFor();
    assert.equal(await page.locator('[data-proof="s5a-workbench"]').count(), 1);
    await page.getByText("活动数据待确认", { exact: false }).waitFor();
    assert.match(await page.locator("body").innerText(), /统计于/);
    assert.match(await page.locator("body").innerText(), /待办客户/);
    assert.match(await page.locator("body").innerText(), /最近会话/);
    assert.match(await page.locator("body").innerText(), /维护趋势/);
    assert.match(await page.locator("body").innerText(), /暂停主动维护/);
    assert.equal(await page.locator(".s5a-trend-day").count(), 7);
    assert.match(await page.locator(".s5a-trend").innerText(), /紫色：执行次数/);
    await page.screenshot({ path: `${reportPath ? dirname(reportPath) : process.cwd()}/s5a-dashboard-top.png`, fullPage: true });
    await page.locator(".s5a-progress-grid").scrollIntoViewIfNeeded();
    const lower = `${reportPath ? dirname(reportPath) : process.cwd()}/s5a-dashboard-lower.png`;
    await page.screenshot({ path: lower, fullPage: true });
  });
  checks.at(-1).evidence.push(`${reportPath ? dirname(reportPath) : process.cwd()}/s5a-dashboard-top.png`);
  checks.at(-1).evidence.push(`${reportPath ? dirname(reportPath) : process.cwd()}/s5a-dashboard-lower.png`);
  await check("s5a-customers", page, async () => {
    assert.equal(await page.locator('[data-proof="s5a-workbench"]').count(), 1);
    await page.getByRole("navigation", { name: "客服工作区" }).getByRole("button", { name: "我的客户" }).click();
    await page.getByRole("button", { name: "测试客户甲" }).click();
    await page.getByRole("dialog", { name: "客户详情" }).waitFor();
    await page.getByRole("dialog", { name: "客户详情" }).getByText("未知", { exact: true }).waitFor();
    await page.getByRole("button", { name: /查看维护记录/ }).click();
    const historyRows = page.getByRole("dialog", { name: "客户详情" }).locator(".s5a-history li");
    await historyRows.first().waitFor();
    assert.match(await historyRows.first().innerText(), /维护周期.*进行中/);
    assert.match(await historyRows.nth(1).innerText(), /维护周期.*已完成/);
    assert.match(await historyRows.first().innerText(), /2026年9月28日 17:00/);
    assert.match(await historyRows.nth(1).innerText(), /2026年9月28日 17:00/);
    await page.getByRole("button", { name: "不再维护" }).click();
    await page.getByRole("textbox", { name: /操作理由/ }).fill("测试客户请求暂停主动维护");
    await page.getByRole("button", { name: "确认", exact: true }).click();
    assert.equal(customer.maintenanceEnabled, false);
    assert.ok(mutations.some((item) => item.path.endsWith("/maintenance") && item.key));
    await page.getByRole("button", { name: "关闭客户详情" }).click();
    await page.getByRole("button", { name: "测试客户甲" }).waitFor();
    const rowText = await page.getByRole("row").filter({ has: page.getByRole("button", { name: "测试客户甲" }) }).innerText();
    assert.match(rowText, /暂停主动维护/);
    assert.doesNotMatch(rowText, /待维护/);
  });
  await check("s5a-detail-gate", page, async () => {
    holdCustomerDetail = true;
    await page.goto(`${origin}/service/sessions`);
    await page.locator(".cv-item").first().waitFor();
    for (let attempt = 0; attempt < 30 && !releaseCustomerDetail; attempt++) await page.waitForTimeout(100);
    assert.ok(releaseCustomerDetail, "客户归属查询必须实际挂起");
    assert.equal(await page.getByRole("textbox", { name: "输入会话消息" }).isDisabled(), true, "归属及待回复状态未知时不得发送");
    holdCustomerDetail = false; releaseCustomerDetail(); releaseCustomerDetail = null;
    await page.waitForFunction(() => !document.querySelector('textarea[aria-label="输入会话消息"]')?.disabled);
  });
  await check("s5a-conversation", page, async () => {
    await page.goto(`${origin}/service/sessions`);
    await page.getByRole("region", { name: "专属客服会话" }).waitFor();
    assert.equal(await page.getByRole("region", { name: "专属客服会话" }).count(), 1);
    await page.getByText("请协助处理").first().waitFor();
    await page.getByRole("textbox", { name: "输入会话消息" }).fill("已收到，正在处理");
    const reply = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/conversations/CV-101/replies"));
    await page.getByRole("button", { name: /发送文字/ }).click();
    await reply;
    assert.ok(mutations.some((item) => item.path.endsWith("/replies") && item.body.clientMessageId));
    await page.getByText("已收到，正在处理").waitFor();
  });
  await check("s5a-dock", page, async () => {
    messages.push({ id: 13, senderType: "USER", senderName: "测试客户甲", content: "旧待回复问题", createdAt: stamp });
    unrepliedMessageIds.add(13);
    customer.waitingReply = true;
    convo.version = 4;
    await page.goto(`${origin}/service/overview`);
    await page.locator('[data-proof="session-dock-pill"]').waitFor();
    await page.locator('[data-proof="session-dock-pill"]').click();
    await page.locator('[data-proof="session-dock-reply"]').fill("浮窗待确认回复");
    failNextReply = true;
    await page.getByRole("button", { name: "发送会话回复" }).click();
    await page.getByRole("alert").filter({ hasText: "发送失败或结果待确认" }).waitFor();
    const first = mutations.filter((item) => item.path.endsWith("/replies") && item.body.body === "浮窗待确认回复").at(-1);
    assert.ok(first?.key);
    assert.deepEqual(first.body.replyTargets, [{ conversationNo: "CV-101", throughMessageId: 13 }]);
    messages.push({ id: 14, senderType: "USER", senderName: "测试客户甲", content: "新待回复问题", createdAt: stamp });
    unrepliedMessageIds.add(14);
    convo.version = 5;
    await page.reload();
    await page.locator('[data-proof="session-dock-panel"]').waitFor();
    assert.equal(await page.locator('[data-proof="session-dock-reply"]').inputValue(), "浮窗待确认回复");
    await page.getByRole("button", { name: "查询结果并重试会话回复" }).click();
    await page.waitForFunction(() => document.querySelector('[data-proof="session-dock-reply"]')?.value === "");
    const attempts = mutations.filter((item) => item.path.endsWith("/replies") && item.body.body === "浮窗待确认回复");
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].key, first.key);
    assert.deepEqual(attempts[1].body, first.body);
    assert.deepEqual([...unrepliedMessageIds], [14]);
    await page.locator('[data-proof="session-dock-reply"]').fill("浮窗关闭段待确认");
    failNextReply = true;
    await page.getByRole("button", { name: "发送会话回复" }).click();
    await page.getByRole("alert").filter({ hasText: "发送失败或结果待确认" }).waitFor();
    convo.status = "CLOSED";
    await page.reload();
    await page.locator('[data-proof="session-dock-panel"]').waitFor();
    await page.getByRole("button", { name: "查询结果并重试会话回复" }).click();
    await page.getByRole("alert").filter({ hasText: "原命令未找到" }).waitFor();
    convo.status = "OPEN";
    await page.reload();
    await page.getByRole("button", { name: "查询结果并重试会话回复" }).click();
    await page.waitForFunction(() => document.querySelector('[data-proof="session-dock-reply"]')?.value === "");
    await page.locator('[data-proof="session-dock-reply"]').fill("剪贴板拒绝后手工保存的原文");
    failNextReply = true;
    await page.getByRole("button", { name: "发送会话回复" }).click();
    await page.getByRole("alert").filter({ hasText: "发送失败或结果待确认" }).waitFor();
    convo.status = "CLOSED";
    await page.reload();
    await page.getByRole("button", { name: "查询结果并重试会话回复" }).click();
    await page.getByRole("button", { name: "复制原文" }).waitFor();
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
    await page.getByRole("button", { name: "复制原文" }).click();
    await page.getByRole("alert").filter({ hasText: "手动选择并复制" }).waitFor();
    const originalBox = page.locator('[data-proof="session-dock-reply"]');
    assert.equal(await originalBox.isDisabled(), false);
    assert.equal(await originalBox.getAttribute("readonly"), "");
    assert.equal(await originalBox.evaluate((node) => { node.select(); return node.selectionEnd - node.selectionStart; }), "剪贴板拒绝后手工保存的原文".length);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "放弃查询" }).click();
    await page.getByRole("button", { name: "放弃查询" }).waitFor({ state: "hidden" });
    convo.status = "OPEN";
  });
  await check("s5a-private-retry-original", page, async () => {
    await page.goto(`${origin}/service/sessions`);
    await page.getByRole("textbox", { name: "输入会话消息" }).fill("结果未知后同键重试");
    failNextReply = true;
    await page.getByRole("button", { name: "发送文字" }).click();
    await page.getByRole("alert").filter({ hasText: "发送失败或结果待确认" }).waitFor();
    const first = mutations.filter((item) => item.path.endsWith("/replies") && item.body.body === "结果未知后同键重试").at(-1);
    assert.ok(first?.key);
    messages.push({ id: 20, senderType: "USER", senderName: "测试客户甲", content: "失败期间新到的消息", createdAt: stamp });
    unrepliedMessageIds.add(20); convo.version += 1;
    blockedConversationDetailNo = "CV-101";
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "会话详情读取失败" }).waitFor();
    await page.getByRole("button", { name: "查询结果并重试" }).click();
    await page.getByRole("alert").filter({ hasText: "原命令未找到" }).waitFor();
    assert.equal(mutations.filter((item) => item.path.endsWith("/replies") && item.body.body === "结果未知后同键重试").length, 1);
    blockedConversationDetailNo = "";
    await page.getByLabel("会话消息", { exact: true }).getByRole("button", { name: "重试读取详情" }).click();
    await page.getByLabel("会话消息", { exact: true }).getByText("失败期间新到的消息").waitFor();
    await page.getByRole("button", { name: "查询结果并重试" }).click();
    for (let attempt = 0; attempt < 50 && mutations.filter((item) => item.path.endsWith("/replies") && item.body.body === "结果未知后同键重试").length < 2; attempt++) await page.waitForTimeout(100);
    const attempts = mutations.filter((item) => item.path.endsWith("/replies") && item.body.body === "结果未知后同键重试");
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].key, first.key);
    assert.deepEqual(attempts[1].body, first.body);
    assert.deepEqual([...unrepliedMessageIds], [20]);
  });
  await check("s5a-definitive-rejection", page, async () => {
    await page.goto(`${origin}/service/sessions`);
    await page.getByRole("textbox", { name: "输入会话消息" }).fill("旧版本明确被拒绝");
    rejectNextReply = true;
    await page.getByRole("button", { name: "发送文字" }).click();
    await page.getByRole("alert").filter({ hasText: "服务端已拒绝本次发送" }).waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea[aria-label="输入会话消息"]')?.disabled);
    assert.equal(await page.getByRole("textbox", { name: "输入会话消息" }).isEnabled(), true);
    await page.getByRole("textbox", { name: "输入会话消息" }).fill("根据新版本修改后重发");
    assert.equal(await page.getByRole("button", { name: "查询结果并重试" }).count(), 0);
    assert.equal(await page.evaluate(() => (sessionStorage.getItem("nexion-admin-m3-private-pending-v1") || "").includes("旧版本明确被拒绝")), false);
  });
  await check("s5a-new-message-reply-target", page, async () => {
    unrepliedMessageIds.clear(); customer.waitingReply = false;
    await page.goto(`${origin}/service/sessions`);
    await page.locator(".cv-item.on .cv-stat").getByText("已处理").waitFor();
    messages.push({ id: 21, senderType: "USER", senderName: "测试客户甲", content: "实时新增待回复", receiptStatus: "sent", createdAt: stamp });
    unrepliedMessageIds.add(21); customer.waitingReply = true; convo.version += 1;
    await page.getByLabel("会话消息", { exact: true }).getByText("实时新增待回复").waitFor({ timeout: 20000 });
    await page.getByRole("textbox", { name: "输入会话消息" }).fill("收到实时新消息后回复");
    const replyResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/conversations/CV-101/replies"));
    await page.getByRole("button", { name: "发送文字" }).click();
    await replyResponse;
    const reply = mutations.filter((item) => item.path.endsWith("/replies") && item.body.body === "收到实时新消息后回复").at(-1);
    assert.deepEqual(reply?.body.replyTargets, [{ conversationNo: "CV-101", throughMessageId: 21 }]);
    assert.equal(unrepliedMessageIds.has(21), false);
  });
  await check("s5b-preflight-new-message", page, async () => {
    await page.goto(`${origin}/service/sessions`);
    await page.getByRole("textbox", { name: "输入会话消息" }).fill("预检后回复新消息");
    messages.push({ id: 22, senderType: "USER", senderName: "测试客户甲", content: "发送前新到的消息", receiptStatus: "sent", createdAt: stamp });
    unrepliedMessageIds.add(22); customer.waitingReply = true; convo.version += 1;
    await page.getByRole("button", { name: "发送文字" }).click();
    await page.getByRole("alert").filter({ hasText: "会话有新消息" }).waitFor();
    assert.equal(mutations.filter((item) => item.path.endsWith("/replies") && item.body.body === "预检后回复新消息").length, 0);
    await page.getByLabel("会话消息", { exact: true }).getByText("发送前新到的消息").waitFor();
    await page.getByRole("button", { name: "发送文字" }).click();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="输入会话消息"]')?.value === "");
    const reply = mutations.filter((item) => item.path.endsWith("/replies") && item.body.body === "预检后回复新消息").at(-1);
    assert.deepEqual(reply?.body.replyTargets, [{ conversationNo: "CV-101", throughMessageId: 22 }]);
  });
  await check("s5a-pool", page, async () => {
    await page.goto(`${origin}/service/overview`);
    await page.getByRole("button", { name: "待绑定客户池" }).click();
    await page.getByRole("checkbox", { name: "选择客户 201" }).check();
    assert.equal(await page.getByRole("checkbox", { name: "选择或取消当前页客户" }).evaluate((node) => node.indeterminate), true);
    await page.getByRole("button", { name: /批量分配已选 1 位/ }).click();
    await page.getByLabel("选择接待顾问").selectOption("7");
    await page.getByRole("textbox", { name: /分配原因/ }).fill("测试人工分配明确客户范围");
    await page.getByRole("button", { name: /确认分配 1 位/ }).click();
    const write = mutations.find((item) => item.path.endsWith("/assignments/transfer"));
    assert.deepEqual(write.body.customers.map((item) => item.id), [201]);
    await page.getByRole("dialog", { name: "确认分配客户" }).waitFor({ state: "hidden" });
    await page.getByRole("checkbox", { name: "选择客户 202" }).waitFor();
  });
  await check("s5a-rules", page, async () => {
    await page.goto(`${origin}/service/scripts`);
    await page.getByRole("region", { name: "服务规则" }).waitFor();
    assert.equal(await page.getByRole("region", { name: "服务规则" }).count(), 1);
    await page.getByLabel("活跃统计窗口天数").fill("5");
    await page.getByRole("button", { name: "预览并保存" }).click();
    await page.getByRole("textbox", { name: /修改理由/ }).fill("测试启用活跃统计窗口规则");
    await page.getByRole("button", { name: "确认保存" }).click();
    assert.equal(rules.activityWindowDays, 5);
    assert.equal(rules.dormantDays, null);
    await page.getByRole("dialog", { name: "确认保存服务规则" }).waitFor({ state: "hidden" });
  });
  await check("s5a-identity-revocation", page, async () => {
    await page.goto(`${origin}/service/sessions`);
    await page.getByRole("region", { name: "专属客服会话" }).waitFor();
    await page.getByRole("button", { name: /测试客户甲|用户 U-00101/ }).first().click();
    await page.getByRole("textbox", { name: "输入会话消息" }).fill("切换身份前的未发送草稿");
    const input = page.getByLabel("选择图片");
    const validImage = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#20a0dc" } }).png().toBuffer();
    await input.setInputFiles({ name: "private.png", mimeType: "image/png", buffer: validImage });
    await page.getByAltText("待发送图片预览").waitFor();
    const priorBlobUrl = await page.getByAltText("待发送图片预览").getAttribute("src");
    const tooManyPixels = await sharp({ create: { width: 4000, height: 3000, channels: 4, background: "#20a0dc" } }).png().toBuffer();
    await input.setInputFiles({ name: "too-large.png", mimeType: "image/png", buffer: tooManyPixels });
    await page.getByText("图片像素超过当前上限，请重新选择。").waitFor();
    assert.equal(await page.getByAltText("待发送图片预览").getAttribute("src"), priorBlobUrl);
    await page.evaluate(() => { const original = URL.revokeObjectURL.bind(URL); window.__s5aRevoked = []; URL.revokeObjectURL = (url) => { window.__s5aRevoked.push(url); original(url); }; });
    activeAdminId = 8;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText("顾问乙", { exact: true }).first().waitFor();
    await page.getByRole("region", { name: "专属客服会话" }).waitFor();
    assert.equal(await page.getByText("切换身份前的未发送草稿").count(), 0);
    assert.equal(await page.getByAltText("待发送图片预览").count(), 0);
    assert.ok(await page.evaluate((url) => window.__s5aRevoked.includes(url), priorBlobUrl));
    await page.goto(`${origin}/service/overview`);
    await page.getByRole("heading", { name: "我的工作台" }).waitFor();
    assert.equal(await page.getByText("测试客户甲").count(), 0);
  });
  await check("s5a-pending-identity", page, async () => {
    activeAdminId = 7;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.goto(`${origin}/service/sessions`);
    await page.getByLabel("本条消息用途").selectOption("MAINTENANCE");
    await page.getByRole("textbox", { name: "输入会话消息" }).fill("待确认的私聊内容仅属于顾问甲");
    failNextReply = true;
    const replyResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/conversations/CV-101/replies"));
    await page.getByRole("button", { name: /发送文字/ }).click();
    await replyResponse;
    assert.ok(mutations.some((item) => item.path.endsWith("/replies") && (item.body.content ?? item.body.body) === "待确认的私聊内容仅属于顾问甲"), JSON.stringify(mutations.slice(-2)));
    await page.getByText(/发送失败或结果待确认/).waitFor();
    assert.match(await page.evaluate(() => sessionStorage.getItem("nexion-admin-m3-private-pending-v1") || ""), /待确认的私聊内容仅属于顾问甲/);
    await page.reload();
    await page.getByRole("textbox", { name: "输入会话消息" }).waitFor();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="输入会话消息"]')?.value === "待确认的私聊内容仅属于顾问甲");
    assert.equal(await page.getByRole("textbox", { name: "输入会话消息" }).inputValue(), "待确认的私聊内容仅属于顾问甲");
    assert.equal(await page.getByLabel("本条消息用途").inputValue(), "MAINTENANCE");
    activeAdminId = 8;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText("顾问乙", { exact: true }).first().waitFor();
    assert.ok(!(await page.evaluate(() => sessionStorage.getItem("nexion-admin-m3-private-pending-v1") || "")).includes("待确认的私聊内容仅属于顾问甲"));
    assert.equal(await page.getByText("待确认的私聊内容仅属于顾问甲").count(), 0);
  });
  await check("s5a-delayed-rules-identity", page, async () => {
    await page.goto(`${origin}/service/scripts`);
    await page.getByRole("region", { name: "服务规则" }).waitFor();
    await page.getByLabel("活跃统计窗口天数").fill("6");
    await page.getByRole("button", { name: "预览并保存" }).click();
    await page.getByRole("textbox", { name: /修改理由/ }).fill("测试旧账号延迟回包隔离");
    holdRulesWrite = true;
    await page.getByRole("button", { name: "确认保存" }).click();
    await page.getByText("保存中…").waitFor();
    activeAdminId = 7;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText("顾问甲", { exact: true }).first().waitFor();
    await page.getByRole("region", { name: "服务规则" }).waitFor();
    await page.getByLabel("活跃统计窗口天数").waitFor();
    assert.equal(await page.getByLabel("活跃统计窗口天数").inputValue(), "5");
    assert.ok(!(await page.evaluate(() => sessionStorage.getItem("nexion-admin-m-support-rules-v1")))?.includes("测试旧账号延迟回包隔离"));
    releaseRulesWrite?.();
    holdRulesWrite = false;
    await page.waitForTimeout(100);
    assert.equal(await page.getByLabel("活跃统计窗口天数").inputValue(), "5");
    assert.equal(await page.getByText("测试旧账号延迟回包隔离").count(), 0);
    await page.getByRole("button", { name: "话术与模板" }).click();
    await page.getByText("即时回复模板库").waitFor();
    assert.equal(await page.getByText("暂无可展示的 M 客服中心真实数据").count(), 0);
  });
  await check("s5a-drawer-identity", page, async () => {
    await page.goto(`${origin}/service/overview`);
    await page.getByRole("navigation", { name: "客服工作区" }).getByRole("button", { name: "我的客户" }).click();
    await page.getByRole("button", { name: "测试客户甲" }).click();
    await page.getByRole("dialog", { name: "客户详情" }).getByText("未知", { exact: true }).waitFor();
    await page.getByRole("button", { name: "恢复维护" }).click();
    await page.getByRole("textbox", { name: /操作理由/ }).fill("测试旧账号的未提交维护理由");
    activeAdminId = 8;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText("顾问乙", { exact: true }).first().waitFor();
    assert.equal(await page.getByRole("dialog", { name: "客户详情" }).count(), 0);
    assert.equal(await page.getByText("测试旧账号的未提交维护理由").count(), 0);
    assert.equal(await page.getByText("测试客户甲").count(), 0);
  });
  await check("s5a-narrow", page, async () => {
    activeAdminId = 7;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText("顾问甲", { exact: true }).first().waitFor();
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${origin}/service/overview`);
    await page.getByRole("heading", { name: "我的工作台" }).waitFor();
    assert.equal(await page.locator('[data-proof="s5a-workbench"]').count(), 1);
    await page.getByRole("navigation", { name: "客服工作区" }).getByRole("button", { name: "我的客户" }).click();
    await page.getByRole("button", { name: "测试客户甲" }).waitFor();
    assert.ok(await page.locator("main").evaluate((main) => main.scrollWidth <= main.clientWidth + 2));
    await page.getByRole("button", { name: "M 客服中心" }).click();
    await page.getByRole("link", { name: /专属会话/ }).waitFor();
    await page.getByRole("button", { name: "关闭侧栏" }).click({ position: { x: 340, y: 300 } });
    await page.goto(`${origin}/service/sessions`);
    await page.locator(".cv-item").first().waitFor();
    await page.locator(".cv-item").first().click();
    await page.getByRole("button", { name: "返回会话列表" }).click();
    assert.equal(await page.locator(".m3-col-list").first().isVisible(), true);
  });
  await check("s5a-maintenance-failure", page, async () => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${origin}/service/overview`);
    await page.getByRole("navigation", { name: "客服工作区" }).getByRole("button", { name: "我的客户" }).click();
    await page.getByRole("button", { name: "测试客户甲" }).click();
    await page.getByRole("button", { name: "恢复维护" }).click();
    const reason = "测试请求失败后保持人工理由";
    await page.getByRole("textbox", { name: /操作理由/ }).fill(reason);
    failNextMaintenance = true;
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await page.getByRole("dialog", { name: "客户详情" }).getByRole("alert").getByText(/操作结果待确认/).first().waitFor();
    assert.equal(await page.getByRole("textbox", { name: /操作理由/ }).inputValue(), reason);
    await page.getByRole("button", { name: "用原命令重试" }).click();
    await page.getByRole("button", { name: "不再维护" }).waitFor();
    const attempts = mutations.filter((item) => item.path.endsWith("/maintenance") && item.body.enabled === true);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].key, attempts[1].key);
  });
  await check("s5a-agent-permission", page, async () => {
    activeRole = "support";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("heading", { name: "我的工作台" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "待绑定客户池" }).count(), 0);
    await page.goto(`${origin}/service/sessions`);
    await page.getByText("当前账号只可查看会话，发送需会话操作权限。").waitFor();
    assert.equal(await page.getByRole("textbox", { name: "输入会话消息" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "关闭服务会话" }).count(), 0);
    await page.goto(`${origin}/service/scripts`);
    await page.getByRole("heading", { name: "服务规则与话术" }).waitFor();
    assert.equal(await page.getByRole("region", { name: "服务规则" }).count(), 0);
    assert.equal(await page.getByLabel("活跃统计窗口天数").count(), 0);
  });
  await check("s5a-rules-conflict", page, async () => {
    activeRole = "superadmin";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("region", { name: "服务规则" }).waitFor();
    await page.getByLabel("活跃统计窗口天数").fill("6");
    await page.getByRole("button", { name: "预览并保存" }).click();
    await page.getByRole("textbox", { name: /修改理由/ }).fill("测试规则版本冲突后人工重审");
    failNextRules = true;
    await page.getByRole("button", { name: "确认保存" }).click();
    await page.getByRole("button", { name: "以最新规则重审" }).waitFor();
    assert.equal(await page.getByLabel("活跃统计窗口天数").inputValue(), "6");
    await page.getByRole("button", { name: "以最新规则重审" }).click();
    assert.equal(await page.getByLabel("活跃统计窗口天数").inputValue(), "6");
    await page.getByRole("button", { name: "预览并保存" }).click();
    await page.getByRole("textbox", { name: /修改理由/ }).fill("测试规则冲突重审后确认保存");
    await page.getByRole("button", { name: "确认保存" }).click();
    assert.equal(rules.activityWindowDays, 6);
  });
  await check("s5b-rules-definite-400", page, async () => {
    await page.getByLabel("活跃统计窗口天数").fill("7");
    await page.getByRole("button", { name: "预览并保存" }).click();
    await page.getByRole("textbox", { name: /修改理由/ }).fill("测试后端明确校验失败后可修改");
    failNextRules400 = true;
    await page.getByRole("button", { name: "确认保存" }).click();
    await page.getByText("输入未通过校验，请检查天数、继承层数和修改理由后再提交。").first().waitFor();
    assert.equal(await page.getByLabel("活跃统计窗口天数").isEnabled(), true);
  });
  await check("s5a-pool-conflict", page, async () => {
    await page.goto(`${origin}/service/overview`);
    await page.getByRole("button", { name: "待绑定客户池" }).click();
    await page.getByRole("checkbox", { name: "选择客户 202" }).check();
    await page.getByRole("button", { name: /批量分配已选 1 位/ }).click();
    await page.getByLabel("选择接待顾问").selectOption("7");
    await page.getByRole("textbox", { name: /分配原因/ }).fill("测试版本冲突保留人工选择");
    failNextTransfer = true;
    await page.getByRole("button", { name: /确认分配 1 位/ }).click();
    await page.getByRole("alert").getByText(/资料已变化|版本/).first().waitFor();
    const dialog = page.getByRole("dialog", { name: "确认分配客户" });
    assert.match(await dialog.innerText(), /客户 ID 202/);
    assert.equal(await dialog.getByRole("textbox", { name: /分配原因/ }).inputValue(), "测试版本冲突保留人工选择");
  });
  await check("s5a-m3-actions", page, async () => {
    messages.push({ id: 30, senderType: "USER", senderName: "测试客户甲", content: "请再次核对", receiptStatus: "sent", createdAt: stamp });
    unrepliedMessageIds.add(30); convo.version += 1;
    await page.setViewportSize({ width: 375, height: 667 });
    const readsBefore = readCalls;
    await page.goto(`${origin}/service/sessions`);
    await page.locator(".cv-item").first().waitFor();
    await page.waitForTimeout(200);
    assert.equal(readCalls, readsBefore, "列表未打开消息时不得标已读");
    await page.locator(".cv-item").first().click();
    await page.waitForFunction(() => document.querySelector('.m3-col-chat')?.getClientRects().length === 1);
    const mobileSend = page.getByRole("button", { name: "发送文字" });
    await mobileSend.scrollIntoViewIfNeeded();
    const sendBox = await mobileSend.boundingBox();
    assert.ok(sendBox && sendBox.y >= 0 && sendBox.y + sendBox.height <= 667, "窄屏发送按钮必须在滚动后完整可点");
    await page.setViewportSize({ width: 360, height: 240 });
    assert.ok(await page.locator(".m3-stage").evaluate((node) => node.getBoundingClientRect().height >= 340), "400% 缩放后会话台不能塌陷");
    await mobileSend.scrollIntoViewIfNeeded();
    const zoomSendBox = await mobileSend.boundingBox();
    assert.ok(zoomSendBox && zoomSendBox.y >= 0 && zoomSendBox.y + zoomSendBox.height <= 240, "400% 缩放后发送按钮必须可滚动到可视区");
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${origin}/service/sessions`);
    assert.ok(await page.locator(".m3-col-chat").evaluate((node) => node.getBoundingClientRect().width > 500), "桌面聊天栏必须是主区域");
    assert.equal(await page.getByRole("link", { name: "工单详情" }).count(), 0, "没有权威工单前不显示详情入口");
    await page.getByText("快捷话术", { exact: true }).click();
    await page.getByRole("button", { name: /快捷话术只填稿/ }).click();
    assert.equal(await page.getByRole("textbox", { name: "输入会话消息" }).inputValue(), "快捷话术只填稿");
    assert.equal(mutations.filter((item) => item.path.endsWith("/replies") && item.body.body === "快捷话术只填稿").length, 0);
    await page.getByLabel("本条消息用途").selectOption("MAINTENANCE");
    await page.getByRole("textbox", { name: "输入会话消息" }).fill("人工维护消息不清待回复");
    await page.getByRole("button", { name: "发送文字" }).click();
    for (let attempt = 0; attempt < 50 && !mutations.some((item) => item.path.endsWith("/replies") && (item.body.content ?? item.body.body) === "人工维护消息不清待回复"); attempt++) await page.waitForTimeout(100);
    await page.getByRole("button", { name: "发送文字" }).waitFor();
    const maintenance = mutations.filter((item) => item.path.endsWith("/replies") && (item.body.content ?? item.body.body) === "人工维护消息不清待回复").at(-1);
    assert.equal(maintenance.body.intent, "MAINTENANCE");
    assert.equal(maintenance.body.replyTargets, undefined);
    assert.equal(unrepliedMessageIds.has(30), true);
    await page.getByText("更多操作", { exact: true }).click();
    await page.getByRole("button", { name: "关闭服务会话" }).click();
    await page.getByRole("alert").filter({ hasText: "还有客户消息待回复" }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: /操作理由/ }).count(), 0);
    await page.getByLabel("本条消息用途").selectOption("SERVICE");
    await page.getByRole("textbox", { name: "输入会话消息" }).fill("服务回复处理旧待办");
    await page.getByRole("button", { name: "发送文字" }).click();
    await page.getByLabel("会话消息", { exact: true }).getByText("服务回复处理旧待办").waitFor();
    assert.equal(unrepliedMessageIds.size, 0);
    await page.locator(".cv-item.on .cv-stat").getByText("已处理").waitFor();
    await page.getByLabel("本条消息用途").selectOption("MAINTENANCE");
    assert.equal(await page.getByRole("checkbox", { name: /同时标记本会话最近一条客户消息已处理/ }).count(), 0);
    await page.getByRole("button", { name: "转工单" }).click();
    await page.getByRole("textbox", { name: /操作理由/ }).fill("测试跨班次内部跟进工单");
    await page.getByRole("button", { name: "确认提交" }).click();
    await page.getByRole("button", { name: "转工单" }).waitFor();
    assert.ok(mutations.some((item) => item.path.endsWith("/ticket") && item.body.expectedVersion));
    await page.waitForFunction(() => Boolean(document.querySelector('.m3-more-menu a[href*="T-101"]')));
    if (!await page.locator(".m3-more").evaluate((node) => node.open)) await page.getByText("更多操作", { exact: true }).click();
    await page.getByRole("link", { name: "工单详情" }).click();
    await page.getByRole("textbox", { name: /搜索/ }).waitFor();
    assert.match(page.url(), /query=T-101/);
    await page.locator(".tk-drawer").filter({ hasText: "T-101" }).waitFor();
    await page.goto(`${origin}/service/sessions`);
    await page.getByText("更多操作", { exact: true }).click();
    await page.getByRole("link", { name: "工单详情" }).click();
    await page.locator(".tk-drawer").filter({ hasText: "T-101" }).waitFor();
  });
  await check("s5a-m3-close-continue", page, async () => {
    await page.goto(`${origin}/service/sessions`);
    await page.getByText("更多操作", { exact: true }).click();
    await page.getByRole("button", { name: "关闭服务会话" }).click();
    await page.getByRole("textbox", { name: /操作理由/ }).fill("测试结束当前服务会话并保留归属");
    await page.getByRole("button", { name: "确认提交" }).click();
    for (let attempt = 0; attempt < 50 && convo.status !== "CLOSED"; attempt++) await page.waitForTimeout(100);
    assert.equal(convo.status, "CLOSED");
    assert.equal(customer.agentAdminId, 7);
    messages.push({ id: 40, senderType: "USER", senderName: "测试客户甲", content: "历史关闭段遗留问题", receiptStatus: "sent", createdAt: stamp });
    messages.push({ id: 41, senderType: "SYSTEM", senderName: "系统", content: "会话已关闭", receiptStatus: "sent", createdAt: stamp });
    unrepliedMessageIds.add(40);
    await page.reload();
    await page.getByRole("button", { name: "接续回复" }).click();
    await page.getByText(/处理旧会话 CV-101 的客户消息/).waitFor();
    assert.equal(await page.getByRole("checkbox", { name: /处理旧会话 CV-101/ }).isChecked(), false);
    await page.getByRole("button", { name: "取消接续" }).click();
    assert.equal(unrepliedMessageIds.has(40), true);
    await page.getByRole("button", { name: "接续回复" }).click();
    await page.getByRole("checkbox", { name: /处理旧会话 CV-101/ }).check();
    await page.getByLabel("本条消息用途").selectOption("MAINTENANCE");
    await page.getByRole("textbox", { name: "输入会话消息" }).fill("新会话明确处理旧消息");
    assert.match(page.url(), /customerId=101/);
    failNextCreate = true;
    await page.getByRole("button", { name: "发送文字" }).click();
    await page.getByRole("alert").filter({ hasText: "发送失败或结果待确认" }).waitFor();
    const first = mutations.filter((item) => item.path === "/api/admin/content/conversations" && item.body.openingText === "新会话明确处理旧消息").at(-1);
    assert.equal(first.body.intent, "MAINTENANCE");
    assert.deepEqual(first.body.replyTargets, [{ conversationNo: "CV-101", throughMessageId: 40 }]);
    assert.equal(unrepliedMessageIds.has(40), true);
    await page.reload();
    await page.getByRole("textbox", { name: "输入会话消息" }).waitFor();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="输入会话消息"]')?.value === "新会话明确处理旧消息");
    assert.equal(await page.getByRole("textbox", { name: "输入会话消息" }).inputValue(), "新会话明确处理旧消息");
    assert.equal(await page.getByLabel("本条消息用途").inputValue(), "MAINTENANCE");
    assert.equal(await page.getByRole("checkbox", { name: /处理旧会话 CV-101/ }).isChecked(), true);
    await page.getByRole("button", { name: "查询结果并重试" }).click();
    for (let attempt = 0; attempt < 50 && !extraConvo; attempt++) await page.waitForTimeout(100);
    assert.equal(extraConvo?.conversationNo, "CV-102");
    const createdAttempts = mutations.filter((item) => item.path === "/api/admin/content/conversations" && item.body.openingText === "新会话明确处理旧消息");
    assert.equal(createdAttempts.length, 2);
    assert.equal(createdAttempts[1].key, first.key);
    assert.deepEqual(createdAttempts[1].body, first.body);
    assert.equal(unrepliedMessageIds.has(40), false);
    await page.getByText("更多操作", { exact: true }).click();
    await page.getByRole("link", { name: "正式转绑客户" }).click();
    await page.getByRole("dialog", { name: "客户详情" }).waitFor();
    await page.getByRole("button", { name: "正式转绑客户" }).waitFor();
  });
  await check("s5a-ticket-detail-lazy", page, async () => {
    failNextTicketDetail = true;
    await page.goto(`${origin}/service/tickets?query=T-101`);
    const drawer = page.getByRole("dialog", { name: "工单 T-101 详情" });
    await drawer.getByText("工单详情读取失败，请重试。").waitFor();
    assert.equal(await drawer.getByPlaceholder(/回复 T-101/).count(), 0);
    await drawer.getByRole("button", { name: "重试读取详情" }).click();
    await drawer.getByPlaceholder(/回复 T-101/).waitFor();
    await page.goto(`${origin}/service/tickets`);
    const row = page.locator("tr").filter({ hasText: "T-101" });
    await row.waitFor();
    convertedTicket.version += 1;
    await row.getByRole("button", { name: "处理" }).click();
    await drawer.getByText("工单已更新，请刷新列表后重试。").waitFor();
    await drawer.getByRole("button", { name: "刷新工单列表" }).click();
    await drawer.getByPlaceholder(/回复 T-101/).waitFor();
  });
  await check("s5b-ticket-private-revocation", page, async () => {
    await page.goto(`${origin}/service/tickets`);
    await page.locator("tr").filter({ hasText: "T-101" }).waitFor();
    restrictNextTicketDetail = true;
    await page.locator("tr").filter({ hasText: "T-101" }).getByRole("button", { name: "处理" }).click();
    await page.getByText("私聊内容仅当前顾问和主管可阅").first().waitFor();
    assert.equal(await page.getByText(/由会话 CV-101 转入/).count(), 0);
  });
  let m3HistoryDetailReads = 0;
  await check("s5b-conversation-request-budget", page, async () => {
    bulkConvos = Array.from({ length: 60 }, (_, index) => ({ ...convo, id: 200 + index, conversationNo: `CV-BULK-${index + 1}`, userId: 2000 + index, customerId: 2000 + index, status: "CLOSED", lastMessage: `历史摘要 ${index + 1}`, lastMessageAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" }));
    conversationDetailReads.length = 0;
    await page.goto(`${origin}/service/sessions`);
    await page.getByRole("region", { name: "专属客服会话" }).waitFor();
    await page.getByRole("button", { name: /历史摘要 60/ }).waitFor();
    await page.getByText("请协助处理").first().waitFor();
    m3HistoryDetailReads = conversationDetailReads.length;
    assert.ok(conversationDetailReads.length < 10, `60 historical rows must not fan out details: ${conversationDetailReads.length}`);
    assert.equal(conversationDetailReads.some((path) => path.includes("CV-BULK-")), false);
    bulkConvos = [];
  });
  checks.at(-1).evidence.push(`60 historical conversations; detail GET count ${m3HistoryDetailReads}`);
  console.log(`S5b 60-history detail GET count: ${m3HistoryDetailReads}`);
  await check("s5b-conversation-detail-retry", page, async () => {
    blockedConversationDetailNo = "CV-102";
    await page.goto(`${origin}/service/sessions?customerId=101`);
    await page.getByRole("alert").filter({ hasText: "会话详情读取失败" }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "输入会话消息" }).isEnabled(), false);
    blockedConversationDetailNo = "";
    await page.getByLabel("会话消息", { exact: true }).getByRole("button", { name: "重试读取详情" }).click();
    await page.waitForFunction(() => !document.querySelector('textarea[aria-label="输入会话消息"]')?.disabled);
    assert.equal(await page.getByRole("textbox", { name: "输入会话消息" }).isEnabled(), true);
  });
  await check("s5b-workbench-denied-detail", page, async () => {
    await page.goto(`${origin}/service/overview`);
    await page.locator(".s5a-recent").getByRole("button", { name: /客户 101/ }).first().waitFor();
    await page.getByRole("navigation", { name: "客服工作区" }).getByRole("button", { name: "我的客户" }).click();
    await page.getByRole("button", { name: "测试客户甲" }).waitFor();
    activeAdminId = 8;
    await page.getByRole("button", { name: "测试客户甲" }).click();
    await page.getByRole("dialog", { name: "客户详情" }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "测试客户甲" }).waitFor({ state: "hidden" });
    assert.equal(await page.locator(".s5a-recent").getByRole("button", { name: /客户 101/ }).count(), 0);
    activeAdminId = 7;
    await page.goto(`${origin}/service/overview?customerId=101`);
    await page.getByRole("dialog", { name: "客户详情" }).getByRole("button", { name: /查看维护记录/ }).waitFor();
    activeAdminId = 8;
    await page.getByRole("dialog", { name: "客户详情" }).getByRole("button", { name: /查看维护记录/ }).click();
    await page.getByRole("dialog", { name: "客户详情" }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "测试客户甲" }).waitFor({ state: "hidden" });
    activeAdminId = 7;
  });
  await check("s5b-rules-readonly-pending", page, async () => {
    agent.seatType = "MANAGER";
    activeRole = "supervisor";
    await page.goto(`${origin}/service/scripts`);
    await page.evaluate((serverRules) => {
      const now = Date.now();
      sessionStorage.setItem("nexion-admin-m-support-rules-v1", JSON.stringify({
        "pending-readonly": { fingerprint: `support-rules:${serverRules.version}`, commandKey: "pending-readonly", createdAt: now, expiresAt: now + 60000, actorId: 7, payload: { ...serverRules, activityWindowDays: 99, expectedVersion: serverRules.version, reason: "测试降权后待确认草稿隔离" } },
      }));
    }, rules);
    await page.reload();
    await page.getByRole("region", { name: "服务规则" }).waitFor();
    await page.getByText("此账号有一笔规则提交结果尚未确认").waitFor();
    assert.equal(await page.getByLabel("活跃统计窗口天数").inputValue(), String(rules.activityWindowDays));
    assert.equal(await page.getByRole("button", { name: "预览并保存" }).isDisabled(), true);
    agent.seatType = "DEDICATED";
    activeRole = "superadmin";
  });
  assert.deepEqual(errors, [], `Unhandled fixture routes: ${[...unhandled].join(", ")}`);
  const required = ["WORKFLOW_TASK_ID", "WORKFLOW_STEP_ID", "WORKFLOW_CHECK_ID", "WORKFLOW_RUN_ID", "WORKFLOW_REPO", "WORKFLOW_SNAPSHOT_HASH"];
  if (reportPath && required.every((key) => process.env[key])) {
    const report = { taskId: process.env.WORKFLOW_TASK_ID, stepId: process.env.WORKFLOW_STEP_ID, checkId: process.env.WORKFLOW_CHECK_ID, runId: process.env.WORKFLOW_RUN_ID, repo: process.env.WORKFLOW_REPO, snapshotHash: process.env.WORKFLOW_SNAPSHOT_HASH, at: new Date().toISOString(), verdict: "pass", mode: "full", capability: "runtime", treeMoved: false, innerSkipped: 0, steps: checks };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`PASS S5a fixture runtime: ${checks.map((item) => item.id).join(", ")}`);
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else server.kill("SIGTERM");
  }
}
