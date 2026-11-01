import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";

const source = readFileSync(process.env.M3_FEEDBACK_SOURCE || new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("chat.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const expressions = [], declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node);
  if (ts.isJsxExpression(node) && node.expression) expressions.push(node.expression.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const execute = (text, scope) => new Function("require", "exports", ...Object.keys(scope), compile(text))(() => jsx, {}, ...Object.values(scope));
const feedback = expressions.find(text => text.includes('className="itint danger" role="alert"') && text.includes('sendError ||'));
const ownership = expressions.find(text => text.startsWith('selected && !writable && composerMode === "write"'));
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const markup = (expression, scope) => renderToStaticMarkup(execute(`return (${expression});`, scope) || null);

function sending({ first = false, refreshFails = false } = {}) {
  const request = deferred(), writes = [], forgotten = [];
  class SupportClientError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const state = { busy: false, sendError: "", pending: null, firstPending: null, drafts: { "CV-1": "test message", "first:7": "test message" } };
  const selected = first ? null : { id: "CV-1", customerId: "7", version: 3, status: "open", owner: "TEST" };
  const scope = {
    ...state, selected, conversationsAvailable: true, recoveryBlocksTarget: false, writable: true,
    identityRef: { current: "actor" }, adminId: 1, requestedCustomerId: first ? "7" : null,
    firstDetail: { assignmentId: "9", agentAdminId: 1, version: 3 }, currentProfileDetail: { assignmentId: "9", agentAdminId: 1 },
    closedCandidatesReady: true, closedReplyTargets: [], currentReplyTarget: null, includeCurrentReply: false,
    draft: "test message", intent: "SERVICE", targetKey: first ? "first:7" : "CV-1", session: { operator: "TEST" }, contentChoice: null,
    newKey: () => "original-key", validCustomerId: value => value === "7", sendAdminTyping() {},
    rememberPending: () => true, firstPendingKey: () => "first", pendingKey: () => "reply",
    pendingMessages: { forget: (...args) => forgotten.push(args) },
    SupportClientError, rejectedSend: cause => cause instanceof SupportClientError && [400, 403, 404, 409, 422].includes(cause.status),
    lostPermission: cause => [403, 404].includes(cause.status), displayAdminError: cause => cause.message,
    ctx: { refreshConversations: async () => { if (refreshFails) throw new Error("refresh unavailable"); }, invalidateScope() {} },
    supportClient: {
      conversationState: async () => ({ version: 3, status: "OPEN" }),
      sendConversationReply: (...args) => { writes.push(args); return request.promise; },
      startConversation: (...args) => { writes.push(args); return request.promise; },
      command: async () => null,
    },
    window: { dispatchEvent() {}, location: { href: "https://test.invalid/service/sessions" }, history: { replaceState() {} } },
    setMaintenanceChosen() {}, setSelectedId() {}, setRequestedCustomerId() {}, setScreen() {}, setProfileDetail() {}, setProfileRetry() {}, setDetailRetry() {}, setContentChoice() {}, clearAttachment() {},
    setBusy: value => { state.busy = value; }, setSendError: value => { state.sendError = value; },
    setPending: value => { state.pending = value; }, setFirstPending: value => { state.firstPending = value; },
    setDrafts: update => { state.drafts = update(state.drafts); },
  };
  const send = execute(`const send = ${declarations.get("send").initializer.getText(ast)}; return send;`, scope);
  return { state, request, writes, forgotten, SupportClientError, send, html: () => markup(feedback, { ...scope, ...state }) };
}

test("normal reply and first contact stay quiet while pending and clear the sent draft after success", async () => {
  for (const first of [false, true]) {
    const h = sending({ first }), done = h.send("TEXT");
    await flush();
    assert.equal(h.writes.length, 1); assert.equal(h.state.busy, true);
    assert.ok(h.state.pending || h.state.firstPending, "the recovery command must still be recorded");
    assert.equal(h.html(), "", "in-flight persistence is not an error");
    h.request.resolve({ conversationNo: "CV-1" }); await done;
    assert.equal(h.state.busy, false); assert.equal(h.state.pending, null); assert.equal(h.state.firstPending, null);
    assert.equal(h.state.drafts[first ? "first:7" : "CV-1"], ""); assert.equal(h.html(), "");
  }
});

test("unknown results keep the original message and recovery action; definite failures retain the corresponding error", async () => {
  for (const first of [false, true]) for (const definite of [false, true]) {
    const h = sending({ first }), done = h.send("TEXT"); await flush();
    h.request.reject(definite ? new h.SupportClientError(422, "specific rejection") : new Error("network timeout"));
    await done;
    assert.equal(h.state.busy, false); assert.equal(h.state.drafts[first ? "first:7" : "CV-1"], "test message");
    assert.match(h.html(), definite ? /specific rejection/ : /network timeout/);
    assert.equal(Boolean(h.state.pending || h.state.firstPending), !definite);
    if (!definite) {
      assert.match(h.html(), /查询结果并重试/);
      assert.equal((h.state.pending || h.state.firstPending).key, "original-key");
      h.state.busy = true; h.state.sendError = ""; assert.equal(h.html(), "", "a recovery request also stays quiet in flight");
    }
  }
});

test("a refresh failure remains distinct from a successful send and does not retain a duplicate command", async () => {
  for (const first of [false, true]) {
    const h = sending({ first, refreshFails: true }), done = h.send("TEXT"); await flush();
    h.request.resolve({ conversationNo: "CV-1" }); await done;
    assert.match(h.html(), /消息已发送.*刷新/); assert.doesNotMatch(h.html(), /查询结果并重试/);
    assert.equal(h.state.pending, null); assert.equal(h.state.firstPending, null);
  }
});

test("ownership checks stay quiet during loading but retain errors, permission and changed-owner blockers", () => {
  const scope = { selected: { status: "open", ownerAdminId: 1 }, writable: false, composerMode: "write", currentProfileDetail: null,
    profileError: "", recoveryBlocksTarget: false, canWriteM3: true, historyReadOnlyHint: "历史只读", selectedUnbound: false,
    messagePages: { contextReady: true, page: { replyContext: { ready: true } } } };
  assert.equal(markup(ownership, scope), "");
  assert.match(markup(ownership, { ...scope, profileError: "service unavailable" }), /客户归属核对失败.*service unavailable.*重试/);
  assert.match(markup(ownership, { ...scope, canWriteM3: false }), /发消息需要会话操作权限/);
  assert.match(markup(ownership, { ...scope, currentProfileDetail: { assignmentId: "9", agentAdminId: 2 } }), /客户归属已变化/);
  assert.match(markup(ownership, { ...scope, recoveryBlocksTarget: true }), /原消息结果待确认/);
});
