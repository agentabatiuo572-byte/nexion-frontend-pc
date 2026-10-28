import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { findHighOp } from "../lib/admin/high-ops-registry.ts";
import { createSlotAttemptStore, createPendingMutationStore } from "../lib/admin/pending-mutation-store.ts";
import { formatBusinessTime } from "../lib/admin/business-time.ts";

const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const tree = (type, props) => ({ type, props });
const exported = {};
new Function("require", "exports", compile(read("../app/components/domain-views/f-tabs/f2-seven-layer-activation.tsx")))(name => {
  if (name === "react/jsx-runtime") return { jsx: tree, jsxs: tree };
  if (name === "react") return { useState: value => [value, () => {}], useEffect: () => {} };
  if (name === "next/link") return { default: "a" };
  if (name.endsWith("business-time")) return { formatBusinessTime };
  if (name.endsWith("error-messages")) return { displayAdminError: error => error.message };
  throw new Error(`unexpected dependency ${name}`);
}, exported);
function* walk(n) { if (Array.isArray(n)) { for (const x of n) yield* walk(x); } else if (n && typeof n === "object") { yield n; yield* walk(n.props?.children); } }
function text(n) { if (Array.isArray(n)) return n.map(text).join(""); return n && typeof n === "object" ? text(n.props?.children) : n == null ? "" : String(n); }
const policy = patch => ({ sevenLayerActivationContractVersion: 1, sevenLayerEnabled: false, sevenLayerPaused: false, sevenLayerRevision: 0, policyVersion: 4, cutoverAt: null, ...patch });
function fixture(patch = {}, context = {}) {
  const confirmations = [], requests = [];
  const ctx = { f2DirectPolicy: policy(patch), f2DirectPolicyLoading: false, f2DirectPolicyError: null, f2ActivationPending: null, f2ActivationPendingLoading: false, f2ActivationPendingError: null, can: () => true, openActionConfirm: x => confirmations.push(x), changeF2SevenLayerActivation: async (...args) => requests.push(args), refreshF2: async () => {}, ...context };
  const rendered = exported.F2SevenLayerActivation({ ctx });
  const button = [...walk(rendered)].find(n => n.type === "button" && n.props.className.includes("primary"));
  return { ctx, rendered, button, confirmations, requests };
}

for (const [patch, action, label] of [[{}, "ACTIVATE", "启用七层结算"], [{ sevenLayerEnabled: true }, "PAUSE", "暂停七层结算"], [{ sevenLayerEnabled: true, sevenLayerPaused: true }, "RESUME", "恢复七层结算"]]) {
  test(`actual F2 ${action} confirms independently and forwards only the captured versions`, async () => {
    const f = fixture(patch); assert.equal(f.button.props.disabled, false); assert.equal(text(f.button), label);
    f.button.props.onClick(); const c = f.confirmations[0];
    assert.equal(c.amplify, action !== "PAUSE"); assert.equal(c.edit, undefined); assert.equal(c.businessForm, undefined);
    assert.match(c.completionCopy, /另一位管理员/);
    await c.run("审批理由至少八个字"); assert.deepEqual(f.requests, [[action, 0, 4, "审批理由至少八个字"]]);
    if (action === "RESUME") assert.match(c.detail, /补算暂停期间积压的订单/);
  });
}
test("actual read model blocks repeat proposals while pending and preserves error versus absent state", () => {
  for (const overrides of [{ f2ActivationPending: { id: "original-ticket", action: "七层结算启用" } }, { f2ActivationPendingError: "审批进度读取失败" }, { f2ActivationPendingLoading: true }, { f2DirectPolicyError: "failed" }, { f2DirectPolicy: null }]) {
    const f = fixture({}, overrides); assert.equal(f.button.props.disabled, true); f.button.props.onClick(); assert.equal(f.confirmations.length, 0);
  }
  assert.match(text(fixture({}, { f2ActivationPending: { id: "original-ticket", action: "七层结算启用" } }).rendered), /待另一位管理员审批/);
});
test("old backend capability is readonly and readonly roles have no mutation button", () => {
  for (const version of [undefined, null, 2]) { const f = fixture({ sevenLayerActivationContractVersion: version }); assert.equal(f.button.props.disabled, true); f.button.props.onClick(); assert.equal(f.confirmations.length, 0); }
  for (const denied of ["network_f2_policy_amplify", "platform_a2_proposal_create"]) assert.equal(fixture({}, { can: key => key !== denied }).button, undefined);
});
test("enabled state displays actual server time and keeps historical boundaries visible", () => {
  const f = fixture({ sevenLayerEnabled: true, cutoverAt: "2026-10-18T04:33:24Z" });
  assert.equal([...walk(f.rendered)].find(n => n.type === "time").props.dateTime, "2026-10-18T04:33:24Z");
  assert.match(text(f.rendered), /12:33:24（北京时间）/);
  assert.match(text(f.rendered), /启用前的订单仍按旧规则/); assert.match(text(f.rendered), /直属拆分需要在下方另外设置/);
});

