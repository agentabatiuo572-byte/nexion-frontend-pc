import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function actualDisplay(relative, dependencies = {}) {
  const displayOutput = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const displayModule = { exports: {} };
  new Function("require", "exports", "module", displayOutput)(name => dependencies[name] ?? require(name), displayModule.exports, displayModule);
  return displayModule.exports;
}
const brandDisplay = actualDisplay("../lib/admin/brand-copy.ts");
const operatorDisplay = actualDisplay("../lib/admin/operator-copy.ts", { "./brand-copy": brandDisplay, "./brand-copy.ts": brandDisplay });
const filename = new URL("../app/components/domain-views/f-tabs/f3-binary.tsx", import.meta.url);
const output = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("require", "exports", "module", output)((name) => {
  if (name === "@/lib/admin/operator-copy") return operatorDisplay;
  if (name === "react") return { ...React, useMemo: fn => fn(), useState: value => [value, () => {}] };
  if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
  if (name === "../design-kit") return { Badge: ({ children }) => children, CodeTag: ({ children }) => children,
    DataListPager: () => null, useDataListPager: rows => ({ pageRows: rows, total: rows.length, page: 1, pageSize: 10 }) };
  if (name === "./f3-placements") return { F3Placements: () => null };
  if (name === "@/lib/admin/f1-client") return { F3_GV_RESET_PARAM_KEY: "F.binary.gvResetCron" };
  return require(name);
}, module.exports, module);

function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node !== "object") return String(node);
  return text(node.props?.children);
}
function find(node, predicate, result = []) {
  if (!node || typeof node !== "object") return result;
  if (Array.isArray(node)) { node.forEach(child => find(child, predicate, result)); return result; }
  if (predicate(node)) result.push(node);
  find(node.props?.children, predicate, result);
  return result;
}
function fixture(trackA, trackB, canSettle = true) {
  const formula = trackA === null ? null : { trackA, trackB, matchRate: "13%", matchAmount: 335.894, user: "U60723153007" };
  const ctx = { can: scope => scope === "network_f3_write" && canSettle, f3Settlements: [],
    f3Config: { matchRate: "13%", settlePeriod: "日" }, f3ConfigValues: {}, f3Formula: formula,
    f3Metrics: [], f3MaxTrackGmv: 0, f3DailyMatchUsd: 0, f3MonthlyMatchedUsd: 0,
    f3ParticipantCount: 0, f3AutoPlacement7dCount: 0, f3BlockedCount: 0, nav: () => {}, toast: () => {} };
  const tree = () => module.exports.F3Binary({ ctx });
  const side = key => text(find(tree(), node => node.props?.className === `track ${key}`)[0]);
  return { ctx, tree, side };
}
for (const [label, a, b, expectedA, expectedB] of [
  ["actual A below B", 2583.8, 2617.9, "较小侧 · 结算基数", "较大侧"],
  ["A above B", 2617.9, 2583.8, "较大侧", "较小侧 · 结算基数"],
  ["equal displayed positive", 100, 100, "两轨显示值相同", "两轨显示值相同"],
  ["equal displayed zero", 0, 0, "两轨显示值相同", "两轨显示值相同"],
  ["one empty track", 0, 10, "较小侧 · 结算基数", "较大侧"],
  ["compare raw precision", 1.0001, 1.0002, "较小侧 · 结算基数", "较大侧"],
  ["missing formula", null, null, "暂无轨道数据", "暂无轨道数据"],
]) test(`actual F3 card labels: ${label}`, () => {
  const f = fixture(a, b);
  for (const [key, expected] of [["a", expectedA], ["b", expectedB]]) {
    assert.ok(f.side(key).includes(expected), f.side(key));
    assert.doesNotMatch(f.side(key), /自动安置流入/);
    if (expected === "较大侧") assert.doesNotMatch(f.side(key), /结算基数/);
    if (expected === "两轨显示值相同") assert.doesNotMatch(f.side(key), /结算基数|较大侧|较小侧/);
    if (expected === "暂无轨道数据") assert.doesNotMatch(f.side(key), /较大侧|较小侧|结算基数/);
  }
  const html = renderToStaticMarkup(f.tree());
  assert.match(html, /A 侧团队/);
  assert.match(html, /B 侧团队/);
  assert.equal(f.ctx.f3Formula?.trackA ?? null, a);
  assert.equal(f.ctx.f3Formula?.trackB ?? null, b);
});

