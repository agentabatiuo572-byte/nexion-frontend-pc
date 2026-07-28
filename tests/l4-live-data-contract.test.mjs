import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readL4Operations } from "../app/components/domain-views/l-tabs/l4-live-data.ts";

test("L4 parses complete historical device/task/network/phase analytics without inventing null rates", () => {
  const data = readL4Operations({
    available: true,
    period: { key: "month", label: "近 30 天", from: "2026-06-23", to: "2026-07-23" },
    phaseFilter: "ALL",
    device: {
      summary: {
        activeDevices: 9,
        periodPurchasedDevices: 4,
        periodRetiredDevices: 1,
        periodLockedDevices: 2,
        periodFirstYieldDevices: 3,
        dailyYieldUsdt: 88.5,
        dailyYieldNex: 20,
        degradationLossUsdt: 3.2,
      },
      byGeneration: [{ key: "current", count: 3 }],
      byModel: [{ key: "Pro", count: 2 }],
      degradation: [{ band: "4%", events: 2, actualUsdt: 20, lossUsdt: 0.8 }],
    },
    tasks: {
      summary: {
        dispatched: 10,
        completed: 7,
        acceptanceRate: 70,
        queueSaturation: 63,
        checkinActive: 4,
        orderedTaskJoin: true,
      },
      byTier: [{ key: "T1", count: 3 }],
    },
    network: {
      summary: {
        directRefs: 5,
        commissionEvents: 2,
        commissionPaidUsdt: 8,
        teamGmvUsdt: 120,
        promotionRate: 50,
        commissionTriggerRate: null,
      },
      teamSizeDist: [{ key: "10-49", count: 2 }], vRankDist: [{ key: "V2", count: 2 }], commissionStructure: [],
    },
    phaseEffect: ["P1", "P2", "P3", "P4", "P5", "P6"].map((phase) => ({
      phase,
      activeUsers: phase === "P2" ? 4 : 0,
      retentionRate: phase === "P2" ? 75 : null,
      conversionRate: phase === "P2" ? 25 : null,
      yieldUsdt: phase === "P2" ? 18 : 0,
      transitionCount: phase === "P2" ? 1 : 0,
      dialChangeCount: phase === "P2" ? 2 : 0,
      conversionStepPct: null,
    })),
    history: [{ bucket: "2026-07-21", devicePurchases: 1, deviceRetirements: 0, yieldUsdt: 10, tasksCompleted: 2, directRefs: 1, commissionPaidUsdt: 2 }],
    quality: {
      serverCanonical: true,
      sameActorRates: true,
      actorCoveragePct: 100,
      incompleteRatesAreNull: true,
      eventCount: 50,
      duplicateEventsIgnored: 0,
      businessTimeZone: "UTC+08:00",
    },
    liveFacts: { activeUserDevices: 9, teamRelationships: 2 },
  });

  assert.ok(data);
  assert.equal(data.available, true);
  assert.equal(data.period.key, "month");
  assert.equal(data.device.summary.periodPurchasedDevices, 4);
  assert.equal(data.tasks.summary.acceptanceRate, 70);
  assert.equal(data.network.summary.commissionTriggerRate, null);
  assert.equal(data.phaseEffect[1].phase, "P2");
  assert.equal(data.history.length, 1);
  assert.equal(data.liveFacts.activeUserDevices, 9);
});

