import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(path.join(repo, "package.json")), ts = require("typescript");
const paths = { dock: "app/components/domain-views/m-view.tsx", chat: "app/components/domain-views/m-tabs/m3-dedicated-chat.tsx", store: "lib/admin/pending-mutation-store.ts", helpers: "lib/admin/m-support-enhancements.ts" };
const raw = Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, fs.readFileSync(path.join(repo, file), "utf8")]));
const hashes = Object.fromEntries(Object.entries(raw).map(([key, text]) => [key, createHash("sha256").update(text).digest("hex")]));
const sources = Object.fromEntries(Object.entries(raw).map(([key, text]) => [key, text.replace(/\r\n/g, "\n")]));
function extract(source, start, end, from = 0) {
  const begin = source.indexOf(start, from), finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `Missing source boundary: ${start}`);
  return source.slice(begin, finish);
}
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const dockStart = sources.dock.indexOf("function SessionDock");
assert.ok(dockStart >= 0);
const sendSource = extract(sources.dock, "  const send = async", "\n  const customer = conv.customer", dockStart);
function containingEffect(marker, end) {
  const offset = sources.dock.indexOf(marker, dockStart), begin = sources.dock.lastIndexOf("  useEffect(() => {", offset);
  assert.ok(offset >= dockStart && begin >= dockStart);
  return sources.dock.slice(begin, sources.dock.indexOf(end, offset));
}
const scopeEffect = containingEffect("redactDockRecovery(pendingForAdmin)", "\n\n  const loadConversationDetail");
const listenerEffect = containingEffect('window.addEventListener("support-scope-invalidated"', "\n  const copyOriginal");
const authEffect = extract(sources.dock, "  useEffect(() => {\n    identityGeneration.current += 1;", "\n  useEffect(() => {", dockStart);
const restoreEffect = containingEffect("if (!pendingDock || pendingDock.readOnlyRecovery", "\n  useEffect(() => {");
const no = () => {};
const drain = async () => { await new Promise(resolve => setImmediate(resolve)); };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function memoryStorage() { const table = new Map(); return { getItem: key => table.get(key) ?? null, setItem: (key, value) => table.set(key, String(value)), removeItem: key => table.delete(key), key: index => [...table.keys()][index] ?? null, get length() { return table.size; } }; }
class SupportClientError extends Error { constructor(status) { super("test failure"); this.status = status; } }
function harness({ stateVersion = 1, refresh = async () => {} } = {}) {
  const storage = memoryStorage(), storeContext = vm.createContext({ exports: {}, window: { sessionStorage: storage }, console });
  vm.runInContext(compile(sources.store), storeContext);
  const dockCommands = storeContext.exports.createPendingMutationStore({ storageKey: "nexion-admin-m-dock-pending-v1", ttlMs: Number.MAX_SAFE_INTEGER - Date.now(), isValidRecord: row => typeof row.payload === "string" && typeof row.conversationNo === "string" });
  const owner = deferred(), state = deferred(), post = deferred(), listeners = new Map();
  const observed = { draft: "test private original", error: "", sending: false, posts: 0, stateReads: 0 };
  let cleanup;
  const context = vm.createContext({ exports: {}, useEffect: fn => cleanup = fn(), identityGeneration: { current: 1 }, sendInFlight: { current: false }, currentAdminId: 1, authEpoch: 0, draft: observed.draft, pendingForAdmin: null, pendingDock: null, privateScopeLost: false, canWrite: true, canWriteM3: true, dockSlot: "dock|1|A", conv: { id: "A", customerId: "101", ownerAdminId: 1, version: 1, type: "advisor", status: "open", detailReady: true, messages: [] }, conversationsAvailable: true, dockCommands, sessionStorage: storage, setDraft: value => observed.draft = value, setSendError: value => observed.error = value, setSending: value => observed.sending = value, setCanAbandon: no, crypto: { randomUUID: () => "test-dock-command" }, SupportClientError, isIndeterminateSupportError: () => false, displayAdminError: () => "test refresh failure", supportClient: { customerDetail: () => owner.promise, conversationState: () => { observed.stateReads++; return state.promise; }, sendConversationReply: () => { observed.posts++; return post.promise; } }, ctx: { refreshConversations: refresh, toast: no }, window: { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type), dispatchEvent: event => listeners.get(event.type)?.(event) }, Event, onScopeInvalidated: no });
  vm.runInContext(compile(extract(sources.helpers, "export function privateMessageRecovery", "export function legacySupportDestination")), context);
  vm.runInContext(compile(extract(sources.dock, "function redactDockRecovery", "const commandSlot")), context);
  vm.runInContext(compile(sendSource), context);
  return { context, observed, commands: dockCommands, owner, state, post, run: code => vm.runInContext(compile(code), context), start: () => vm.runInContext("send()", context), beginPreflight: async () => { owner.resolve({ agentAdminId: 1, assignmentId: "assignment-A" }); await drain(); }, finishState: async () => { state.resolve({ status: "OPEN", version: stateVersion }); await drain(); }, scope: () => { vm.runInContext(compile(listenerEffect), context); context.window.dispatchEvent({ type: "support-scope-invalidated", detail: { conversationNo: "A", customerId: "101" } }); }, authCleanup: () => { vm.runInContext(compile(authEffect), context); cleanup(); } };
}
const results = [];
async function check(name, run) { try { await run(); results.push({ name, verdict: "pass" }); } catch (error) { results.push({ name, verdict: "fail", reason: error instanceof Error ? error.message : "assertion failed" }); } }

