import assert from "node:assert/strict";
import test from "node:test";

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
    "register", "kyc", "purchase", "repurchase", "withdraw",
  ].map((key) => ({
    key,
    stage: key,
    event: `${key}.event`,
    distinctUsers: 1,
    previousUsers: 1,
    cvrFromPrev: 100,
    momDelta: 0,
    lifecycleLabel: key,
    kpiTarget: null,
    color: "var(--brand)",
    source: "nx_event_outbox",
  })),
  auxMetrics: {
    storeViewRate: 1,
    storeViewNumerator: 1,
    storeViewDenominator: 1,
    purchaseFromStoreRate: 1,
    purchaseFromStoreNumerator: 1,
    purchaseFromStoreDenominator: 1,
    day0AccessRate: 1,
    day0Numerator: 1,
    day0Denominator: 1,
    day0Target: 1,
    day7Retention: 1,
    day7Numerator: 1,
    day7Denominator: 1,
    day7Target: 1,
    day7Mature: true,
  },
  trend: [],
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
    monthOptions: [1],
    phaseOptions: ["P1"],
  },
  rhythm: { currentPhase: "P1", currentMonth: 1, totalMonths: 12, phaseProgressPct: 0 },
  phaseDistribution: [],
  monthDistribution: [],
  distribution: [],
  dials: Array.from({ length: 8 }, (_, index) => ({
    key: `dial-${index}`,
    label: `Dial ${index}`,
    currentValue: index,
    unit: "",
    source: "H1",
    v1Status: "已生效",
    v1Active: true,
    adjustHref: "/growth/phase",
  })),
  nextPivot: {
    atMonth: null,
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

test("B3 完整五级漏斗协议可通过", () => {
  assert.doesNotThrow(() => assertB3Dashboard(b3));
});

test("B3 畸形 200 必须失败关闭", () => {
  assert.throws(() => assertB3Dashboard({ malformed: true }), /B3_RESPONSE_INVALID/);
  assert.throws(() => assertB3Dashboard({ ...b3, stages: [] }), /B3_RESPONSE_INVALID:stages/);
});

test("B4 完整 H1 权威协议可通过", () => {
  assert.doesNotThrow(() => assertB4PhaseOverview(b4));
});

test("B4 畸形 200 与缺失 dial 必须失败关闭", () => {
  assert.throws(() => assertB4PhaseOverview({ malformed: true }), /B4_RESPONSE_INVALID/);
  assert.throws(() => assertB4PhaseOverview({ ...b4, dials: b4.dials.slice(0, 7) }), /B4_RESPONSE_INVALID:dials/);
});
