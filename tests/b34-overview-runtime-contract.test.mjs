import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  assertB3Dashboard,
  assertB4PhaseOverview,
} from "../lib/admin/b34-overview-contract.ts";

const b3 = {
  available: true,
  generatedAt: "2026-07-28T00:00:00Z",
  filters: { cohort: "ALL", phase: "ALL", ref: "ALL" },
  filterOptions: { cohorts: [], phases: [], refs: [] },
  stages: [
    "register", "purchase", "repurchase", "withdraw",
  ].map((key, index) => ({
    key,
    stage: key,
    event: `${key}.event`,
    distinctUsers: 1,
    previousUsers: 1,
    cvrFromPrev: index === 0 ? null : 100,
    momDelta: 0,
    lifecycleLabel: key,
    kpiTarget: null,
    color: "var(--brand)",
    source: "nx_event_outbox",
  })),
  auxMetrics: {
    storeViewRate: 100,
    storeViewNumerator: 1,
    storeViewDenominator: 1,
    purchaseFromStoreRate: 100,
    purchaseFromStoreNumerator: 1,
    purchaseFromStoreDenominator: 1,
    day0AccessRate: 100,
    day0Numerator: 1,
    day0Denominator: 1,
    day0Target: 95,
    day0WindowSeconds: 120,
    day7Retention: 100,
    day7Numerator: 1,
    day7Denominator: 1,
    day7Target: 60,
    day7Mature: true,
  },
  trend: [
    { cohort: "2026-W30", distinctUsers: 1, cvrFromPrev: 100 },
    { cohort: "2026-W31", distinctUsers: 1, cvrFromPrev: 100 },
  ],
  dailyFirstPurchaseTargetPct: 18,
  dailyFirstPurchase: Array.from({ length: 8 }, (_, index) => ({
    date: `2026-07-${String(21 + index).padStart(2, "0")}`,
    registeredUsers: 10,
    firstPurchaseUsers: 2,
    conversionPct: 20,
  })),
  purchaseChannels: [
    { channel: "direct", firstPurchaseUsers: 1, sharePct: 100 },
  ],
  savedViews: [],
  crossDomainLinks: [],
  sources: ["nx_event_outbox"],
  sourceStatement: "A4 权威事件",
};

const b4 = {
  available: true,
  filters: {
    granularity: "PHASE",
    month: 1,
    phase: "ALL",
    monthOptions: Array.from({ length: 12 }, (_, index) => index + 1),
    phaseOptions: ["P1", "P2", "P3", "P4", "P5", "P6"],
  },
  rhythm: { currentPhase: "P1", currentMonth: 1, totalMonths: 12, phaseProgressPct: 0 },
  phaseDistribution: Array.from({ length: 6 }, (_, index) => ({
    phase: `P${index + 1}`,
    userCount: index === 0 ? 1 : 0,
    inScope: true,
  })),
  monthDistribution: Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    phase: `P${Math.min(6, Math.floor(index / 2) + 1)}`,
    userCount: index === 0 ? 1 : 0,
    inScope: true,
  })),
  distribution: Array.from({ length: 6 }, (_, index) => ({
    phase: `P${index + 1}`,
    userCount: index === 0 ? 1 : 0,
    inScope: true,
  })),
  dials: [
    ["newUserBonusMultiplier", 2, "倍"],
    ["inviteRewardMultiplier", 2, "倍"],
    ["reinvestMultiplier", 2, "倍"],
    ["withdrawPenaltyFeeRate", 5, "%"],
    ["withdrawCooldownDays", 7, "天"],
    ["binaryDailyCap", 5000, "USDT"],
    ["questBonusMultiplier", 2, "倍"],
    ["complianceHoldEnabled", true, ""],
  ].map(([key, currentValue, unit]) => ({
    key,
    label: String(key),
    currentValue,
    unit,
    source: "H1",
    v1Status: "已生效",
    v1Active: true,
    adjustHref: "/growth/phase",
  })),
  nextPivot: {
    atMonth: 2,
    daysLeft: null,
    changes: [],
    basis: "H1",
    message: "节奏末月",
  },
  monthLeverCombo: [],
  attributionLinks: [
    { key: "H1", label: "H1", href: "/growth/phase" },
    { key: "B3", label: "B3", href: "/overview/funnel" },
    { key: "B1", label: "B1", href: "/overview/dual-ledger" },
    { key: "B2", label: "B2", href: "/overview/liquidity" },
  ],
  sourceStatement: "H1 权威",
  sources: ["growth_phase"],
  asOf: "2026-07-28T00:00:00Z",
};

