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

function harness({ mode = "UNCONFIGURED", authority = true, command } = {}) {
  const empty = { records: [], hasMore: false, nextBeforeId: null };
  const state = [{ mode, feeUsdt: "0", version: 2 }, [], empty, empty, empty, empty, "", false, false,
    "OBSERVATION:3", "CLAIM_CREDIT", "7", "", null, null];
  const refs = [], confirms = [], calls = [];
  let index = 0, refIndex = 0;
  const exports = load("app/components/domain-views/d-tabs/cregis-exceptions.tsx", name => {
    if (name === "react") return {
      useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], next => { state[slot] = typeof next === "function" ? next(state[slot]) : next; }]; },
      useCallback: value => value, useEffect() {}, useRef(current) { const slot = refIndex++; return refs[slot] ??= { current }; },
    };
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === "@/lib/store/admin-auth") return { useAdminAuth: selector => selector({ session: { adminId: 1, authorities: authority ? ["finance_d2_withdrawal_approve"] : [] } }) };
    if (name === "@/lib/admin/d-client") return { financeAdminRequest: async () => [] };
    if (name === "@/lib/admin/cregis-exceptions") return { ...client, exceptionCommand: async (path, body) => { calls.push({ path, body }); return command?.(path, body) ?? { challengeId: "4", message: "bound-message", expiresAt: "soon" }; } };
    throw new Error(name);
  });
  function render() { index = 0; refIndex = 0; return exports.CregisExceptionOperations({ canManage: true,
    openActionConfirm: value => confirms.push(value), sources: [{ sourceType: "OBSERVATION", sourceId: "3", title: "原资金" }] }); }
  const walk = node => !node || typeof node !== "object" ? [] : Array.isArray(node)
    ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
  const find = predicate => { const node = walk(render()).find(predicate); assert.ok(node, "Actual UI control not found"); return node; };
  return { state, confirms, calls, find, render };
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