const source = ts.createSourceFile("f-view.tsx", read("../app/components/domain-views/f-view.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let mutation, stable;
function visit(n) {
  if (ts.isPropertyAssignment(n) && n.name.getText(source) === "changeF2SevenLayerActivation") mutation = n.initializer.getText(source);
  if (ts.isVariableDeclaration(n) && n.name.getText(source) === "proposeStable") stable = n.initializer.getText(source);
  ts.forEachChild(n, visit);
} visit(source);
function mutationFixture() {
  const attempts = [], refreshes = [];
  const bindings = { can: () => true, f2DirectPolicy: policy(), findHighOp, submitF2Activation: async (...args) => attempts.push(args), propose: async () => {}, setToast: () => {}, createA2CommandKey: () => "test-key", setF2ActivationAttempt: () => {}, pendingF2Activation: () => null, refreshF2: async () => refreshes.push(true) };
  const fn = new Function(...Object.keys(bindings), compile("const fn=" + mutation) + ";return fn;")(...Object.values(bindings));
  return { fn, attempts, refreshes, bindings };
}
for (const action of ["ACTIVATE", "PAUSE", "RESUME"]) test(`actual F shell ${action} uses A2 stable intent, original versions and bounded command`, async () => {
  const f = mutationFixture(); await f.fn(action, 8, 4, "完整测试审批理由"); await f.fn(action, 8, 4, "完整测试审批理由");
  assert.deepEqual(f.attempts[0][0], f.attempts[1][0]);
  const spec = f.attempts[0][0];
  assert.deepEqual(spec.command, { domain: "F", op: "f_seven_layer_activation", params: { action, expectedSevenLayerRevision: 8, expectedPolicyVersion: 4 } });
  assert.deepEqual(spec.target, { domain: "F", type: "seven_layer_activation", id: "current" });
  assert.equal(spec.sourceDomain, "F2"); assert.equal(spec.amplifies, action !== "PAUSE"); assert.equal(spec.type, action === "PAUSE" ? "param" : "fund");
  assert.equal(f.refreshes.length, 2);
});

function attemptModule() {
  const result = {};
  new Function("require", "exports", compile(read("../lib/admin/f2-activation-attempt.ts")))(name => {
    if (name.endsWith("a2-client")) return { isA2OutcomeUncertainError: error => error.name === "A2OutcomeUncertainError" };
    if (name.endsWith("pending-mutation-store")) return { createPendingMutationStore };
    throw new Error(name);
  }, result);
  return result;
}
function sessionStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
test("F2 unknown recovery persists exact payload/key across edits, reload and changed policy state", async () => {
  globalThis.window = { sessionStorage: sessionStorage() };
  try {
    let m = attemptModule(), minted = 0;
    const sent = [], spec = mutationFixture(); await spec.fn("ACTIVATE", 0, 4, "原申请测试审批理由");
    const original = spec.attempts[0][0];
    const lost = Object.assign(new Error("lost"), { name: "A2OutcomeUncertainError" });
    await assert.rejects(m.submitF2Activation(original, async body => { sent.push(body); throw lost; }, () => `key-${++minted}`));
    m = attemptModule(); // actual store reload reads sessionStorage, no component closure survives.
    await assert.rejects(m.submitF2Activation({ ...original, reason: "另一个已经修改理由" }, async body => sent.push(body), () => `key-${++minted}`), /原申请/);
    await assert.rejects(m.submitF2Activation({ ...original, before: "已启用", command: { ...original.command, params: { action: "PAUSE", expectedSevenLayerRevision: 1, expectedPolicyVersion: 4 } } }, async body => sent.push(body), () => `key-${++minted}`), /原申请/);
    await m.submitF2Activation(null, async body => sent.push(body), () => `key-${++minted}`);
    assert.equal(minted, 1); assert.deepEqual(sent[0], sent[1]); assert.equal(m.pendingF2Activation(), null);
  } finally { delete globalThis.window; }
});
test("F2 expired unknown is retained for A2 query only and cannot mint or replay", async () => {
  globalThis.window = { sessionStorage: sessionStorage() };
  const now = Date.now;
  try {
    let m = attemptModule(), sent = 0, minted = 0;
    const original = { command: { op: "f_seven_layer_activation" }, reason: "原申请测试审批理由" };
    await assert.rejects(m.submitF2Activation(original, async () => { sent++; throw Object.assign(new Error("lost"), { name: "A2OutcomeUncertainError" }); }, () => `key-${++minted}`));
    Date.now = () => now() + 24 * 60 * 60 * 1000 + 1; m = attemptModule();
    assert.ok(m.pendingF2Activation());
    await assert.rejects(m.submitF2Activation(null, async () => sent++, () => `key-${++minted}`), /已超过可以重试的时间/);
    assert.equal(sent, 1); assert.equal(minted, 1);
  } finally { Date.now = now; delete globalThis.window; }
});
test("actual F2 unknown banner blocks new actions and checks the original application", async () => {
  let checks = 0;
  const f = fixture({}, { f2ActivationAttempt: { spec: { action: "七层结算启用", reason: "原申请测试审批理由" }, expiresAt: Date.now() + 60000 }, recoverF2SevenLayerActivation: async () => checks++ });
  assert.equal(f.button.props.disabled, true); assert.match(text(f.rendered), /不会重复提交/);
  const recovery = [...walk(f.rendered)].find(n => n.type === "button" && text(n) === "查看原申请");
  recovery.props.onClick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(checks, 1);
});

test("actual F proposal throat retains the same key after an unknown activation submission", async () => {
  const calls = [], failure = Object.assign(new Error("response lost"), { name: "A2OutcomeUncertainError" });
  let lost = true, keys = 0;
  const bindings = {
    commandAttempts: createSlotAttemptStore({ storageKey: "f2-activation-unit-only" }),
    createA2CommandKey: () => `test-command-${++keys}`,
    propose: async (_toast, spec) => { calls.push(spec); if (lost) throw failure; },
    setToast: () => {}, isA2OutcomeUncertainError: error => error === failure,
  };
  const fn = new Function(...Object.keys(bindings), compile("const fn=" + stable) + ";return fn;")(...Object.values(bindings));
  const spec = { command: findHighOp("f_seven_layer_activation").buildCommand({ action: "ACTIVATE", expectedSevenLayerRevision: 0, expectedPolicyVersion: 4 }) };
  await assert.rejects(fn("f-seven-layer-activation", "original-input", spec), error => error === failure);
  lost = false; await fn("f-seven-layer-activation", "original-input", spec);
  assert.equal(keys, 1); assert.equal(calls[0].commandKey, calls[1].commandKey); assert.deepEqual(calls[0].command, calls[1].command);
});