await check("owner loss during fresh send preflight cancels without creating body cache or POST", async () => {
  const probe = harness(); const pending = probe.start(); await probe.beginPreflight();
  probe.context.privateScopeLost = true;
  probe.run(scopeEffect); await probe.finishState();
  assert.equal(probe.observed.posts, 0, "Late preflight POST occurs after authoritative owner loss with no prior pending command");
  assert.equal(probe.commands.list().length, 0);
  assert.equal(probe.observed.draft, "");
  assert.equal(probe.observed.sending, false);
  await pending;
});
await check("late version-mismatch refresh failure after scope invalidation cannot restore an old error", async () => {
  const refresh = deferred(), probe = harness({ stateVersion: 2, refresh: () => refresh.promise });
  const pending = probe.start(); await probe.beginPreflight(); await probe.finishState();
  probe.scope(); assert.equal(probe.observed.error, "");
  refresh.reject(new Error("test refresh failure")); await pending;
  assert.equal(probe.observed.error, "", "Old version-check refresh failure overwrites error after scope cleanup");
});
await check("late post-send refresh failure after scope invalidation cannot restore an old error", async () => {
  const refresh = deferred(), probe = harness({ refresh: () => refresh.promise });
  const pending = probe.start(); await probe.beginPreflight(); await probe.finishState();
  assert.equal(probe.observed.posts, 1); probe.post.resolve({}); await drain();
  probe.scope(); assert.equal(probe.observed.error, "");
  refresh.reject(new Error("test refresh failure")); await pending;
  assert.equal(probe.observed.error, "", "Old post-send refresh failure overwrites error after scope cleanup");
});
await check("auth cleanup cancels old fresh preflight and leaves current draft/error intact", async () => {
  const probe = harness(), pending = probe.start();
  probe.authCleanup(); probe.observed.draft = "current actor draft";
  probe.owner.resolve({ agentAdminId: 1, assignmentId: "assignment-A" }); await pending;
  assert.equal(probe.observed.posts, 0); assert.equal(probe.observed.stateReads, 0); assert.equal(probe.observed.draft, "current actor draft"); assert.equal(probe.observed.error, "");
});
await check("partial empty is not scope loss; authoritative empty is scope loss; authorized CLOSED keeps raw body", async () => {
  const probe = harness();
  const scopeSource = extract(sources.dock, "  let canReviewAll =", "  const dockSlot", dockStart);
  probe.context.isSuperAdmin = false; probe.context.ctx.pget = () => "[]";
  probe.context.conv = null; probe.context.conversationsAvailable = false;
  probe.run(`function evaluateScope(){${scopeSource}; return privateScopeLost;}`);
  assert.equal(vm.runInContext("evaluateScope()", probe.context), false);
  probe.context.conversationsAvailable = true;
  assert.equal(vm.runInContext("evaluateScope()", probe.context), true);
  const payload = JSON.stringify({ kind: "TEXT", content: "test CLOSED original", clientMessageId: "test-original-id" });
  probe.commands.remember("dock|1|A", "test-closed-command", { payload, conversationNo: "A", customerId: "101" });
  probe.context.conv = { id: "A", customerId: "101", ownerAdminId: 1, status: "closed" };
  probe.context.privateScopeLost = vm.runInContext("evaluateScope()", probe.context);
  assert.equal(probe.context.privateScopeLost, false);
  probe.context.pendingForAdmin = probe.context.pendingDock = probe.commands.list()[0];
  probe.context.draft = ""; probe.run(restoreEffect); probe.run(scopeEffect);
  assert.equal(probe.observed.draft, "test CLOSED original"); assert.equal(probe.commands.list()[0].payload, payload); assert.notEqual(probe.commands.list()[0].readOnlyRecovery, true);
  probe.context.conv = null; probe.context.privateScopeLost = vm.runInContext("evaluateScope()", probe.context); probe.run(scopeEffect);
  assert.equal(probe.observed.draft, ""); assert.equal(probe.commands.list()[0].readOnlyRecovery, true); assert.equal(JSON.parse(probe.commands.list()[0].payload).content, undefined);
});
await check("M3 partial empty does not revoke but authoritative empty does", async () => {
  const predicate = extract(sources.chat, "  const lostAccess =", "  const unreadMessageId");
  const context = vm.createContext({ selectedId: "A", requestedCustomerId: null, visible: [], conversationsAvailable: false, qualificationUnknown: false });
  vm.runInContext(compile(`function checkAccess(){${predicate};return lostAccess;}`), context);
  assert.equal(vm.runInContext("checkAccess()", context), false);
  context.conversationsAvailable = true;
  assert.equal(vm.runInContext("checkAccess()", context), true);
  context.qualificationUnknown = true;
  assert.equal(vm.runInContext("checkAccess()", context), false, "A pending roster must not claim authoritative scope loss");
});

