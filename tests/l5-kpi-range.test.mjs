import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as rangeContract from "../app/components/domain-views/l-tabs/l5-kpi-range.ts";
import { l5KpiRange, l5BusinessToday, isL5KpiExport } from "../app/components/domain-views/l-tabs/l5-kpi-range.ts";

test("KPI custom dates produce exactly the selected server query and confirmation label", () => {
  assert.deepEqual(l5KpiRange({ window: "custom", from: "2026-09-01", to: "2026-09-18", timeRange: "2026-09" }, "2026-09-18"),
    { window: "custom", from: "2026-09-01", to: "2026-09-18", timeRange: "2026-09-01 / 2026-09-18" });
});
test("fixed windows explicitly transmit the chosen window and omit stale custom dates", () => {
  for (const window of ["1d", "7d", "30d"]) {
    const selected = l5KpiRange({ window, from: "2026-09-01", to: "2099-01-01" });
    assert.equal(selected.window, window);
    assert.equal(selected.from, undefined);
    assert.equal(selected.to, undefined);
  }
});
test("freeform month cannot be silently treated as seven days", () => {
  assert.throws(() => l5KpiRange({ timeRange: "2026-09" }), /请选择/);
  assert.throws(() => l5KpiRange({ window: "2026-09" }), /请选择/);
});
test("invalid, reversed, future and oversized dates fail rather than clamp", () => {
  for (const [from, to] of [["2026-02-30", "2026-03-01"], ["2026-9-1", "2026-09-18"], ["", "2026-09-18"],
    ["2026-09-18", "2026-09-01"], ["2026-09-01", "2026-09-30"], ["2024-01-01", "2026-09-18"]]) {
    assert.throws(() => l5KpiRange({ window: "custom", from, to }, "2026-09-18"));
  }
});
test("business date uses Shanghai midnight independently of host timezone", () => {
  assert.equal(l5BusinessToday(new Date("2026-09-17T15:59:59Z")), "2026-09-17");
  assert.equal(l5BusinessToday(new Date("2026-09-17T16:00:00Z")), "2026-09-18");
  assert.equal(isL5KpiExport("KPI 序列"), true);
  assert.equal(isL5KpiExport("KPI_SERIES"), true);
  assert.equal(isL5KpiExport("漏斗序列"), false);
});

test("real L5 confirmation submits structured custom scope and rejects invalid dates before API writes", async () => {
  const output = ts.transpileModule(readFileSync(new URL("../app/components/domain-views/l-tabs/l5-export.tsx", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  const element = (type, props) => ({ type, props });
  new Function("require", "exports", output)(name => name === "react/jsx-runtime"
    ? { jsx: element, jsxs: element, Fragment: "fragment" } : name === "./l5-kpi-range" ? rangeContract : {}, exports);
  let confirmation;
  const sent = [];
  const ctx = { availableAggregateExportTypes: ["KPI 序列", "漏斗序列"], canExport: true, biData: { l5: {} },
    openActionConfirm: spec => { confirmation = spec; }, biActions: { createReport: async input => sent.push(input) }, toast() {} };
  const rendered = exports.L5HeaderActions({ ctx });
  const button = rendered.props.children.find(child => child.type === "button");
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.equal(confirmation.businessForm.kpiStructuredRange, true);
  const fields = { exportType: "KPI 序列", window: "custom", from: "2026-06-01", to: "2026-06-30", fields: "聚合指标", recipient: "BI", ticket: "TEST" };
  await confirmation.run("导出指定日期范围验证", undefined, fields);
  assert.equal(sent[0].window, "custom"); assert.equal(sent[0].from, fields.from); assert.equal(sent[0].to, fields.to);
  assert.equal(sent[0].timeRange, "2026-06-01 / 2026-06-30");
  await assert.rejects(confirmation.run("拒绝未来日期范围验证", undefined, { ...fields, to: "9999-12-31" }), /不能晚于今天/);
  assert.equal(sent.length, 1);
  await confirmation.run("导出其他类型范围验证", undefined, { ...fields, exportType: "漏斗序列", timeRange: "当前快照" });
  assert.equal(sent[1].timeRange, "当前快照"); assert.equal(sent[1].window, undefined); assert.equal(sent[1].from, undefined);
  assert.equal(exports.L5HeaderActions({ ctx: { ...ctx, canExport: false } }).props.children.find(child => child.type === "button").props.disabled, true);
});
