import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("L1 client exposes parameterized overview, drilldown and trend contracts", async () => {
  const source = await readFile(new URL("lib/admin/l-client.ts", root), "utf8");
  assert.match(source, /apiRequest<unknown>\(`\/kpi\?\$\{l1Query\(input\)\.toString\(\)\}`\)/);
  assert.match(source, /`\/kpi\/\$\{encodeURIComponent\(String\(kpiId\)\)\}\/drilldown\?/);
  assert.match(source, /`\/kpi\/trend\?\$\{query\.toString\(\)\}`/);
});

test("L1 page keeps eight-card unavailable values null-safe and performs server refresh", async () => {
  const source = await readFile(new URL("app/components/domain-views/l-tabs/l1-kpi.tsx", root), "utf8");
  assert.match(source, /item\.available === false \|\| item\.value == null \? "na"/);
  assert.match(source, /"不可计算"/);
  assert.match(source, /fetchL1Kpi\(/);
  assert.match(source, /fetchL1KpiDrilldown\(/);
  assert.match(source, /fetchL1KpiTrend\(/);
  assert.match(source, /刷新 KPI/);
  assert.match(source, /const attention = red \+ unavailable/);
  assert.match(source, /\{attention\} \/ \{KPIS\.length\}/);
});

test("L1 aggregate export is direct and no longer opens an unnecessary confirmation", async () => {
  const source = await readFile(new URL("app/components/domain-views/l-tabs/l1-kpi.tsx", root), "utf8");
  assert.doesNotMatch(source, /from "@\/lib\/store\/ui"/);
  assert.match(source, /KPI 序列已导出 · 已记审计/);
});