test("B3 当前四级漏斗协议可通过，已退役绑卡/KYC 不回填", () => {
  assert.doesNotThrow(() => assertB3Dashboard(b3));
});

test("B3 PC 必须保留并消费服务端 Day0 窗口，不能回退硬编码 90 秒", () => {
  const missing = structuredClone(b3);
  delete missing.auxMetrics.day0WindowSeconds;
  assert.throws(() => assertB3Dashboard(missing), /B3_RESPONSE_INVALID:auxMetrics\.day0WindowSeconds/);

  const page = readFileSync(new URL("../app/_console/overview/funnel/page.tsx", import.meta.url), "utf8");
  assert.match(page, /data\.auxMetrics\.day0WindowSeconds/);
  assert.doesNotMatch(page, />\s*90 秒内首笔收益/);
});

test("B3 畸形 200 必须失败关闭", () => {
  assert.throws(() => assertB3Dashboard({ malformed: true }), /B3_RESPONSE_INVALID/);
  assert.throws(() => assertB3Dashboard({ ...b3, stages: [] }), /B3_RESPONSE_INVALID:stages/);
});

test("B3 负数、越级人数和伪百分比必须失败关闭", () => {
  const negativeStage = structuredClone(b3);
  negativeStage.stages[0].distinctUsers = -1;
  assert.throws(() => assertB3Dashboard(negativeStage), /B3_RESPONSE_INVALID:stages\.0\.distinctUsers/);

  const impossibleStage = structuredClone(b3);
  impossibleStage.stages[1].distinctUsers = 2;
  assert.throws(() => assertB3Dashboard(impossibleStage), /B3_RESPONSE_INVALID:stages\.1\.distinctUsers/);

  const fakeDaily = structuredClone(b3);
  fakeDaily.dailyFirstPurchase[0] = {
    ...fakeDaily.dailyFirstPurchase[0],
    registeredUsers: 0,
    firstPurchaseUsers: 0,
    conversionPct: 777,
  };
  assert.throws(() => assertB3Dashboard(fakeDaily), /B3_RESPONSE_INVALID:dailyFirstPurchase\.0\.conversionPct/);
});

test("B3 首购分子不得大于分母，渠道份额必须落在真实 100% 内", () => {
  const impossibleDaily = structuredClone(b3);
  impossibleDaily.dailyFirstPurchase[0] = {
    ...impossibleDaily.dailyFirstPurchase[0],
    registeredUsers: 1,
    firstPurchaseUsers: 2,
    conversionPct: 200,
  };
  assert.throws(() => assertB3Dashboard(impossibleDaily), /B3_RESPONSE_INVALID:dailyFirstPurchase\.0\.firstPurchaseUsers/);

  const fakeChannel = structuredClone(b3);
  fakeChannel.purchaseChannels[0].sharePct = 250;
  assert.throws(() => assertB3Dashboard(fakeChannel), /B3_RESPONSE_INVALID:purchaseChannels\.0\.sharePct/);
});

