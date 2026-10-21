import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(path, require) {
  const output = { exports: {}, require };
  vm.runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, output);
  return output.exports;
}
const client = load("lib/admin/cregis-exceptions.ts", () => ({}));
const routes = load("lib/admin/cregis-exception-routes.ts", () => ({}));
const maxId = "9223372036854775807";
const plain = value => JSON.parse(JSON.stringify(value));

test("IDs remain full int64 strings and reject rounded or malformed values", () => {
  assert.equal(client.exceptionId(maxId), maxId);
  for (const id of [9007199254740992, "9223372036854775808", "01", "0", "1e3", "1/decision", null])
    assert.throws(() => client.exceptionId(id));
});
test("ownership challenge uses the issued UUID rather than an integer identifier", () => {
  const id = "8f2d9387-4470-4f05-8db4-d718af8bbcb0";
  assert.equal(client.exceptionChallengeId(id), id);
  for (const value of ["4", null, "../preview", "8f2d9387-4470-4f05-8db4-d718af8bbcb0/decision"])
    assert.throws(() => client.exceptionChallengeId(value));
});
test("configuration keeps unconfigured separate from zero and validates exact decimal fee", () => {
  assert.equal(client.exceptionFee("UNCONFIGURED", ""), "0");
  assert.equal(client.exceptionFee("PLATFORM_PAYS", ""), "0");
  assert.equal(client.exceptionFee("FIXED_USDT", "0.000001"), "0.000001");
  for (const amount of ["-1", "1e2", "0.0000001", "Infinity", "1;UPDATE", "01", ""])
    assert.throws(() => client.exceptionFee("FIXED_USDT", amount));
  assert.throws(() => client.exceptionFee("CUSTOM", "0"));
});
test("pagination and optimistic version failures do not become empty successful pages", () => {
  assert.deepEqual(plain(client.exceptionPage({ records: [{ id: maxId }], hasMore: true, nextBeforeId: maxId })),
    { records: [{ id: maxId }], hasMore: true, nextBeforeId: maxId });
  for (const page of [null, [], { records: [], hasMore: true, nextBeforeId: "2" },
    { records: [{ id: "3" }], hasMore: true, nextBeforeId: "2" }, { records: [{}], hasMore: false, nextBeforeId: null }])
    assert.throws(() => client.exceptionPage(page));
  for (const version of [undefined, "2", -1, 0.2, 9007199254740992]) assert.throws(() => client.exceptionVersion(version));
});
test("exception proxy allows exact contracts and rejects path expansion or wrong verbs", () => {
  for (const [route, method] of [
    ["cregis/exception-ownership/challenges", "POST"], ["cregis/exception-claims", "GET"],
    [`cregis/refunds/cases/${maxId}/recover`, "POST"], ["cregis/refunds/fee-policy/cases", "POST"],
    ["cregis/reorg/incidents/2/evidence", "GET"], ["cregis/reorg/proposals/4/decision", "POST"],
  ]) assert.ok(routes.cregisExceptionRoute(route.split("/")).methods.includes(method));
  for (const route of ["cregis/refunds/cases/01/recover", "cregis/refunds/cases/2/delete", "cregis/refunds/anything", "cregis/reorg/incidents/../evidence"])
    assert.equal(routes.cregisExceptionRoute(route.split("/")), null);
  assert.deepEqual(plain(routes.cregisExceptionRoute(["cregis", "reorg", "incidents", "2", "evidence"]).methods), ["GET", "HEAD"]);
});
test("actual command uses durable financial mutation transport without numeric conversion", async () => {
  const calls = [];
  const actual = load("lib/admin/cregis-exceptions.ts", () => ({ financeAdminRequest: async (...args) => { calls.push(args); return { id: maxId }; } }));
  await actual.exceptionCommand(`/refunds/cases/${maxId}/recover`, { providerCid: maxId, expectedVersion: 2, reason: "核实原供应商交易后恢复" });
  assert.equal(calls[0][0], `/cregis/refunds/cases/${maxId}/recover`);
  assert.equal(calls[0][1].idempotencyPrefix, "cregis-exception");
  assert.equal(JSON.parse(calls[0][1].body).providerCid, maxId);
});

