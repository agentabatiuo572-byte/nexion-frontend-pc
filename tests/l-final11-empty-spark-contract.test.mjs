import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  resolveL1ExportMode,
  submitL1Export,
} from "../app/components/domain-views/l-tabs/l1-export-contract.ts";
import { validateL1Dashboard } from "../app/components/domain-views/l-tabs/l1-kpi-contract.ts";

function dashboard(spark = [60, 62, 64, 66, 68, 70]) {
  const kpis = Array.from({ length: 8 }, (_, index) => ({
    n: index + 1,
    kpiId: String(index + 1),
    name: `KPI ${index + 1}`,
    target: 60,
    dir: "gte",
    unit: "%",
    available: index < 5,
    value: index < 5 ? 70 : null,
    numerator: index < 5 ? 7 : 0,
    denominator: index < 5 ? 10 : 0,
    spark: [...spark],
  }));
  return {
    module: "L1",
    kpis,
    weeks: ["W1", "W2", "W3", "W4", "W5", "W6"],
    kpiPlain: Object.fromEntries(kpis.map((row) => [String(row.n), row.name])),
    kpiExt: Object.fromEntries(kpis.map((row) => [String(row.n), { note: row.name }])),
  };
}

test("L1 accepts only an explicit empty trend or exactly six finite points", () => {
  assert.doesNotThrow(() => validateL1Dashboard(dashboard([])));
  assert.doesNotThrow(() => validateL1Dashboard(dashboard()));

  for (const invalidSpark of [
    [1],
    [1, 2, 3, 4, 5],
    [1, 2, 3, 4, 5, 6, 7],
    [1, 2, 3, 4, 5, Number.NaN],
    [1, 2, 3, 4, 5, Number.POSITIVE_INFINITY],
    "not-an-array",
    null,
  ]) {
    const invalid = dashboard();
    invalid.kpis[0].spark = invalidSpark;
    assert.throws(() => validateL1Dashboard(invalid), /L1_KPI_ROW_INVALID/);
  }
});

test("L1 empty trends keep valid KPI cards and export only the available current snapshot", async () => {
  const emptyTrend = dashboard([]);
  const calls = [];

  assert.equal(resolveL1ExportMode(emptyTrend, false), "snapshot");
  assert.equal(await submitL1Export(emptyTrend, false, async (...args) => calls.push(args)), "snapshot");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].exportType, "KPI 当前汇总");
  assert.match(calls[0][0].fields, /当前值.*目标.*可用性/);
  assert.doesNotMatch(calls[0][0].fields, /环比序列/);

  const unavailable = dashboard([]);
  unavailable.kpis = unavailable.kpis.map((row) => ({ ...row, available: false, value: null }));
  assert.equal(resolveL1ExportMode(unavailable, false), null);
  assert.equal(resolveL1ExportMode(dashboard(), false), "series");
});

test("L1 cards explain missing trends without fabricating zero points", async () => {
  const source = await readFile(
    new URL("../app/components/domain-views/l-tabs/l1-kpi.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /kk\.spark\.length === 0[\s\S]{0,500}data-proof="l1-kpi-trend-unavailable"/);
  assert.match(source, /data-proof="l1-kpi-trend-unavailable"[^>]*>趋势数据不足</);
  assert.match(source, /当前筛选范围没有可绘制的趋势点；不会用 0 补齐缺失周/);
  assert.doesNotMatch(source, /spark(?:\s*\?\?|\s*\|\|)\s*\[?0\]?/);
});

test("L1 empty-trend semantics stay aligned with the current backend producer and UI contract", async () => {
  const root = new URL("../", import.meta.url);
  const [backend, ui] = await Promise.all([
    readFile(new URL("../nexion-backend/src/main/java/ffdd/opsconsole/bi/domain/L1KpiAnalytics.java", root), "utf8"),
    readFile(new URL("app/components/domain-views/l-tabs/l1-kpi.tsx", root), "utf8"),
  ]);

  assert.match(backend, /for \(int index = 0; index < 6; index\+\+\)[\s\S]{0,500}if \(point\.value\(\) == null\) return List\.of\(\)/);
  assert.match(ui, /KPI 看板/);
  assert.match(ui, /KPI 当前汇总 CSV/);
});
