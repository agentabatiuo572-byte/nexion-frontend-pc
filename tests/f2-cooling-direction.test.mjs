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
const depthGate = {};
new Function("exports", ts.transpileModule(read("../lib/admin/f2-depth-gate.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(depthGate);
const client = ts.createSourceFile("f1-client.ts", read("../lib/admin/f1-client.ts"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const normalizerFunctions = new Set(["normalizeF2Overview", "asText", "optionalText", "toBoolean", "toNumber"]);
const normalizerModule = { exports: null };
new Function("module", ts.transpileModule(client.statements
  .filter((statement) => ts.isFunctionDeclaration(statement) && normalizerFunctions.has(statement.name?.text))
  .map((statement) => statement.getText(client)).join("\n") + "\nmodule.exports = normalizeF2Overview;", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(normalizerModule);
new Function("require", "exports", "module", component)((name) => {
  if (name === "react/jsx-runtime") return { jsx: tree, jsxs: tree, Fragment: Symbol("Fragment") };
  if (name.endsWith("design-kit")) return { CodeTag: () => null };
  if (name.endsWith("f2-depth-gate")) return depthGate;
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

test("F2 opens the cooling editor only from valid canonical days and leaves unconfigured drafts empty", () => {
  for (const [raw, expected] of [[undefined, ""], ["", ""], ["__UNCONFIGURED__", ""], ["invalid", ""], ["-1", ""], ["1.5", ""], ["91", ""], ["0", "0"], ["30", "30"], ["45", "45"]]) {
    const action = coolingAction(raw);
    assert.equal(action.edit.current, expected, `canonical ${raw}`);
    assert.equal(action.edit.amplifiesWhen, expected === "" ? undefined : "decrease");
    assert.equal(blocked(action.edit, "45", action.amplify, lowCoverage), expected === "", `unconfigured ${raw} cannot bypass B1`);
  }
});

const baseContext = (overrides = {}) => ({
  f2Unilevel: [], f2Metrics: [], f2RateTiers: [], f2Guardrails: [], f2CommissionPolicy: {},
  f2ConfigValues: {}, f2Params: [], f2Loading: false, f2Error: null,
  can: () => true, openActionConfirm: () => {}, ...overrides,
});
const render = (overrides) => exports.F2Rates({ ctx: baseContext(overrides) });
const copy = (node) => [...walk(node)].flatMap((item) => {
  const children = item.props?.children;
  return (Array.isArray(children) ? children : [children]).filter((child) => typeof child === "string" || typeof child === "number");
}).join(" ");

test("F2 empty history still renders independent configuration with no invented current values", async () => {
  let action;
  let updates = 0;
  const rendered = render({
    openActionConfirm: (value) => { action = value; }, updateF2Config: async () => { updates += 1; },
    f2ConfigValues: { "F.pool.ratio": "__UNCONFIGURED__" },
  });
  const content = copy(rendered);
  assert.match(content, /Partner Status 权益档/);
  assert.match(content, /其他奖励冷却期/);
  assert.match(content, /暂无历史 L1–L7 费率数据/);
  assert.doesNotMatch(content, /5000|50000|500000|30 天|固定 10%/);
  const button = [...walk(rendered)].find((item) => item.type === "button" && item.props.children === "配置权益门槛");
  button.props.onClick();
  assert.deepEqual(action.businessForm.fields.map((field) => field.current), ["", "", "", ""]);
  await assert.rejects(() => action.run("空草稿不能写入", { standard: "", verified: "", premium: "", diamond: "" }), /请填写全部 4 档/);
  assert.equal(updates, 0);
});

test("F2 actual normalizer never presents a default as a current historical value", () => {
  for (const value of [undefined, null, "", " "]) {
    const snapshot = normalizerModule.exports({
      policyParams: [{ id: "promo", name: "旧 promo 倍率", key: "F.promo.weekMultiplier", value, defaultValue: "1.2" }],
    });
    assert.equal(snapshot.params[0].value, "");
    assert.equal(snapshot.params[0].def, "1.2");
    assert.doesNotMatch(copy(render({ f2Params: snapshot.params })), /1\.2/);
  }
  const snapshot = normalizerModule.exports({ policyParams: [{ id: "promo", name: "旧 promo 倍率", key: "F.promo.weekMultiplier", value: "1.4", defaultValue: "1.2" }] });
  assert.equal(snapshot.params[0].value, "1.4");
});

test("F2 partner thresholds show only a complete valid server configuration and retain the confirmed A2 write", async () => {
  for (const raw of ["", "__UNCONFIGURED__", "invalid", "null", '{"standard":0}', '{"standard":0,"verified":5,"premium":4,"diamond":10}']) {
    const content = copy(render({ f2ConfigValues: { "F.partner.tiers": raw } }));
    assert.doesNotMatch(content, /当前 \$/);
  }
  let action;
  let saved;
  const rendered = render({
    f2ConfigValues: { "F.partner.tiers": '{"standard":0,"verified":25,"premium":250,"diamond":2500}' },
    openActionConfirm: (value) => { action = value; }, toast: () => {},
    updateF2Config: async (...value) => { saved = value; },
  });
  assert.match(copy(rendered), /当前 \$0\/\$25\/\$250\/\$2500/);
  [...walk(rendered)].find((item) => item.type === "button" && item.props.children === "调整权益门槛").props.onClick();
  assert.match(action.completionCopy, /A2/);
  await assert.rejects(() => action.run("不可保存倒序门槛", { standard: "0", verified: "20", premium: "10", diamond: "30" }), /非递减/);
  assert.equal(saved, undefined);
  await action.run("保存有效权益门槛", { standard: "0", verified: "20", premium: "200", diamond: "2000" });
  assert.deepEqual(saved, ["F.partner.tiers", '{"standard":0,"verified":20,"premium":200,"diamond":2000}', "保存有效权益门槛"]);
});

test("F2 historical rates, pauses and business parameters render read-only without exposing technical guardrails", () => {
  const rendered = render({
    f2Unilevel: Array.from({ length: 7 }, (_, index) => ({ l: `L${index + 1}`, usdt: index + 2, nex: index + 0.5, ui: "历史分层", direct: index === 0 })),
    f2ConfigValues: { "F.unilevel.L1.paused": "on", "F.unilevel.L2.paused": "off", "F.unilevel.depthGate": "L4", "F.unilevel.depthGateRank": "0.4", "F.influence.clampMin": "0.8", "F.promo.weekMultiplier": "1.2", "F.unilevel.mergeExitMaxPct": "25" },
    f2Metrics: [{ id: "old", name: "旧指标", value: "18 USDT", sub: "旧读数" }],
    f2Params: [{ id: "depth", name: "旧深度", key: "F.unilevel.depthGate", value: "L4", sub: "depthGate 字段" }, { id: "rank", name: "旧等级", key: "F.unilevel.depthGateRank", value: "0.4" }, { id: "influence", name: "InfluenceScore 下限", key: "F.influence.clampMin", value: "0.8", sub: "clamp 运算" }, { id: "promo", name: "promo 倍率", key: "F.promo.weekMultiplier", value: "1.2", sub: "peer 字段" }, { id: "cap", name: "旧封顶", key: "F.unilevel.nexCap", value: "$50/d" }, { id: "backfill", name: "旧回溯", key: "F.unilevel.backfill", value: "0d" }],
    f2Guardrails: ["B1 coverageRatio=0 redline100", "Idempotency-Key", "confirm-with-reason", "wallet mapper"],
  });
  const history = [...walk(rendered)].find((node) => node.type === "section" && copy(node).includes("历史网络版税"));
  assert.ok(history);
  assert.equal([...walk(history)].filter((node) => node.type === "button").length, 0);
  const content = copy(history);
  for (const text of ["L1", "L7", "2", "0.5", "NEX/USDT版税", "已暂停", "未暂停", "L4", "历史值无效", "影响分下限", "活动周倍率", "合并出口保护上限", "25", "旧指标", "18 USDT", "NEX 日封顶（旧引擎未接入）", "回溯窗口（旧引擎未接入）"]) assert.ok(content.includes(text), text);
  assert.doesNotMatch(content, /固定 10%|下一笔结算生效|InfluenceScore|clamp|promo|peer|coverageRatio|Idempotency-Key|confirm-with-reason|wallet mapper/);
});

test("F2 loading and failure never expose independent writes while direct policy remains mounted", () => {
  for (const overrides of [{ f2Loading: true }, { f2Error: "非法历史快照" }]) {
    const rendered = render(overrides);
    const buttons = [...walk(rendered)].filter((node) => node.type === "button");
    assert.deepEqual(buttons.map((node) => node.props.children), overrides.f2Error ? ["重试"] : []);
    assert.ok([...walk(rendered)].some((node) => typeof node.type === "function"), "direct policy remains independently mounted");
  }
  assert.equal([...walk(render({ can: () => false }))].filter((node) => node.type === "button").length, 0);
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
