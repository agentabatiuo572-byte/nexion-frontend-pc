import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { readAdminSessionBaseline } from "../lib/admin/session-baseline.ts";

const source = ts.createSourceFile("a1-accounts.tsx", readFileSync(new URL("../app/components/domain-views/a-tabs/a1-accounts.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let adjust;
function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(source) === "adjustBaseline") adjust = node.initializer; ts.forEachChild(node, visit); }
visit(source);
function loadAction() {
  const messages = [], commands = []; let confirmation;
  const scope = { toast: (text) => messages.push(text), jsx: () => null, Fragment: "fragment",
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
  assert.deepEqual(readAdminSessionBaseline("60min / unlimited"), { idleMinutes: "60", absoluteHours: null, unlimited: true });
  assert.deepEqual(readAdminSessionBaseline("30min / 8h"), { idleMinutes: "30", absoluteHours: "8", unlimited: false });
  for (const unknown of [undefined, "", "unknown"]) assert.deepEqual(readAdminSessionBaseline(unknown), { idleMinutes: null, absoluteHours: null, unlimited: false });
});

test("actual A1 action refuses both session edits even if a stale backend reports unlocked", () => {
  const fixture = loadAction();
  for (const key of ["session_idle", "session_abs"]) fixture.run({ key, sourceKey: "session", locked: false, current: "8", min: 4, max: 12 });
  assert.equal(fixture.confirmation(), undefined); assert.equal(fixture.commands.length, 0);
  assert.equal(fixture.messages.length, 2); assert.ok(fixture.messages.every((text) => text.includes("60分钟") && text.includes("无固定登录上限")));
});

test("actual A1 lock-baseline edit still emits its original lock contract and expected value", () => {
  const fixture = loadAction();
  fixture.run({ key: "lock_short_cnt", sourceKey: "lock", name: "短锁次数", locked: false, current: "5", unit: "次", min: 3, max: 10 });
  fixture.confirmation().run("fixture reason", "6 次");
  assert.equal(fixture.messages.length, 0); assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.commands[0].baselineKey, "lock"); assert.equal(fixture.commands[0].value, "6 次 / 15min");
  assert.equal(fixture.commands[0].expectedValue, "5 次 / 15min");
});