function harness({ mode = "UNCONFIGURED", authority = true, command, read, list } = {}) {
  const empty = { records: [], hasMore: false, nextBeforeId: null };
  let state = [{ mode, feeUsdt: "0", version: 2 }, [], empty, empty, empty, empty, "", false, false,
    "OBSERVATION:3", "CLAIM_CREDIT", "7", "", null, null];
  let refs = [], mountedKey;
  const confirms = [], calls = [], readCalls = [];
  const fullRights = ["finance_d1_read", "finance_d1_channel_manage", ...(authority ? ["finance_d2_withdrawal_approve"] : [])];
  let epoch = 1, auth = { isAuthenticated: true, authEpoch: 1, session: { adminId: 1, authorities: fullRights } };
  const authHook = Object.assign(selector => selector(auth), { getState: () => auth });
  let index = 0, refIndex = 0;
  const exports = load("app/components/domain-views/d-tabs/cregis-exceptions.tsx", name => {
    if (name === "react") return {
      useState(initial) { const ownerState = state, slot = index++; if (!(slot in ownerState)) ownerState[slot] = initial; return [ownerState[slot], next => { ownerState[slot] = typeof next === "function" ? next(ownerState[slot]) : next; }]; },
      useCallback: value => value, useEffect() {}, useRef(current) { const slot = refIndex++; return refs[slot] ??= { current }; },
    };
    if (name === "react/jsx-runtime") return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
    if (name === "@/lib/store/admin-auth") return { useAdminAuth: authHook };
    if (name === "@/lib/admin/auth-lifecycle") return { adminAuthLifecycleEpoch: () => epoch, adminAuthActivityAllowed: () => true };
    if (name === "@/lib/admin/d-client") return { financeAdminRequest: async () => [] };
    if (name === "@/lib/admin/cregis-exceptions") return { ...client,
      exceptionRead: async path => { readCalls.push(path); return read?.(path) ?? { mode, feeUsdt: "0", version: 2 }; },
      exceptionList: async path => { readCalls.push(path); return list?.(path) ?? empty; },
      exceptionCommand: async (path, body) => { calls.push({ path, body }); return command?.(path, body) ?? { challengeId: "4", message: "bound-message", expiresAt: "soon" }; } };
    throw new Error(name);
  });
  function render() {
    const outer = exports.CregisExceptionOperations({ canManage: true,
      openActionConfirm: value => confirms.push(value), sources: [{ sourceType: "OBSERVATION", sourceId: "3", title: "原资金" }] });
    if (!outer) return outer;
    if (mountedKey !== undefined && mountedKey !== outer.key) { state = []; refs = []; }
    mountedKey = outer.key; index = 0; refIndex = 0;
    return outer.type(outer.props);
  }
  const walk = node => !node || typeof node !== "object" ? [] : Array.isArray(node)
    ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
  const find = predicate => { const node = walk(render()).find(predicate); assert.ok(node, "Actual UI control not found"); return node; };
  return { get state() { return state; }, confirms, calls, readCalls, find, render,
    changeOwner(adminId = 2, rights = fullRights) { epoch++; auth = { isAuthenticated: true, authEpoch: auth.authEpoch + 1, session: { adminId, authorities: rights } }; return render(); },
    revokeRefundWithoutEpoch() { auth = { ...auth, session: { ...auth.session, authorities: ["finance_d1_read", "finance_d1_channel_manage"] } }; },
  };
}
test("actual UI disables refund until configured and hides it without withdrawal authority", () => {
  const h = harness();
  assert.equal(h.find(n => n.type === "option" && n.props.value === "REFUND_ORIGIN").props.disabled, true);
  const limited = harness({ authority: false });
  assert.equal(JSON.stringify(limited.render()).includes('"value":"REFUND_ORIGIN"'), false);
});
test("changing target invalidates signature and discards late challenge response", async () => {
  let resolve;
  const h = harness({ command: () => new Promise(done => { resolve = done; }) });
  const inFlight = h.find(n => n.type === "button" && n.props.children === "生成钱包签名原文").props.onClick();
  h.find(n => n.type === "input" && n.props["aria-label"] === "认领用户编号").props.onChange({ target: { value: "8" } });
  resolve({ challengeId: "4", message: "for-old-user" });
  await inFlight; await Promise.resolve();
  assert.equal(h.state[13], null); assert.equal(h.state[14], null); assert.equal(h.state[12], "");
});
test("actual fee form rejects invalid fee before dispatch and sends exact approved proposal inputs", async () => {
  const h = harness();
  h.find(n => n.type === "button" && n.props.children === "配置退款手续费").props.onClick();
  assert.equal(h.confirms.length, 1);
  // Stop after transport; refresh is deliberately not a fixture of the whole server.
  assert.throws(() => h.confirms[0].run("为异常退款建立经批准费率", undefined, { mode: "FIXED_USDT", fee: "-1" }));
  assert.equal(h.calls.length, 0);
  await h.confirms[0].run("为异常退款建立经批准费率", undefined, { mode: "FIXED_USDT", fee: "0.123456" });
  assert.deepEqual(plain(h.calls[0]), { path: "/refunds/fee-policy/cases", body: {
    expectedVersion: 2, mode: "FIXED_USDT", feeUsdt: "0.123456", reason: "为异常退款建立经批准费率",
  } });
});

