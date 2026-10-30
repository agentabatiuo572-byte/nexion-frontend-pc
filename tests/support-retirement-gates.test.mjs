import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { auditSupportSurface, auditReplyTimeoutBoundary, loadSupportSources, validateRetiredTicketAction } from "../scripts/admin-support-surface-audit.mjs";
import { validateRuntimeEvidence } from "../scripts/lib/ops-actions-reverse-coverage.mjs";
import { resolveNexionAppRoot, resolveNexionBackendRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const adminRoot = process.cwd();
const appRoot = resolveNexionAppRoot({ adminRoot });
const backendRoot = resolveNexionBackendRoot({ adminRoot });
const sources = loadSupportSources({ adminRoot, appRoot, backendRoot });
const manifest = JSON.parse(fs.readFileSync(path.join(adminRoot, "docs/ops-actions.manifest.json"), "utf8"));
const changedEvidence = new Set(["OPS-E-18", "OPS-M-26", "OPS-M-27"]);
const selected = { rows: manifest.rows.filter(row => changedEvidence.has(row.id)) };
const evidenceText = (type, file) => fs.readFileSync(path.join(type.startsWith("backend-") ? backendRoot : type.startsWith("uniapp-") ? appRoot : adminRoot, file), "utf8");

test("the actual current conversation chain and the 410 retirement boundary pass together", () => {
  assert.deepEqual(auditSupportSurface(sources), []);
  assert.deepEqual(validateRetiredTicketAction(manifest), []);
  assert.deepEqual(validateRuntimeEvidence(selected, evidenceText), []);
});

test("reviving a ticket entry, renderer, App API or store is rejected", () => {
  const mutations = [
    { ...sources, nav: sources.nav.replace('{ id: "M3"', '{ id: "M2", path: "/service/tickets", status: "flagship" },\n      { id: "M3"') },
    { ...sources, view: sources.view.replace('<p>工单服务已下线，请通过客户会话继续联系。</p>', '<M2Tickets ctx={ctx} />') },
    { ...sources, appApi: sources.appApi + '\nconst obsolete = { createTicket(input, key) {} };' },
    { ...sources, appTicketStoreExists: true },
  ];
  for (const source of mutations) assert.notDeepEqual(auditSupportSurface(source), [], "a retired ticket workflow must not be accepted");
});

test("disconnecting the live reply, wire CAS or command recovery makes the gate fail", () => {
  const mutations = [
    { ...sources, chat: sources.chat.replaceAll("supportClient.sendConversationReply(", "supportClient.disconnectedReply(") },
    { ...sources, chat: sources.chat.replaceAll("supportClient.command(record.key)", "supportClient.disconnectedCommand(record.key)") },
    { ...sources, client: sources.client.replace('expectedVersion: count(input.expectedVersion, "conversation.expectedVersion")', 'expectedVersion: 0') },
    { ...sources, appApi: sources.appApi.replace('body: { body: text, expectedStatus: conversation.status.toUpperCase(), expectedVersion: conversation.version, clientMessageId: key', 'body: { body: text, expectedStatus: conversation.status.toUpperCase(), clientMessageId: key') },
    { ...sources, service: sources.service.replaceAll('if (!matches(conversation.status(), conversation.version(), request.expectedStatus(), request.expectedVersion())) return conversationConflict();', 'if (false) return conversationConflict();') },
    { ...sources, proxy: sources.proxy.replace('headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey)', 'headers.set("Unrelated-Header", idempotencyKey)') },
  ];
  for (const source of mutations) assert.notDeepEqual(auditSupportSurface(source), [], "a disconnected live consumer must not pass on old legacy code");
});

test("removing 410 or either retired-path family is caught while seat capacity stays live", () => {
  const mutations = [
    sources.retired.replace('response.setStatus(410)', 'response.setStatus(200)'),
    sources.retired.replace('/tickets(?:/.*)?', '/obsolete-tickets(?:/.*)?'),
    sources.retired.replace('/conversations/[^/]+/ticket', '/conversations/[^/]+/obsolete-ticket'),
    sources.retired.replace('path.equals("/api/admin/content/tickets/load-config")', 'path.equals("/obsolete-load-config")'),
    sources.retired.replace('if (!retired(request.getServletPath())) return true;', 'if (retired(request.getServletPath())) return true;'),
    sources.retired.replace('return path.matches(', 'return false && path.matches('),
  ];
  for (const retired of mutations) assert.notDeepEqual(auditSupportSurface({ ...sources, retired }), []);
});

test("stable reply keys must reach the current PC JSON transport and App reply without replacement", () => {
  const mutations = [
    { ...sources, client: sources.client.replace('headers: keyHeader(key), signal', 'headers: {}, signal') },
    { ...sources, client: sources.client.replace('reason: "专属客服回复客户消息" }, idempotencyKey, signal)', 'reason: "专属客服回复客户消息" }, "fixed-command-key", signal)') },
    { ...sources, appApi: sources.appApi.replace('replyConversation: async (conversation, body, key, attachmentId) => {', 'replyConversation: async (conversation, body, key, attachmentId) => { key = crypto.randomUUID();') },
  ];
  for (const source of mutations) assert.notDeepEqual(auditSupportSurface(source), []);
});

test("M26 cannot be relabeled built or regain a ticket action without a hard failure", () => {
  for (const update of [{ status: "built" }, { restAction: "createTicket" }, { reason: "" }, { runtimeEvidence: [] }]) {
    const changed = structuredClone(manifest); Object.assign(changed.rows.find(row => row.id === "OPS-M-26"), update);
    assert.notDeepEqual(validateRetiredTicketAction(changed), []);
  }
  const revived = structuredClone(manifest); revived.activeLeafCoverage.M2 = ["OPS-M-26"];
  assert.notDeepEqual(validateRetiredTicketAction(revived), []);
});

test("reply deadlines remain read-only and automatic idle closing cannot revive", () => {
  assert.deepEqual(auditReplyTimeoutBoundary(sources), []);
  assert.notDeepEqual(auditReplyTimeoutBoundary({ ...sources, timeoutStatus: sources.timeoutStatus.replaceAll("已超时 · 待处理", "") }), []);
  assert.notDeepEqual(auditReplyTimeoutBoundary({ ...sources, timeoutStatus: sources.timeoutStatus + "\ncloseConversation();" }), []);
  assert.notDeepEqual(auditReplyTimeoutBoundary({ ...sources, idleScheduler: sources.idleScheduler.replace("return new SweepResult(0, 0);", "mapper.selectDueCloseCandidates(now, BATCH_SIZE); return new SweepResult(0, 1);") }), []);
});

test("E18 still requires the real remembered-assignment consumer and M27 the live reply CAS", () => {
  const failures = validateRuntimeEvidence(selected, (type, file) => {
    let source = evidenceText(type, file);
    if (file === "src/store/app.ts") source = source.replace('applyRemoteAssignments(devices.value, rememberTaskAssignments(request, assignmentResult.value))', 'applyRemoteAssignments(devices.value, disconnectedAssignments)');
    if (file.endsWith("AppSupportService.java")) source = source.replaceAll('if (!matches(conversation.status(), conversation.version(), request.expectedStatus(), request.expectedVersion())) return conversationConflict();', 'if (false) return conversationConflict();');
    return source;
  });
  assert(failures.some(failure => failure.startsWith("OPS-E-18")));
  assert(failures.some(failure => failure.startsWith("OPS-M-27")));
});
