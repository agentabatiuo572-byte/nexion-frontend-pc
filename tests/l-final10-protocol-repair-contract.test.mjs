import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  resolveL1ExportMode,
  submitL1Export,
} from "../app/components/domain-views/l-tabs/l1-export-contract.ts";
import {
  isCanonicalL2StageEvents,
  validateL2FunnelEventBindings,
  validateL2LifecycleContract,
} from "../app/components/domain-views/l-tabs/l2-stage-events-contract.ts";

function validL1Dashboard() {
  const kpis = Array.from({ length: 8 }, (_, index) => ({
    n: index + 1,
    kpiId: String(index + 1),
    name: `KPI ${index + 1}`,
    target: 60,
    dir: "gte",
    unit: "%",
    available: true,
    value: 70,
    numerator: 7,
    denominator: 10,
    spark: [60, 62, 64, 66, 68, 70],
  }));
  return {
    module: "L1",
    kpis,
    weeks: ["W1", "W2", "W3", "W4", "W5", "W6"],
    kpiPlain: Object.fromEntries(kpis.map((row) => [String(row.n), row.name])),
    kpiExt: Object.fromEntries(kpis.map((row) => [String(row.n), { note: row.name }])),
  };
}

const lifecycleStages = [
  { key: "registered", count: 10, source: "nx_event_outbox:auth.register_completed" },
  { key: "profileCompleted", count: 9, source: "nx_event_outbox:onboarding.profile_completed" },
  { key: "ordered", count: 6, source: "nx_event_outbox:checkout.started" },
  { key: "walletActivity", count: 5, source: "nx_event_outbox:wallet.topup_confirmed" },
];

const legalStageEvents = [
  "auth.register_completed",
  "checkout.completed",
  "wallet.reinvest / 二次 checkout.completed",
  "withdraw.submitted",
];

const legalFunnelEvents = legalStageEvents.map((event) => ({
  ev: event,
  source: `nx_event_outbox:${event}`,
}));

test("L1 malformed or unavailable authoritative KPI data cannot submit an export", async () => {
  const malformed = validL1Dashboard();
  malformed.kpis = malformed.kpis.slice(0, 7);
  malformed.totals = { users: 10, orders: 6 };
  const calls = [];

  assert.equal(resolveL1ExportMode(malformed, false), null);
  assert.equal(await submitL1Export(malformed, false, async (...args) => calls.push(args)), null);
  assert.equal(await submitL1Export(validL1Dashboard(), true, async (...args) => calls.push(args)), null);
  assert.equal(resolveL1ExportMode({ available: false, totals: { users: 10 } }, false), null);
  assert.equal(calls.length, 0, "failed-closed paths must not call the report POST carrier");
});

test("L1 incomplete KPI spark sequences are not exportable", () => {
  const incomplete = validL1Dashboard();
  incomplete.kpis[3].spark = incomplete.kpis[3].spark.slice(0, 5);

  assert.equal(resolveL1ExportMode(incomplete, false), null);
});

test("L1 recovery with a normal eight-KPI response enables and submits exactly one export", async () => {
  const malformed = validL1Dashboard();
  malformed.kpis = malformed.kpis.slice(0, 7);
  const recovered = validL1Dashboard();
  const calls = [];

  assert.equal(resolveL1ExportMode(malformed, false), null);
  assert.equal(resolveL1ExportMode(recovered, false), "series");
  assert.equal(await submitL1Export(recovered, false, async (...args) => calls.push(args)), "series");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].ticket, "L1-KPI");
});

test("L1 legacy totals remain a separately identified export and missing carriers fail closed", async () => {
  const totals = { totals: { users: 3 } };
  const calls = [];

  assert.equal(resolveL1ExportMode(null, false), null);
  assert.equal(resolveL1ExportMode(totals, false), "totals");
  assert.equal(await submitL1Export(totals, false, async (...args) => calls.push(args)), "totals");
  assert.equal(await submitL1Export(validL1Dashboard(), false, undefined), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].exportType, "KPI 当前汇总");
});