await check("actual parent invalidation preserves unrelated A dock and draft, but clears related/global scope", async () => {
  function parentHarness() {
    const probe = harness();
    let data = { conversations: [{ id: "A", customerId: "101" }, { id: "B", customerId: "102" }], tickets: [] };
    let ui = { "I.session.ui.lastConvo": "A", "I.session.ui.dockOpen": "1" };
    let saves = 0;
    Object.assign(probe.context, { useCallback: fn => fn, session: { adminId: 1 }, mLoadCoordinator: { current: { beginConversationSnapshot: no } }, liveSnapshotController: { current: null }, mDataRef: { current: data }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, setMData: update => { data = update(data); probe.context.mDataRef.current = data; }, reloadMContent: async () => {}, setUiParams: update => ui = update(ui), saveDockUi: () => saves++, DOCK_LAST_KEY: "I.session.ui.lastConvo", DOCK_OPEN_KEY: "I.session.ui.dockOpen" });
    probe.run(extract(sources.dock, "  const invalidateScope = useCallback", "\n  const m3RecoveryEnabled"));
    probe.run(listenerEffect);
    return { ...probe, ui: () => ui, data: () => data, saves: () => saves, invalidate: (conversationNo, customerId) => { probe.context.nextConversationNo = conversationNo; probe.context.nextCustomerId = customerId; vm.runInContext("invalidateScope(nextConversationNo,nextCustomerId)", probe.context); } };
  }
  const unrelated = parentHarness(), originalUi = unrelated.ui();
  unrelated.invalidate("B", "102");
  assert.equal(unrelated.data().conversations.some(conversation => conversation.id === "A"), true);
  assert.equal(unrelated.ui(), originalUi, "Unrelated B invalidation must preserve the actual A dock UI state");
  assert.equal(unrelated.ui()["I.session.ui.lastConvo"], "A"); assert.equal(unrelated.ui()["I.session.ui.dockOpen"], "1");
  assert.equal(unrelated.observed.draft, "test private original"); assert.equal(unrelated.saves(), 0);
  const related = parentHarness(); related.invalidate("A", "101");
  assert.equal(related.ui()["I.session.ui.lastConvo"], ""); assert.equal(related.ui()["I.session.ui.dockOpen"], "0"); assert.equal(related.observed.draft, ""); assert.equal(related.data().conversations.some(conversation => conversation.id === "A"), false);
  const global = parentHarness(); global.invalidate(undefined, undefined);
  assert.equal(global.ui()["I.session.ui.lastConvo"], ""); assert.equal(global.ui()["I.session.ui.dockOpen"], "0"); assert.equal(global.observed.draft, ""); assert.equal(global.data().conversations.length, 0);
});

console.log(JSON.stringify({ scope: "original source callbacks/effects in memory; no services/browser/DB/fixture", hashes, results }, null, 2));
if (results.some(result => result.verdict !== "pass")) process.exitCode = 1;
