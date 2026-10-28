import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { readAdminSessionBaseline } from "../lib/admin/session-baseline.ts";

const source = ts.createSourceFile("a1-accounts.tsx", readFileSync(new URL("../app/components/domain-views/a-tabs/a1-accounts.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let adjust;
const declarations = new Map(); let sessionRows;
function visit(node) {
  if (ts.isVariableDeclaration(node)) {
    declarations.set(node.name.getText(source), node.getText(source));
    if (node.name.getText(source) === "adjustBaseline") adjust = node.initializer;
  }
  if (ts.isIfStatement(node) && node.expression.getText(source) === 'registeredBaseline("session")') sessionRows = node.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
function loadRows(value, summary = false) {
  const scope = { securityBaselines: [{ key: "session", value }], readAdminSessionBaseline };
  const keys = ["SECURITY_BASELINE_META", "backendSessionBaseline", "parsedSessionBaseline", "baselineCurrent", "registeredBaseline", "securityBaselineRows", "baselineDisplay", "sessionBaseline"];
  vm.runInNewContext(ts.transpileModule(keys.map((key) => `var ${declarations.get(key)};`).join("\n")
    + `\n${sessionRows}\nvar result = securityBaselineRows.map(row => ({ key: row.key, current: row.current, unit: row.unit, locked: row.locked, display: baselineDisplay(row) }));`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, scope);
  return summary ? scope.sessionBaseline : JSON.parse(JSON.stringify(scope.result));
}
function loadAction(value = "60min / unlimited") {
  const messages = [], commands = []; let confirmation;
  const scope = { toast: (text) => messages.push(text), jsx: () => null, Fragment: "fragment",
    parsedSessionBaseline: readAdminSessionBaseline(value),
    openActionConfirm: (spec) => { confirmation = spec; },
    baselineCurrent: (key) => key === "lock_short_min" ? "15" : null,
    baselineDisplay: () => "5 次", registeredBaseline: () => ({ value: "5 次 / 15min" }),
    findHighOp: () => ({ gateLabel: "fixture", buildCommand: (value) => value, buildTarget: (value) => value }),
    propose: (_toast, proposal) => commands.push(proposal.command),
  };
  vm.runInNewContext(ts.transpileModule(`var runAdjust = ${adjust.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "jsx", jsxFragmentFactory: "Fragment" },
  }).outputText, scope);
  return { messages, commands, run: scope.runAdjust, confirmation: () => confirmation };
}

test("A1 displays server 60min/unlimited facts while retaining unknown and legacy evidence", () => {
  assert.deepEqual(readAdminSessionBaseline("60min / unlimited"), { idleDisabled: false, idleMinutes: "60", absoluteHours: null, unlimited: true });
  assert.deepEqual(readAdminSessionBaseline("30min / 8h"), { idleDisabled: false, idleMinutes: "30", absoluteHours: "8", unlimited: false });
  for (const unknown of [undefined, "", "unknown"]) assert.deepEqual(readAdminSessionBaseline(unknown), { idleDisabled: false, idleMinutes: null, absoluteHours: null, unlimited: false });
});

test("actual A1 action refuses both session edits even if a stale backend reports unlocked", () => {
  const fixture = loadAction();
  for (const key of ["session_idle", "session_abs"]) fixture.run({ key, sourceKey: "session", locked: false, current: "8", min: 4, max: 12 });
  assert.equal(fixture.confirmation(), undefined); assert.equal(fixture.commands.length, 0);
  assert.equal(fixture.messages.length, 2); assert.ok(fixture.messages.every((text) => text.includes("60 分钟") && text.includes("无固定登录上限")));
});

test("actual A1 lock-baseline edit still emits its original lock contract and expected value", () => {
  const fixture = loadAction();
  fixture.run({ key: "lock_short_cnt", sourceKey: "lock", name: "短锁次数", locked: false, current: "5", unit: "次", min: 3, max: 10 });
  fixture.confirmation().run("fixture reason", "6 次");
  assert.equal(fixture.messages.length, 0); assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.commands[0].baselineKey, "lock"); assert.equal(fixture.commands[0].value, "6 次 / 15min");
  assert.equal(fixture.commands[0].expectedValue, "5 次 / 15min");
});

test("A1 explicitly renders disabled idle as 已停用 without a minute unit and keeps the session rows locked", () => {
  assert.deepEqual(readAdminSessionBaseline("disabled / unlimited"), { idleDisabled: true, idleMinutes: null, absoluteHours: null, unlimited: true });
  assert.deepEqual(loadRows("disabled / unlimited"), [
    { key: "session_idle", current: "已停用", locked: true, display: "已停用" },
    { key: "session_abs", current: "无固定上限", locked: true, display: "无固定上限" },
  ]);
  assert.deepEqual(loadRows("60min / unlimited"), [
    { key: "session_idle", current: "60", unit: "分钟", locked: true, display: "60 分钟" },
    { key: "session_abs", current: "无固定上限", locked: true, display: "无固定上限" },
  ]);
  assert.deepEqual(loadRows("30min / 8h"), [
    { key: "session_idle", current: "30", unit: "分钟", locked: true, display: "30 分钟" },
    { key: "session_abs", current: "8", unit: "小时", locked: true, display: "8 小时" },
  ]);
  assert.ok(loadRows(undefined).every((row) => row.current === null && row.display === "—" && row.locked));
  assert.equal(loadRows("disabled / unlimited", true), "无操作自动登出已关闭 / 无固定登录上限");
  assert.equal(loadRows("disabled / 8h", true), "无操作自动登出已关闭 / 最长保持登录 8 小时");
  assert.equal(loadRows("disabled / unknown", true), "无操作自动登出已关闭 / 最长登录时间未获取到");
});

test("actual A1 session adjustment copy follows disabled, legacy and unknown server facts without opening an edit", () => {
  for (const [value, expected] of [["disabled / unlimited", ["无操作自动登出已关闭", "无固定登录上限"]],
    ["30min / 8h", ["30 分钟", "最长保持登录 8 小时"]], ["unknown", ["无操作登出时间未获取到", "最长登录时间未获取到"]]]) {
    const fixture = loadAction(value);
    for (const key of ["session_idle", "session_abs"]) fixture.run({ key, sourceKey: "session", locked: false, current: "8" });
    assert.equal(fixture.confirmation(), undefined); assert.equal(fixture.commands.length, 0);
    assert.equal(fixture.messages.length, 2);
    assert.ok(fixture.messages.every((message) => expected.every((text) => message.includes(text))));
    assert.ok(fixture.messages.every((message) => !message.includes("60 分钟")));
  }
});
