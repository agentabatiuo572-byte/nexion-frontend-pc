import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { parseE6ComputeConfig, parseE6PhoneBinding } from "../lib/admin/e456-overview-contract.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const client = { exports: {} };
runInNewContext(ts.transpileModule(read("lib/admin/e6-client.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: client.exports, require: () => ({}) });

const config = {
  domain: "E6",
  flags: [{ key: "computeShareEnabled", label: "电脑入口", desc: "入口", enabled: false, frontendEffect: "App" }],
  coefficients: [{ key: "h5BaseFactor", label: "历史值", value: "0.6", unit: "倍", desc: "历史", frontendEffect: "历史" }],
  yieldEstimate: [{ key: "topsBaseline", label: "基准", value: "100", unit: "TOPS" }],
  gpuTiers: ["G1", "G2", "G3", "G4", "G5", "G6"].map(id => ({ id, label: id, desc: "档位", defaultModel: "RTX", tops: "100", keywords: [] })),
  download: { url: "", zhTitle: "", zhGuide: "", enTitle: "", enGuide: "" }, sources: ["nx_config_item"],
};

test("phone config requires a boolean and a safe nonnegative integer; unavailable does not invent permission", () => {
  for (const allowReplacement of [false, true]) {
    for (const minReplacementIntervalDays of [0, 1, 30]) {
      const value = { allowReplacement, minReplacementIntervalDays };
      assert.deepEqual(parseE6PhoneBinding(value), value);
      assert.deepEqual(parseE6ComputeConfig({ ...config, phoneBinding: value }).phoneBinding, value);
    }
  }
  for (const value of [undefined, null, {}, [], { allowReplacement: "on", minReplacementIntervalDays: 0 },
    ...[-1, 0.5, NaN, Infinity, "0", null, Number.MAX_SAFE_INTEGER + 1].map(minReplacementIntervalDays => ({ allowReplacement: true, minReplacementIntervalDays }))]) {
    assert.equal(parseE6PhoneBinding(value), null);
    const parsed = parseE6ComputeConfig({ ...config, phoneBinding: value });
    assert.equal(parsed.phoneBinding, null);
    assert.equal(parsed.gpuTiers.length, 6, "unavailable phone fields must not hide the existing PC section");
  }
});

test("E6 write registry permits exactly the two phone keys and retires h5BaseFactor", () => {
  for (const field of ["allowReplacement", "minReplacementIntervalDays"]) {
    assert.equal(client.exports.isE6ParamKey(client.exports.e6PhoneBindingKey(field)), true);
  }
  for (const key of ["E.compute.h5BaseFactor", "E.compute.phoneBinding", "E.compute.phoneBinding.other", "D.phoneBinding.allowReplacement"]) {
    assert.equal(client.exports.isE6ParamKey(key), false);
  }
  assert.equal(client.exports.isE6ParamKey("E.compute.continuityFullHours"), true);
});

test("interval proposal rejects fractional and unsafe days and sends canonical integers through A2", async () => {
  const shell = read("app/components/domain-views/e-view.tsx");
  const source = shell.slice(shell.indexOf("const proposeParam ="), shell.indexOf("const headerRight ="));
  const sent = [];
  const proposeParam = runInNewContext(ts.transpileModule(source + "\nproposeParam;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    isE6ParamKey: client.exports.isE6ParamKey,
    findHighOp: () => ({ buildCommand: params => ({ params }), buildTarget: () => ({}) }),
    propose: async (_toast, command) => sent.push(command), ctx: {},
  });
  const call = value => proposeParam("E.compute.phoneBinding.minReplacementIntervalDays", value, "7", "reason", "interval", false);
  for (const value of ["", "-1", "0.5", "0.0000000001", "9007199254740992"]) {
    await assert.rejects(call(value), /非负整数/);
  }
  assert.equal(sent.length, 0);
  await call("0");
  await call("30.0");
  assert.deepEqual(sent.map(row => row.command.params.value), ["0", "30"]);
});

test("phone controls reuse A2 actions independently from installer and keep interval editable while replacement is off", () => {
  const ui = read("app/components/domain-views/e-tabs/e6-compute-config.tsx");
  const actions = ui.slice(ui.indexOf("const togglePhoneReplacement"), ui.indexOf("// 入口开关切换"));
  assert.match(actions, /!phoneBinding \|\| !canToggleE6/);
  assert.match(actions, /!phoneBinding \|\| !canWriteE6/);
  assert.match(actions, /fixedVal: phoneBinding\.allowReplacement \? "off" : "on"/);
  assert.match(actions, /min: 0, max: Number\.MAX_SAFE_INTEGER, step: 1/);
  assert.doesNotMatch(actions, /downloadReady|!phoneBinding\.allowReplacement/);
  assert.match(ui, /filter\(\(c\) => c\.key !== "h5BaseFactor"\)/);
  assert.doesNotMatch(ui, /网页登录只拿|账户托管结算|H5 升级动机/);
  const a5 = read("app/_console/platform/params-registry/params-registry-client.tsx");
  assert.match(a5, /历史配置 · 已退役（只读）/);
  assert.match(a5, /row\.canonicalKey !== "E\.compute\.h5BaseFactor" && <Link/);
});
