import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const component = ts.transpileModule(read("../app/components/domain-views/f-tabs/f2-rates.tsx"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
const tree = (type, props, key) => ({ type, props: { ...props, key } });
new Function("require", "exports", "module", component)((name) => {
  if (name === "react/jsx-runtime") return { jsx: tree, jsxs: tree, Fragment: Symbol("Fragment") };
  if (name.endsWith("design-kit")) return { CodeTag: () => null };
  if (name.endsWith("f2-depth-gate")) return { f2EnumGateSpec: () => null };
  if (name.endsWith("f2-direct-policy")) return { F2DirectPolicy: () => null };
  throw new Error(`unexpected F2 dependency: ${name}`);
}, exports, { exports });

function* walk(node) {
  if (Array.isArray(node)) { for (const child of node) yield* walk(child); }
  else if (node && typeof node === "object") { yield node; yield* walk(node.props?.children); }
}

function coolingAction(canonical) {
  let action;
  const rendered = exports.F2Rates({ ctx: {
    f2Unilevel: [{ l: "L1", usdt: 10, nex: 50, off: false }], f2Metrics: [], f2RateTiers: [], f2Guardrails: [], f2CommissionPolicy: {},
    f2ConfigValues: canonical === undefined ? {} : { "F.cooldown": canonical },
    // An old UI mirror is not the canonical commission/cooling-days value.
    f2Params: [{ id: "cool", name: "佣金冷却", key: "F.cooldown", value: "21d", def: "", amp: true, vamp: true, unit: "天" }],
    can: () => true, openActionConfirm: (value) => { action = value; },
  } });
  const row = [...walk(rendered)].find((node) => node.props?.key === "cool");
  assert.ok(row, "actual F2 cooling row must render");
  [...walk(row)].find((node) => node.type === "button").props.onClick();
  return action;
}

// Execute the existing shared modal's actual directional guard, without a browser or a cloned rule.
const modal = ts.createSourceFile("design-kit.tsx", read("../app/components/domain-views/design-kit.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["currentNumber", "newNumber", "directionalAmplifies", "effectiveAmplifies", "covBlocked"]);
const statements = [];
function visit(node) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => names.has(item.name.getText(modal)))) statements.push(node.getText(modal));
  ts.forEachChild(node, visit);
}
visit(modal);
assert.equal(statements.length, names.size);
const blocked = new Function("spec", "newVal", "amplifies", "coverage", statements.join("\n") + "\nreturn covBlocked;");
const lowCoverage = { coverageRatio: 98.62, redlinePct: 100 };

test("F2 opens the cooling editor from its canonical effective days, including the existing default", () => {
  for (const [raw, expected] of [[undefined, "30"], ["", "30"], ["invalid", "30"], ["-1", "30"], ["1.5", "30"], ["91", "30"], ["0", "0"], ["30", "30"], ["45", "45"]]) {
    const action = coolingAction(raw);
    assert.equal(action.edit.current, expected, `canonical ${raw}`);
    assert.equal(action.edit.amplifiesWhen, "decrease");
  }
});

test("the actual F2 action and shared modal block only shortening below B1, leaving restoration operable", () => {
  const action = coolingAction("30");
  assert.equal(blocked(action.edit, "0", action.amplify, lowCoverage), true);
  assert.equal(blocked(action.edit, "30", action.amplify, lowCoverage), false);
  assert.equal(blocked(action.edit, "45", action.amplify, lowCoverage), false);
  const zero = coolingAction("0");
  assert.equal(blocked(zero.edit, "30", zero.amplify, lowCoverage), false);
  assert.equal(blocked(action.edit, "0", action.amplify, { coverageRatio: 100, redlinePct: 100 }), false);
});