test("switching administrator rejects the retained fee confirmation before any request", async () => {
  const h = harness();
  h.find(n => n.type === "button" && n.props.children === "配置退款手续费").props.onClick();
  h.changeOwner();
  await assert.rejects(h.confirms[0].run("为异常退款建立经批准费率", undefined, { mode: "PLATFORM_PAYS", fee: "0" }), /登录身份或权限已变化/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.state[0], null); assert.equal(h.state[13], null); assert.equal(h.state[14], null);
});
test("retained confirmation rechecks current refund authority even before epoch notification", async () => {
  const h = harness();
  h.find(n => n.type === "button" && n.props.children === "配置退款手续费").props.onClick();
  h.revokeRefundWithoutEpoch();
  await assert.rejects(h.confirms[0].run("为异常退款建立经批准费率", undefined, { mode: "PLATFORM_PAYS", fee: "0" }), /登录身份或权限已变化/);
  assert.equal(h.calls.length, 0);
});
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
test("late ownership challenge cannot populate the next administrator's signature form", async () => {
  let finish;
  const h = harness({ command: () => new Promise(resolve => { finish = resolve; }) });
  h.find(n => n.type === "button" && n.props.children === "生成钱包签名原文").props.onClick();
  const previous = h.state;
  h.changeOwner();
  finish({ challengeId: "4", message: "previous-admin-proof" }); await settle();
  assert.equal(previous[13], null); assert.equal(h.state[13], null); assert.equal(h.state[12], "");
});
test("late exception lists cannot replace a new owner's state", async () => {
  const finishes = [];
  const h = harness({ list: () => new Promise(resolve => finishes.push(resolve)) });
  h.find(n => n.type === "button" && n.props.children === "刷新异常处置").props.onClick();
  h.changeOwner();
  finishes.forEach(resolve => resolve({ records: [{ id: "19", reason: "old-owner-record" }], hasMore: false, nextBeforeId: null }));
  await settle();
  assert.equal(h.state[0], null); assert.equal(h.state[2].records.length, 0);
  assert.equal(JSON.stringify(h.render()).includes("old-owner-record"), false);
});
test("scoped command passes auth epoch to durable transport and rejects a late success", async () => {
  let current = true; const calls = [];
  const actual = load("lib/admin/cregis-exceptions.ts", () => ({ financeAdminRequest: async (...args) => { calls.push(args); current = false; return { id: "9" }; } }));
  const scope = { authEpoch: 37, assertOwner() { if (!current) throw new Error("stale owner"); } };
  await assert.rejects(actual.exceptionCommand("/refunds/fee-policy/cases", { mode: "PLATFORM_PAYS" }, scope), /stale owner/);
  assert.equal(calls[0][1].bankManualAuthEpoch, 37); assert.equal(calls[0][1].idempotencyPrefix, "cregis-exception");
  await assert.rejects(actual.exceptionCommand("/refunds/fee-policy/cases", {}, scope), /stale owner/);
  assert.equal(calls.length, 1);
});
