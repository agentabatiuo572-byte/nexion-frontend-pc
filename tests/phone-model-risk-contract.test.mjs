import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const load = (file, requireFn = () => ({})) => {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: module.exports, require: requireFn });
  return module.exports;
};
const rules = load("lib/admin/ios-model-rules.ts");
const risk = load("lib/admin/phone-risk-client.ts", id => id.endsWith("error-messages") ? { guardedFetch: () => null, formatAdminApiError: m => m } : {});
const routes = load("lib/admin/phone-replacement-routes.ts");
const ios = (extra = {}) => ({ id: "ios-8", model: "iPhone 8", aliases: [], minComputeValue: 1, maxComputeValue: 2, enabled: true,
  valueSource: "OPERATOR_PRESET", catalogClass: null, note: null, minOsVersion: null, maxOsMajor: null, scales: [], screens: [], ...extra });

test("iPhone device facts are optional, validated like the server and shown in diffs", () => {
  assert.deepEqual(rules.iosRuleIssues([ios({ minOsVersion: "11.0", maxOsMajor: 16, scales: [2], screens: ["375x667"] })]).length, 0);
  // A rule stored before the facts existed has none of them.
  const { minOsVersion, maxOsMajor, scales, screens, ...legacy } = ios();
  assert.equal(rules.iosRuleIssues([legacy]).length, 0);
  const fields = rules.iosRuleIssues([ios({ minOsVersion: "iOS 11", maxOsMajor: 0, scales: [4], screens: ["big"] })]).map(issue => issue.field);
  assert.equal(JSON.stringify(fields), JSON.stringify(["minOsVersion", "maxOsMajor", "scales", "screens"]));
  assert.equal(rules.iosRuleIssues([ios({ minOsVersion: "17.0", maxOsMajor: 16 })])[0].field, "maxOsMajor");
  assert.equal(rules.screenKey("874x402"), "402x874");
  const change = rules.diffIosRules([ios()], [ios({ minOsVersion: "11.0", scales: [2] })])[0];
  assert.equal(change.kind, "modified");
  assert.match(change.details.join(" "), /设备信息 未填写 → iOS 11\.0–最新 · @2x/);
  assert.equal(rules.normalizeIosRule(legacy).scales.length, 0);
  // Presets supply facts only to existing models that have none, and change nothing else.
  const preset = ios({ minComputeValue: 9, maxComputeValue: 9, minOsVersion: "11.0", scales: [2] });
  const plan = rules.planIosImport([ios(), ios({ id: "ios-x", model: "iPhone X", scales: [3] })],
    [preset, ios({ id: "ios-x", model: "iPhone X", scales: [3], minOsVersion: "11.0" })]);
  assert.equal(JSON.stringify(plan.factsFilled.map(fill => [fill.id, fill.facts.minOsVersion, fill.facts.scales])),
    JSON.stringify([["ios-8", "11.0", [2]]]));
  assert.equal(plan.added.length, 0);
});

test("risk settings keep display size and account churn observe-only and need a reason", () => {
  const update = { installModelLock: "ENFORCE", osVersion: "OBSERVE", screenScale: "OBSERVE", screenSize: "OBSERVE",
    missingSignals: "OBSERVE", accountModelChurn: "OBSERVE", churnWindowDays: 30, churnModelCount: 3, reason: "灰度观察结束，开启拦截" };
  assert.equal(risk.riskSettingsError(update), null);
  assert.match(risk.riskSettingsError({ ...update, screenSize: "ENFORCE" }), /屏幕尺寸/);
  assert.match(risk.riskSettingsError({ ...update, accountModelChurn: "ENFORCE" }), /同一账号/);
  assert.match(risk.riskSettingsError({ ...update, churnModelCount: 1 }), /机型数/);
  assert.match(risk.riskSettingsError({ ...update, reason: "太短" }), /理由/);
  const overview = { settings: { revision: 2, ...update, reason: "x", updatedAt: 1, updatedBy: 7 },
    stats: { days: 7, checks: [{ code: "MODEL_CHANGED", flagged: 3, held: 3, accounts: 2 }], models: [] } };
  assert.equal(risk.parsePhoneRiskOverview(overview).settings.revision, 2);
  assert.throws(() => risk.parsePhoneRiskOverview({ ...overview, settings: { ...overview.settings, osVersion: "BLOCK" } }));
});

test("C5 support reaches only the model-lock list and its release through the user proxy", () => {
  assert.deepEqual({ ...routes.phoneUserRoute(["profiles", "9", "phone-model-locks"]) }, { path: "/api/admin/users/profiles/9/phone-model-locks", method: "GET" });
  assert.deepEqual({ ...routes.phoneUserRoute(["profiles", "9", "phone-model-locks", "install.a:1", "release"]) },
    { path: "/api/admin/users/profiles/9/phone-model-locks/install.a%3A1/release", method: "POST" });
  for (const parts of [["profiles", "9", "phone-model-locks", "a"], ["profiles", "9", "phone-model-locks", "a b", "release"],
    ["profiles", "9", "phone-model-locks", "..", "release"], ["profiles", "9", "phone-model-locks", ".", "release"],
    ["profiles", "9", "phone-model-locks", "a", "delete"]]) assert.equal(routes.phoneUserRoute(parts), null);
});
