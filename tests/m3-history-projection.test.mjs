import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parseBusinessTime } from "../lib/admin/business-time.ts";
import { compareM3Messages } from "../lib/admin/m3-message-order.ts";

const source = readFileSync(new URL("../lib/admin/m-client.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("m-client.ts", source, ts.ScriptTarget.Latest, true);
const functions = ["fetchMConversationDetail", "markMConversationRead"].map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast));
const compiled = ts.transpileModule(functions.join("\n").replaceAll("export async", "async"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const calls = [], detail = { conversation: { status: "CLOSED", version: 7 }, messages: [{ id: 19, receiptStatus: "sent" }] };
  const ctx = {
    detail, calls,
    apiRequest: async (path, options) => { calls.push({ path, options }); return detail; },
    assertConversationDetail: value => value,
    adaptConversation: value => ({ id: "CV history", detailReady: true, messages: value.messages }),
  };
  vm.runInNewContext(`${compiled}\nglobalThis.api={fetchMConversationDetail,markMConversationRead};`, ctx);
  return ctx;
}
test("current and dock detail keep the default full endpoint; explicit history selects only the lightweight projection", async () => {
  const f = fixture(), signal = new AbortController().signal;
  await f.api.fetchMConversationDetail("CV history", signal);
  assert.equal(f.calls[0].path, "/conversations/CV%20history");
  const light = await f.api.fetchMConversationDetail("CV history", signal, false);
  assert.equal(f.calls[1].path, "/conversations/CV%20history?includeCustomerProfile=false");
  assert.equal(f.calls[1].options.signal, signal); assert.equal(light.messages, f.detail.messages);
});
test("receipt preflight uses the lightweight read and retains current status/version and target message ID", async () => {
  const f = fixture(), signal = new AbortController().signal;
  await f.api.markMConversationRead("CV history", 19, signal);
  assert.equal(f.calls[0].path, "/conversations/CV%20history?includeCustomerProfile=false");
  assert.equal(f.calls[1].path, "/conversations/CV%20history/read");
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { lastSeenMessageId: 19, expectedStatus: "CLOSED", expectedVersion: 7 });
  assert.equal(f.calls[1].options.signal, signal);
});
test("already-read receipts and aborted preflights never issue the write", async () => {
  const read = fixture(); read.detail.messages[0].receiptStatus = "read";
  await read.api.markMConversationRead("CV history", 19, new AbortController().signal);
  assert.equal(read.calls.length, 1);
  const aborted = fixture(), controller = new AbortController(); controller.abort();
  await aborted.api.markMConversationRead("CV history", 19, controller.signal);
  assert.equal(aborted.calls.length, 1);
});

function pageFixture() {
  const names = ["upper", "str", "num", "asArray", "asStringArray", "asTs", "conversationStatus", "conversationType", "roleKey", "assertConversationRow", "assertConversationDetail", "parseSupportMessageKind", "adaptCustomerProfile", "adaptConversation", "parseM3MessagePage", "fetchM3MessagePage", "markM3MessagePageRead"];
  const parts = names.map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)).join("\n").replaceAll("export function", "function").replaceAll("export async", "async");
  const state = { calls: [], body: null, parseBusinessTime, compareM3Messages, supportWireId: n => { assert.ok(Number.isSafeInteger(n) && n > 0); return String(n); } };
  state.apiRequest = async (path, options) => { state.calls.push({ path, options }); return state.body; };
  vm.runInNewContext(`${ts.transpileModule(parts, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}\nglobalThis.api={parseM3MessagePage,fetchM3MessagePage,markM3MessagePageRead};`, state);
  return state;
}
const wirePage = () => ({ conversation: { id: 50, conversationNo: "CURRENT", conversationType: "ADVISOR", status: "OPEN", userId: 42, ownerAgentId: "12", unreadCount: 3, version: 7, updatedAt: "2026-10-29T01:00:00Z" },
  messages: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, conversationNo: i < 5 ? "LEGACY" : "CURRENT", senderType: i % 2 ? "AGENT" : "USER", senderName: "Original author", senderId: i % 2 ? 12 : 42, authorConfidence: "VERIFIED", content: `message-${i}`, createdAt: `2026-10-29T01:00:${String(i).padStart(2, "0")}Z`, kind: "TEXT", receiptStatus: "sent" })),
  hasMore: true, nextBeforeMessageId: 1, customerIdentity: { customerId: 42, userNo: "REAL-USER-NO", nickname: "Verified nickname", phoneMasked: "18***78" }, replyContext: { ready: true, targets: [{ conversationNo: "LEGACY-OUTSIDE-PAGE", throughMessageId: 99 }] }, readContexts: [{ conversationNo: "LEGACY", status: "CLOSED", version: 2, lastSeenMessageId: 5, alreadyRead: false }] });