test("B3 cohort 必须有 1 到 13 个有序周点，日序列必须连续", () => {
  const emptyTrend = structuredClone(b3);
  emptyTrend.trend = [];
  assert.throws(() => assertB3Dashboard(emptyTrend), /B3_RESPONSE_INVALID:trend/);

  const tooLong = structuredClone(b3);
  tooLong.trend = Array.from({ length: 14 }, (_, index) => ({ cohort: `2026-W${String(index + 1).padStart(2, "0")}`, distinctUsers: 1, cvrFromPrev: 100 }));
  assert.throws(() => assertB3Dashboard(tooLong), /B3_RESPONSE_INVALID:trend/);

  const reversed = structuredClone(b3);
  reversed.trend.reverse();
  assert.throws(() => assertB3Dashboard(reversed), /B3_RESPONSE_INVALID:trend/);

  const skippedDay = structuredClone(b3);
  skippedDay.dailyFirstPurchase[4].date = "2026-08-08";
  assert.throws(() => assertB3Dashboard(skippedDay), /B3_RESPONSE_INVALID:dailyFirstPurchase.date/);
});

test("B3 渠道人数必须等于首购阶段，份额必须由人数推导", () => {
  const wrongUsers = structuredClone(b3);
  wrongUsers.purchaseChannels[0].firstPurchaseUsers = 2;
  assert.throws(() => assertB3Dashboard(wrongUsers), /B3_RESPONSE_INVALID:purchaseChannels/);

  const split = structuredClone(b3);
  split.stages[1].distinctUsers = 2;
  split.stages[1].previousUsers = 2;
  split.stages[0].distinctUsers = 2;
  split.stages[0].previousUsers = 2;
  split.stages[2].previousUsers = 2;
  split.stages[2].cvrFromPrev = 50;
  split.purchaseChannels = [
    { channel: "a", firstPurchaseUsers: 1, sharePct: 90 },
    { channel: "b", firstPurchaseUsers: 1, sharePct: 10 },
  ];
  assert.throws(() => assertB3Dashboard(split), /B3_RESPONSE_INVALID:purchaseChannels\.0\.sharePct/);
});

test("B4 完整 H1 权威协议可通过", () => {
  assert.doesNotThrow(() => assertB4PhaseOverview(b4));
});

test("B4 畸形 200 与缺失 dial 必须失败关闭", () => {
  assert.throws(() => assertB4PhaseOverview({ malformed: true }), /B4_RESPONSE_INVALID/);
  assert.throws(() => assertB4PhaseOverview({ ...b4, dials: b4.dials.slice(0, 7) }), /B4_RESPONSE_INVALID:dials/);
});

test("B4 节奏月份、进度、分布和拐点不得出现负数或越界值", () => {
  const invalidRhythm = structuredClone(b4);
  invalidRhythm.rhythm = { currentPhase: "P1", currentMonth: 999, totalMonths: -1, phaseProgressPct: 777 };
  assert.throws(() => assertB4PhaseOverview(invalidRhythm), /B4_RESPONSE_INVALID:rhythm/);

  const negativeDistribution = structuredClone(b4);
  negativeDistribution.phaseDistribution[0].userCount = -1;
  assert.throws(() => assertB4PhaseOverview(negativeDistribution), /B4_RESPONSE_INVALID:phaseDistribution\.0\.userCount/);

  const negativePivot = structuredClone(b4);
  negativePivot.nextPivot = { ...negativePivot.nextPivot, daysLeft: -99 };
  assert.throws(() => assertB4PhaseOverview(negativePivot), /B4_RESPONSE_INVALID:nextPivot\.daysLeft/);
});

test("B4 八个 H1 旋钮必须按各自业务范围校验", () => {
  const negativeDial = structuredClone(b4);
  negativeDial.dials[0].currentValue = -999;
  assert.throws(() => assertB4PhaseOverview(negativeDial), /B4_RESPONSE_INVALID:dials\.0\.currentValue/);

  const fakeBoolean = structuredClone(b4);
  fakeBoolean.dials[7].currentValue = "true";
  assert.throws(() => assertB4PhaseOverview(fakeBoolean), /B4_RESPONSE_INVALID:dials\.7\.currentValue/);
});
