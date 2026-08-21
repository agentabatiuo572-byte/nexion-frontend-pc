import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  allowedAggregateExportOptions,
  canAccessBiReportType,
  canExportBiReports,
} from "../app/components/domain-views/l-tabs/l1-l2-live-data.ts";
import { normalizeL6BehaviorHeatmap } from "../app/components/domain-views/l-tabs/l6-live-data.ts";
import {
  l6UnavailableStateFromError,
  l6UnavailableStateFromFailures,
} from "../lib/admin/l6-runtime-state.ts";

test("L5 aggregate export choices and downloads share the same domain-write permission", () => {
  assert.deepEqual(
    allowedAggregateExportOptions("risk", ["bi_l5_read", "bi_l5_regulatory_generate"]),
    [],
  );
  assert.deepEqual(
    allowedAggregateExportOptions("finance", ["bi_l3_write", "bi_l5_read"]).map((item) => item.label),
    ["财务聚合"],
  );
  assert.deepEqual(
    allowedAggregateExportOptions("growth", ["bi_l1_write", "bi_l2_write", "bi_l4_write", "bi_l5_read"])
      .map((item) => item.label),
    ["KPI 序列", "漏斗序列", "运营聚合"],
  );
  assert.equal(canAccessBiReportType("finance", ["bi_l3_write"], "FINANCE_AGG"), true);
  assert.equal(canAccessBiReportType("finance", ["bi_l3_write"], "KPI_SERIES"), false);
  assert.equal(canAccessBiReportType("risk", ["bi_l5_read"], "FINANCE_AGG"), false);
  assert.equal(canAccessBiReportType("superadmin", [], "NETWORK_TREE"), true);
  assert.equal(canAccessBiReportType("risk", ["bi_l5_regulatory_generate"], "REGULATORY"), true);
  assert.equal(canAccessBiReportType("risk", ["bi_l5_read"], "REGULATORY"), false);
  assert.equal(canAccessBiReportType("superadmin", [], "REGULATORY"), true);
});

test("L6 normalizes canonical server aggregates without exposing raw identities", () => {
  const data = normalizeL6BehaviorHeatmap({
    available: true,
    status: "AVAILABLE",
    businessTimeZone: "UTC+08:00",
    lateArrivalPolicy: "included_on_next_query",
    quality: { clientEventIdDeduplicated: true, outOfOrderRejected: true, ctrDenominator: "page_viewed_pv" },
    totalPages: 1,
    trackedCount: 1,
    pageTree: [{ route: "/pages/store/store", titleZh: "商城", pageLevel: 1, parentL1: "/pages/store/store", parentL2: "/pages/store/store", tracked: true }],
    excludedPages: [],
    activityByWindow: { "24h": [], "7d": [{ route: "/pages/store/store", pv: 4, uv: 3, clicks: 2, dwellMs: 800, bounceRate: 0.25, pageCount: 1 }], "30d": [] },
    clickHeatByRoute: {},
    dailyTrend: [],
    weeklyTrend: [],
  });

  assert.equal(data.available, true);
  assert.equal(data.pageTree[0].level, 1);
  assert.equal(data.activityByWindow["7d"][0].uv, 3);
  assert.equal(data.activityByWindow["7d"][0].pageCount, 1);
  assert.equal(canExportBiReports("risk", ["bi_l6_read"], "L6"), false);
  assert.equal(canExportBiReports("auditor", ["bi_l6_export"], "L6"), true);
});

test("L6 rejects dirty HTTP 200 aggregates as a whole instead of manufacturing zeroes", () => {
  const valid = {
    available: true,
    status: "AVAILABLE",
    window: "7d",
    businessTimeZone: "UTC+08:00",
    lateArrivalPolicy: "included_on_next_query",
    quality: { clientEventIdDeduplicated: true, outOfOrderRejected: true, ctrDenominator: "page_viewed_pv" },
    totalPages: 1,
    trackedCount: 1,
    pageTree: [{ route: "/pages/store/store", titleZh: "商城", pageLevel: 1, parentL1: "/pages/store/store", parentL2: "/pages/store/store", tracked: true }],
    excludedPages: [],
    activityByWindow: { "24h": [], "7d": [{ route: "/pages/store/store", pv: 4, uv: 3, clicks: 2, dwellMs: 800, bounceRate: 0.25, pageCount: 1 }], "30d": [] },
    clickHeatByRoute: {},
    dailyTrend: [],
    weeklyTrend: [],
  };
  assert.equal(normalizeL6BehaviorHeatmap(valid).activityByWindow["7d"][0].pv, 4);
  for (const dirty of [
    { ...valid, available: "yes" },
    { ...valid, trackedCount: 2 },
    { ...valid, activityByWindow: { ...valid.activityByWindow, "7d": [{ ...valid.activityByWindow["7d"][0], pv: -1 }] } },
    { ...valid, activityByWindow: { ...valid.activityByWindow, "7d": [{ ...valid.activityByWindow["7d"][0], uv: 5 }] } },
    { ...valid, activityByWindow: { ...valid.activityByWindow, "7d": [{ ...valid.activityByWindow["7d"][0], bounceRate: 1.1 }] } },
  ]) {
    assert.throws(() => normalizeL6BehaviorHeatmap(dirty), /L6_RESPONSE_INVALID/);
  }
});