test("real page adapter preserves ten cross-segment messages, thin UID/name and independent reply/read contexts", async () => {
  const f = pageFixture(); f.body = wirePage();
  const signal = new AbortController().signal;
  const result = await f.api.fetchM3MessagePage("CURRENT", undefined, signal);
  assert.equal(f.calls[0].path, "/conversations/CURRENT/messages");
  assert.equal(result.messages.length, 10); assert.equal(result.conversation.profile.uid, "REAL-USER-NO"); assert.equal(result.conversation.customer, "Verified nickname");
  assert.equal(result.messages[1].agentName, "Original author"); assert.equal(result.messages[0].sourceConversationNo, "LEGACY");
  assert.equal(result.replyContext.targets[0].throughMessageId, 99, "reply targets need not occur in the downloaded page");
  await f.api.fetchM3MessagePage("CURRENT", 1, signal); assert.equal(f.calls[1].path, "/conversations/CURRENT/messages?beforeMessageId=1");
  await f.api.markM3MessagePageRead(result.readContexts[0], signal);
  assert.equal(f.calls[2].path, "/conversations/LEGACY/read");
  assert.equal(f.calls[2].options.method, "POST"); assert.deepEqual(JSON.parse(f.calls[2].options.body), { lastSeenMessageId: 5, expectedStatus: "CLOSED", expectedVersion: 2 });
  assert.equal(f.calls.length, 3, "receipt uses supplied metadata and performs no detail GET");
});
test("page boundary rejects malformed sizes, cursor/identity mismatches, duplicate IDs and invalid source contexts", () => {
  const f = pageFixture();
  for (const mutate of [d => d.messages.push({ ...d.messages[0], id: 88 }), d => d.messages[1].id = d.messages[0].id, d => d.messages.reverse(), d => d.nextBeforeMessageId = 2, d => d.customerIdentity.customerId = 99, d => delete d.customerIdentity.userNo, d => d.messages[0].conversationNo = "", d => d.readContexts[0].lastSeenMessageId = 8, d => d.replyContext.ready = false]) {
    const payload = wirePage(); mutate(payload); assert.throws(() => f.api.parseM3MessagePage(payload, "CURRENT"), /M3_MESSAGE_PAGE_INVALID/);
  }
});
test("sub-millisecond time precedes ID tie-breaking and exact timestamp ties retain ID order", () => {
  const f = pageFixture(), payload = wirePage();
  payload.messages = [{ ...payload.messages[0], id: 9, createdAt: "2026-10-29T01:00:00.000100Z" }, { ...payload.messages[0], id: 8, createdAt: "2026-10-29T01:00:00.000200Z" }];
  payload.hasMore = false; payload.nextBeforeMessageId = null; payload.readContexts = [];
  assert.deepEqual(Array.from(f.api.parseM3MessagePage(payload, "CURRENT").messages, message => message.id), [9, 8]);
  const sorted = [...payload.messages].map(message => ({ id: message.id, ts: 0, sourceCreatedAt: message.createdAt })).sort(compareM3Messages);
  assert.deepEqual(sorted.map(message => message.id), [9, 8]);
  assert.ok(compareM3Messages({ id: 8, ts: 0 }, { id: 9, ts: 0 }) < 0);
});
