import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeB2LiquidityHistory,
  normalizeB4GrowthFlowHistory,
} from "../lib/admin/b-restoration-contract.ts";

const b2 = {
  generatedAt: "2026-08-08T00:00:00",
  flowWindows: Array.from({ length: 8 }, (_, index) => ({
    label: `08-${String(index + 1).padStart(2, "0")}`,
    inflowWan: 10,
    outflowWan: 4,
    netWan: 6,
  })),
  monthlyNewDeposits: Array.from({ length: 8 }, (_, index) => ({ label: `2026-${String(index + 1).padStart(2, "0")}`, amountWan: 10 })),
  sources: ["ledger"],
};

const b4 = {
  generatedAt: "2026-08-08T00:00:00",
  healthyRatio: 1.2,
  currentRatio: 2,
  suggestion: "维持扩张",
  ratioSeries: Array.from({ length: 8 }, (_, index) => ({
    label: `2026-${String(index + 1).padStart(2, "0")}`,
    newInflowWan: 10,
    outflowWan: 5,
    newInflowUsdt: 100000,
    outflowUsdt: 50000,
    ratio: 2,
  })),
  budget: {
    available: true,
    totalUsdt: 100,
    missingKeys: [],
    rows: [
      ["acquisition", "拉新", 10, 10],
      ["commission", "返佣", 20, 20],
      ["genesis", "创世", 30, 30],
      ["reserve", "储备", 40, 40],
    ].map(([key, label, amountUsdt, sharePct]) => ({ key, label, amountUsdt, sharePct, source: `config:${key}` })),
  },
  sources: ["ledger", "config"],
};

test("B2 资金流净额必须等于流入减流出", () => {
  assert.doesNotThrow(() => normalizeB2LiquidityHistory(b2));
  const malformed = structuredClone(b2);
  malformed.flowWindows[0].netWan = -999;
  assert.throws(() => normalizeB2LiquidityHistory(malformed), /B2\.flowWindows\.0\.netWan/);
});

test("B4 比值必须由原始分子分母计算且当前值与最后窗口一致", () => {
  assert.doesNotThrow(() => normalizeB4GrowthFlowHistory(b4));
  const zeroDenominator = structuredClone(b4);
  zeroDenominator.ratioSeries[7].outflowUsdt = 0;
  zeroDenominator.ratioSeries[7].outflowWan = 0;
  assert.throws(() => normalizeB4GrowthFlowHistory(zeroDenominator), /B4\.ratioSeries\.7\.ratio/);

  const fakeCurrent = structuredClone(b4);
  fakeCurrent.currentRatio = 999;
  assert.throws(() => normalizeB4GrowthFlowHistory(fakeCurrent), /B4\.currentRatio/);

  const fakeSuggestion = structuredClone(b4);
  fakeSuggestion.suggestion = "切入收紧";
  assert.throws(() => normalizeB4GrowthFlowHistory(fakeSuggestion), /B4\.suggestion/);
});

test("B4 预算总额和份额必须由四类金额精确派生", () => {
  const fakeTotal = structuredClone(b4);
  fakeTotal.budget.totalUsdt = 999;
  assert.throws(() => normalizeB4GrowthFlowHistory(fakeTotal), /B4\.budget\.totalUsdt/);

  const fakeShare = structuredClone(b4);
  fakeShare.budget.rows[0].sharePct = 40;
  fakeShare.budget.rows[3].sharePct = 10;
  assert.throws(() => normalizeB4GrowthFlowHistory(fakeShare), /B4\.budget\.rows\.0\.sharePct/);
});

test("B4 图表万 USDT 展示值必须绑定权威原始金额", () => {
  for (const field of ["newInflowWan", "outflowWan"]) {
    const value = structuredClone(b4);
    value.ratioSeries[0][field] = 999;
    assert.throws(() => normalizeB4GrowthFlowHistory(value), /B4\.ratioSeries\.0/);
  }
});

test("B2/B4 时间标签必须为后端格式且严格连续递增", () => {
  const badDay = structuredClone(b2);
  badDay.flowWindows[3].label = "wrong";
  assert.throws(() => normalizeB2LiquidityHistory(badDay), /B2\.flowWindows/);

  const badMonth = structuredClone(b2);
  badMonth.monthlyNewDeposits[4].label = "2026-12";
  assert.throws(() => normalizeB2LiquidityHistory(badMonth), /B2\.monthlyNewDeposits/);

  const reversed = structuredClone(b4);
  reversed.ratioSeries.reverse();
  assert.throws(() => normalizeB4GrowthFlowHistory(reversed), /B4\.ratioSeries/);
});
