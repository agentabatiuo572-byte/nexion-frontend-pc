import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("B 域历史趋势与分布不是只返回不渲染", () => {
  const insight = read("app/components/dashboard/restored-b-insights.tsx");
  const restorationClient = read("lib/admin/b-restoration-client.ts");
  const b3Contract = read("lib/admin/b34-overview-contract.ts");
  const b5Contract = read("lib/admin/b5-radar-contract.ts");
  const treasuryProxy = read("app/api/admin/treasury/[...path]/route.ts");
  const b2 = read("app/_console/overview/liquidity/page.tsx");
  const b3 = read("app/_console/overview/funnel/page.tsx");
  const b4 = read("app/_console/overview/rhythm/page.tsx");
  const b5 = read("app/_console/overview/risk-radar/page.tsx");

  for (const marker of [
    "b1-withdraw-pressure-trend",
    "b2-fund-flow-history",
    "b2-monthly-inflow-history",
    "b3-growth-outflow-ratio",
    "b4-alert-severity-distribution",
    "b4-alert-volume-history",
    "b5-daily-first-purchase-conversion",
    "b6-monthly-budget-allocation",
    "b7-first-purchase-channel-share",
    "b7-rhythm-engine-decision",
    "b2-maturity-chart",
    "b2-liability-distribution",
    "b3-cohort-trend-chart",
    "b5-recent-alert-feed",
  ]) assert.match(insight, new RegExp(marker));

  assert.match(b2, /B2RestoredInsights/);
  assert.match(b3, /B3RestoredInsights/);
  assert.match(b4, /B4RestoredInsights/);
  assert.match(b5, /B5RestoredInsights/);
  assert.match(restorationClient, /\/api\/admin\/treasury\/liquidity-history/);
  assert.match(restorationClient, /\/api\/admin\/treasury\/growth-flow-history/);
  assert.match(restorationClient, /exactLabels\(flowWindows, 8/);
  assert.match(restorationClient, /exactLabels\(monthlyNewDeposits, 8/);
  assert.match(restorationClient, /exactLabels\(ratioSeries, 8/);
  assert.match(restorationClient, /healthyRatio !== 1\.2/);
  assert.match(treasuryProxy, /"liquidity-history"/);
  assert.match(treasuryProxy, /"growth-flow-history"/);
  assert.match(b3Contract, /dailyFirstPurchaseTargetPct/);
  assert.match(b3Contract, /dailyFirstPurchase/);
  assert.match(b3Contract, /purchaseChannels/);
  assert.match(b5Contract, /pressureHistory/);
  assert.match(b5Contract, /alertSeverity/);
  assert.match(b5Contract, /alertVolume/);
  assert.match(b5Contract, /recentAlerts/);
  assert.match(b5Contract, /pressureCalculable/);
  assert.match(b5Contract, /nullableNum/);
  assert.doesNotMatch(insight, /b-client/);
  assert.doesNotMatch(insight, /overview_b1_read/);
  assert.doesNotMatch(insight, /useAdminAuth/);
});

test("F5 六类支出卡与全量状态分布可点击筛选", () => {
  const source = read("app/components/domain-views/f-tabs/f5-audit.tsx");
  assert.match(source, /data\.commissionKinds\.map/);
  assert.match(source, /data\.statusDistribution\.map/);
  assert.match(source, /data-testid="f5-commission-kind-card"/);
  assert.match(source, /data-testid="f5-status-distribution-item"/);
  assert.match(source, /applyKindFilter/);
  assert.match(source, /applyStatusFilter/);
  assert.match(source, /已提现: "withdrawn"/);
});

test("C3 待确认队列保留服务端分页，不再固定只取前五条", () => {
  const source = read("app/components/domain-views/c-tabs/c3-adjust.tsx");
  assert.match(source, /const \[requestPage, setRequestPage\]/);
  assert.match(source, /const \[requestPageSize, setRequestPageSize\]/);
  assert.match(source, /pageNum: requestPage, pageSize: requestPageSize/);
  assert.match(source, /label="待放行调整队列"/);
  assert.match(source, /const requestPageCount/);
  assert.match(source, /requestPage > requestPageCount/);
  assert.match(source, /setRequestPage\(requestPageCount\)/);
  assert.match(source, /data-restored-capability="c3-pending-request-withdrawal"/);
  assert.match(source, /aria-label="刷新待放行调整队列"/);
});

test("零值柱不绘制非零实体，压力零分母保留不可计算", () => {
  const insight = read("app/components/dashboard/restored-b-insights.tsx");
  assert.match(insight, /data-zero=\{value === 0/);
  assert.match(insight, /value === 0 \? 0 : Math\.max/);
  assert.match(insight, /row\.inflowWan === 0 \? 0 : Math\.max/);
  assert.match(insight, /row\.outflowWan === 0 \? 0 : Math\.max/);
  assert.match(insight, /row\.ratio === null \? null : row\.ratio \* 100/);
  assert.match(insight, /summarizePressureHistory/);
  assert.match(insight, /分母为 0，不可计算/);
});

test("已恢复或等价迁移的能力保持可见，防止二次误删", () => {
  const d2 = read("app/components/domain-views/d-tabs/d2-withdrawals.tsx");
  const b4 = read("app/_console/overview/rhythm/page.tsx");
  const l4 = read("app/components/domain-views/l-tabs/l4-ops.tsx");
  const user360 = read("app/_console/users/search/[id]/page.tsx");
  assert.match(d2, /D2StatusFlow/);
  assert.match(d2, /下一页/);
  assert.match(b4, /data\.distribution\.map/);
  assert.match(l4, /data\.network\.commissionStructure/);
  assert.match(user360, /detail\?\.financial &&/);
  assert.match(user360, /detail\?\.referral &&/);
  assert.match(user360, /detail\?\.devices &&/);
});

test("已恢复能力保留显式服务端权威与运行时消费声明", () => {
  const a3 = read("app/components/domain-views/a-tabs/a3-config.tsx");
  const a4 = read("app/components/domain-views/a-tabs/a4-events.tsx");
  assert.match(a3, /data-restored-capability="a3-global-rate-limit"/);
  assert.match(a3, /data-restored-capability="a3-withdraw-strong-review-threshold"/);
  assert.match(a4, /data-restored-capability="a4-event-lifecycle"/);
  assert.match(a3, /CAS · 幂等 · 审计 · 运行时真实消费/);
  assert.match(a4, /服务端权威/);
});