test("empty server formula and non-finite amounts do not claim a settlement base", () => {
  for (const values of [{ user: "", trackA: 0, trackB: 0 }, { user: "  ", trackA: 0, trackB: 0 },
    { user: "U7", trackA: NaN, trackB: 100 }, { user: "U7", trackA: 100, trackB: Infinity }]) {
    const f = fixture(0, 0);
    Object.assign(f.ctx.f3Formula, values);
    for (const key of ["a", "b"]) {
      assert.match(f.side(key), /暂无轨道数据/);
      assert.doesNotMatch(f.side(key), /较大侧|较小侧|显示值相同|结算基数/);
    }
  }
});

test("actual settlement action preserves permission, owner, date and financial result", async () => {
  const f = fixture(2583.8, 2617.9);
  let action, args, toast;
  f.ctx.openActionConfirm = value => { action = value; };
  f.ctx.executeF3Settlement = async (...value) => { args = value; return { status: "SETTLED", amountUsdt: 335.894, replayed: false }; };
  f.ctx.toast = value => { toast = value; };
  find(f.tree(), node => node.type === "button" && text(node) === "执行结算")[0].props.onClick();
  assert.match(action.businessForm.fields.find(field => field.key === "settlementDate").label, /业务日期/);
  assert.match(action.businessForm.hint, /2026-10-19 起新周期按越南时间 UTC\+7/);
  assert.match(action.businessForm.hint, /历史周期沿用 UTC\+8，不回溯重算/);
  assert.equal(action.businessForm.fields.find(field => field.key === "settlementDate").current, undefined);
  await action.run("original reason", { ownerUserId: "60723153007", settlementDate: "2026-10-17" });
  assert.deepEqual(args, [60723153007, "2026-10-17", "original reason"]);
  assert.match(toast, /335\.894.*进入冷却/);
  assert.equal(find(fixture(2583.8, 2617.9, false).tree(), node => node.type === "button" && text(node) === "执行结算").length, 0);
});

test("Vietnam period copy preserves server configuration, proposal keys and read-only permissions", () => {
  const f = fixture(100, 200);
  let action;
  f.ctx.can = () => true;
  f.ctx.f3Config.gvResetCron = "每月1日00:00 UTC";
  f.ctx.openActionConfirm = value => { action = value; };
  assert.match(text(f.tree()), /越南时间 UTC\+7/);
  assert.match(text(f.tree()), /每月1日00:00 UTC/);
  find(f.tree(), node => node.type === "button" && text(node) === "归零统计规则")[0].props.onClick();
  assert.equal(action.op, "param");
  assert.equal(action.paramKey, "F.binary.gvResetCron");
  assert.equal(action.edit.current, "每月1日00:00 UTC");
  assert.equal(action.edit.kind, "select");
  assert.deepEqual(action.edit.options, ["每月 1 日 00:00 Asia/Ho_Chi_Minh"]);
  find(f.tree(), node => node.type === "button" && text(node) === "调整周期与策略")[0].props.onClick();
  assert.match(action.businessForm.hint, /每日 00:00、每周一 00:00、每月 1 日 00:00/);
  assert.deepEqual(action.paramKeys, [
    { key: "period", paramKey: "F.binary.settlePeriod" },
    { key: "residual", paramKey: "F.binary.residualPolicy" },
  ]);
  assert.equal(action.amplify, true);
  assert.equal(action.completionCopy, "保存后只影响下一周期结算，不回溯已计提。");
  f.ctx.can = () => false;
  for (const label of ["执行结算", "归零口径", "调整周期 & 策略"]) {
    assert.equal(find(f.tree(), node => node.type === "button" && text(node) === label).length, 0);
  }
  const h3 = readFileSync(new URL("../app/components/domain-views/h-tabs/h3-quest-events.tsx", import.meta.url), "utf8");
  assert.match(h3, /按注册手机号区号对应时区，每周一 00:00 开始新一周/);
});