test("L6 treats the local Sandbox production-surface fence as an explicit runtime state", () => {
  const sandboxState = l6UnavailableStateFromError(Object.assign(new Error("hidden display message"), {
    code: "L6_PRODUCTION_SURFACE_FORBIDDEN",
  }));
  assert.deepEqual(sandboxState, {
    available: false,
    status: "SANDBOX_ONLY",
    message: "当前后端运行在验收 Sandbox；生产行为热力读取已按环境隔离策略关闭。请使用上方 Sandbox 独立观察面核对当前 Run 的行为事实。",
  });
  assert.equal(l6UnavailableStateFromError(new Error("BI_API_503")), null);
  assert.equal(l6UnavailableStateFromError(Object.assign(new Error("other"), { code: "OTHER" })), null);

  const fenceA = Object.assign(new Error("fence-a"), { code: "L6_PRODUCTION_SURFACE_FORBIDDEN" });
  const fenceB = Object.assign(new Error("fence-b"), { code: "L6_PRODUCTION_SURFACE_FORBIDDEN" });
  const outage = Object.assign(new Error("outage"), { code: "BI_API_503" });
  assert.equal(l6UnavailableStateFromFailures([fenceA, fenceB], 2)?.status, "SANDBOX_ONLY");
  assert.equal(l6UnavailableStateFromFailures([fenceA, outage], 2), null);
  assert.equal(l6UnavailableStateFromFailures([outage, fenceA], 2), null);
  assert.equal(l6UnavailableStateFromFailures([fenceA], 2), null);
});

test("L5 exposes only implemented actions and L6 uses canonical filtered endpoints", async () => {
  const l5 = await readFile(
    new URL("../app/components/domain-views/l-tabs/l5-export.tsx", import.meta.url),
    "utf8",
  );
  const l6 = await readFile(
    new URL("../app/components/domain-views/l-tabs/l6-behavior-heatmap.tsx", import.meta.url),
    "utf8",
  );
  const l5Client = await readFile(
    new URL("../lib/admin/l-client.ts", import.meta.url),
    "utf8",
  );

  assert.match(l5, /availableAggregateExportTypes/);
  assert.match(l5, /canAccessReportType/);
  assert.match(l5, /reasonMax:\s*200/);
  assert.match(l5, /历史无快照不可下载/);
  assert.match(l5, /已就绪（含历史）/);
  assert.match(l5, /历史无快照/);
  assert.match(l5, /当前版本已关闭此历史类型/);
  assert.match(l5, /七类账单/);
  assert.match(l5, /生成监管报告/);
  assert.match(l5, /I5 当前法域 × 披露版本/);
  assert.doesNotMatch(l5, /调整排程/);
  assert.doesNotMatch(l5, /\+ 新建模板/);
  assert.doesNotMatch(l5, /发起解密导出/);
  assert.doesNotMatch(l5, /usePropose|findHighOp|l5_task_approve/);
  assert.match(l5Client, /KPI_SERIES:\s*"KPI 聚合"/);
  assert.match(l5Client, /FUNNEL_COHORT:\s*"漏斗聚合"/);
  assert.match(l5Client, /FINANCE_AGG:\s*"财务聚合"/);
  assert.match(l5Client, /OPERATIONS_AGG:\s*"运营聚合"/);
  assert.match(l5Client, /REGULATORY:\s*"监管报告"/);

  assert.match(l6, /fetchL6Behavior/);
  assert.match(l6, /fetchL6ClickHeat/);
  assert.match(l6, /downloadL6Behavior/);
  assert.match(l6, /设备筛选/);
  assert.match(l6, /Locale 筛选/);
  assert.match(l6, /查询隔离事实/);
  assert.match(l6, /setLiveRaw\(null\)/);
  assert.match(l6, /heatmapData\.status === "SANDBOX_ONLY"/);
  assert.match(l6, /生产行为热力读取已按环境隔离策略关闭/);
  assert.match(l6, /if \(ctx\.biLoading\)/);
  assert.match(l6, /overview\.status === "SANDBOX_ONLY"/);
  assert.match(l5Client, /l6UnavailableStateFromError/);
  assert.match(l5Client, /Promise\.allSettled/);
  assert.match(l5Client, /error\.code = payload\.message/);
  assert.doesNotMatch(l6, /ctx\.biActions\?\.createReport/);
});