test("L2 accepts the current four-stage lifecycle and the exact dual-source repurchase event", () => {
  assert.equal(lifecycleStages.length, 4);
  assert.equal(isCanonicalL2StageEvents(legalStageEvents), true);
  assert.equal(validateL2LifecycleContract({ stages: lifecycleStages, stageEvents: legalStageEvents }), true);
  assert.equal(validateL2FunnelEventBindings(legalFunnelEvents, legalStageEvents), true);
});

test("L2 canonical mapping stays aligned with the executable contract and real backend producer", async () => {
  const root = new URL("../", import.meta.url);
  const [backend, stageContract] = await Promise.all([
    readFile(new URL("../nexion-backend/src/main/java/ffdd/opsconsole/bi/domain/L2FunnelAnalytics.java", root), "utf8"),
    readFile(new URL("app/components/domain-views/l-tabs/l2-stage-events-contract.ts", root), "utf8"),
  ]);

  assert.match(backend, /"wallet\.reinvest \/ 二次 checkout\.completed"/);
  assert.match(backend, /event\.name\(\)\.equals\("wallet\.reinvest"\)[\s\S]*event\.name\(\)\.equals\("checkout\.completed"\)/);
  assert.match(stageContract, /primary: "wallet\.reinvest"[\s\S]*fallback: \{ event: "checkout\.completed", occurrence: 2 \}/);
});

test("L2 rejects arbitrary or malformed repurchase event strings", () => {
  const wrongSecondOccurrence = legalStageEvents.with(2, "wallet.reinvest / checkout.completed");
  const arbitraryEvent = legalStageEvents.with(2, "wallet.reinvest / admin.report_exported");
  const missingFallback = legalStageEvents.with(2, "wallet.reinvest");

  assert.equal(isCanonicalL2StageEvents(wrongSecondOccurrence), false);
  assert.equal(isCanonicalL2StageEvents(arbitraryEvent), false);
  assert.equal(isCanonicalL2StageEvents(missingFallback), false);
  assert.equal(validateL2LifecycleContract({ stages: lifecycleStages, stageEvents: arbitraryEvent }), false);
  assert.equal(isCanonicalL2StageEvents(null), false);
  assert.equal(isCanonicalL2StageEvents(legalStageEvents.slice(0, 3)), false);
  assert.equal(isCanonicalL2StageEvents(legalStageEvents.with(0, 42)), false);
  assert.equal(validateL2LifecycleContract(null), false);
  assert.equal(validateL2LifecycleContract({ stages: lifecycleStages.slice(0, 3), stageEvents: legalStageEvents }), false);
  assert.equal(validateL2LifecycleContract({
    stages: lifecycleStages.with(0, { ...lifecycleStages[0], count: "10" }),
    stageEvents: legalStageEvents,
  }), false);
  assert.equal(validateL2FunnelEventBindings(
    legalFunnelEvents.with(3, { ...legalFunnelEvents[3], ev: "admin.report_exported" }),
    legalStageEvents,
  ), false);
  assert.equal(validateL2FunnelEventBindings(
    legalFunnelEvents.with(3, { ...legalFunnelEvents[3], source: "nx_event_outbox:admin.report_exported" }),
    legalStageEvents,
  ), false);
});

test("L1/L2 pages wire the executable guards instead of a display-only condition", async () => {
  const root = new URL("../", import.meta.url);
  const [l1, l2] = await Promise.all([
    readFile(new URL("app/components/domain-views/l-tabs/l1-kpi.tsx", root), "utf8"),
    readFile(new URL("app/components/domain-views/l-tabs/l2-funnel.tsx", root), "utf8"),
  ]);

  assert.match(l1, /resolveL1ExportMode/);
  assert.match(l1, /submitL1Export/);
  assert.match(l2, /isCanonicalL2StageEvents/);
  assert.match(l2, /validateL2LifecycleContract/);
  assert.match(l2, /validateL2FunnelEventBindings/);
});