test("L4 rejects malformed or internally contradictory HTTP 200 analytics instead of rendering safe-looking zeroes", () => {
  const valid = {
    available: true,
    period: { key: "week", label: "近 7 天", from: "2026-07-20", to: "2026-07-27" },
    phaseFilter: "ALL",
    device: {
      summary: {
        periodPurchasedDevices: 1,
        periodRetiredDevices: 0,
        periodLockedDevices: 0,
        periodFirstYieldDevices: 1,
        dailyYieldUsdt: 8,
        dailyYieldNex: 2,
        degradationLossUsdt: 1,
        activeDevices: 1,
      },
      byGeneration: [{ key: "current", count: 1 }],
      byModel: [{ key: "Pro", count: 1 }],
      degradation: [{ band: "4%", events: 1, actualUsdt: 8, lossUsdt: 1 }],
    },
    tasks: {
      summary: {
        dispatched: 2,
        completed: 1,
        acceptanceRate: 50,
        queueSaturation: 30,
        checkinActive: 1,
        orderedTaskJoin: true,
      },
      byTier: [{ key: "T1", count: 1 }],
    },
    network: {
      summary: {
        directRefs: 1,
        commissionEvents: 1,
        commissionPaidUsdt: 3,
        teamGmvUsdt: 20,
        promotionRate: 50,
        commissionTriggerRate: 100,
      },
      teamSizeDist: [{ key: "1-9", count: 1 }],
      vRankDist: [{ key: "V1", count: 1 }],
      commissionStructure: [{ key: "network", count: 1 }],
    },
    phaseEffect: ["P1", "P2", "P3", "P4", "P5", "P6"].map((phase) => ({
      phase,
      activeUsers: 0,
      retentionRate: null,
      conversionRate: null,
      yieldUsdt: 0,
      transitionCount: 0,
      dialChangeCount: 0,
      conversionStepPct: null,
    })),
    history: [{
      bucket: "2026-07-20",
      devicePurchases: 1,
      deviceRetirements: 0,
      yieldUsdt: 8,
      tasksCompleted: 1,
      directRefs: 1,
      commissionPaidUsdt: 3,
    }],
    quality: {
      serverCanonical: true,
      sameActorRates: true,
      actorCoveragePct: 100,
      incompleteRatesAreNull: true,
      eventCount: 9,
      duplicateEventsIgnored: 0,
      businessTimeZone: "UTC+08:00",
    },
    liveFacts: { activeUserDevices: 1, teamRelationships: 1 },
  };

  assert.ok(readL4Operations(valid));
  assert.equal(readL4Operations({ ...valid, phaseFilter: "P9" }), null);
  assert.equal(readL4Operations({
    ...valid,
    device: { ...valid.device, summary: { ...valid.device.summary, dailyYieldUsdt: "not-a-number" } },
  }), null);
  assert.equal(readL4Operations({
    ...valid,
    tasks: { ...valid.tasks, summary: { ...valid.tasks.summary, acceptanceRate: 150 } },
  }), null);
  assert.equal(readL4Operations({
    ...valid,
    tasks: { ...valid.tasks, summary: { ...valid.tasks.summary, completed: 3 } },
  }), null);
  assert.equal(readL4Operations({
    ...valid,
    phaseEffect: [...valid.phaseEffect.slice(0, 5), { ...valid.phaseEffect[4] }],
  }), null);
  assert.equal(readL4Operations({
    ...valid,
    quality: { ...valid.quality, serverCanonical: false },
  }), null);
});

test("L4 source exposes real four-report navigation, period/phase filters and safe empty handling", async () => {
  const source = await readFile(new URL("../app/components/domain-views/l-tabs/l4-ops.tsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../lib/admin/l-client.ts", import.meta.url), "utf8");
  const bff = await readFile(new URL("../app/api/admin/bi/[...path]/route.ts", import.meta.url), "utf8");
  for (const label of ["历史运营报表", "设备运营报表", "任务承接报表", "网络与团队报表", "Phase 节奏效果报表"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /period=/);
  assert.match(source, /phase=/);
  assert.match(source, /所选周期暂无历史运营事件/);
  assert.match(source, /actor 覆盖率/);
  assert.match(source, /导出运营报表 CSV/);
  assert.match(source, /导出团队明细/);
  assert.match(source, /reasonMin: 8/);
  assert.match(source, /reasonMax: 200/);
  assert.match(source, /用户编码部分隐藏/);
  assert.match(source, /downloadReport\(result\.reportId\)/);
  assert.match(client, /\/export\/network\?\$\{params\.toString\(\)\}/);
  assert.match(client, /detail: "tree"/);
  assert.match(client, /"X-Operation-Reason": encodeURIComponent\(reason\)/);
  assert.match(client, /NETWORK_TREE: "团队树明细"/);
  assert.match(bff, /X-Operation-Reason/);
  assert.doesNotMatch(source, /当前仅支持实时快照|17,103|−\$11\.1K|null%|NaN|Infinity/);
});
