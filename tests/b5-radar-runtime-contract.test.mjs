import assert from "node:assert/strict";
import test from "node:test";

import { normalizeB5Radar } from "../lib/admin/b5-radar-contract.ts";

function fixture() {
  return {
    generatedAt: "2026-08-08T00:00:00",
    bankrun: {
      ratio24h: 0.1,
      ratioCalculable: true,
      light: "green",
      withdraw24hUsdt: 10,
      reserveUsdt: 100,
      ratioWithdraw24hUsdt: 10,
      ratioReserveUsdt: 100,
      pressureRatio: 0.5,
      pressureCalculable: true,
      pressureRedLine: 0.7,
      pressureLight: "green",
      yellowPct: 20,
      redPct: 50,
      version: 1,
    },
    abnormalAccounts: {
      count: 3,
      byCategory: [
        { category: "multi-account", label: "多账户", count: 1 },
        { category: "arbitrage", label: "套利", count: 2 },
        { category: "trial-cycle", label: "Trial", count: 0 },
        { category: "withdraw-held", label: "出金", count: 0 },
      ],
    },
    withdrawBacklog: {
      byState: [
        { state: "submitted", count: 1, amountUsdt: 10, overSlaCount: 0, slaHours: 48 },
        { state: "review-passed", count: 2, amountUsdt: 20, overSlaCount: 1, slaHours: 48 },
        { state: "processing", count: 3, amountUsdt: 30, overSlaCount: 0, slaHours: 48 },
      ],
      totalCount: 6,
      totalAmountUsdt: 60,
      slaHours: 48,
      overSlaCount: 1,
      light: "yellow",
    },
    killSwitches: ["withdraw", "staking", "genesis", "exchange", "trial"].map((key) => ({ key, enabled: true, light: "green" })),
    coverage: {
      ratio: 120,
      light: "green",
      redlinePct: 100,
      reserveUsdt: 120,
      liabilitiesUsdt: 100,
      ratioReserveUsdt: 120,
      ratioLiabilitiesUsdt: 100,
    },
    pressureHistory: Array.from({ length: 8 }, (_, index) => ({ label: `08-${String(index + 1).padStart(2, "0")}`, ratio: 0.5 })),
    alertSeverity: ["P0", "P1", "P2", "P3"].map((level, index) => ({ level, count: index + 1 })),
    alertVolume: [1, 2, 3, 4, 0, 0, 0].map((count, index) => ({ label: `08-${String(index + 2).padStart(2, "0")}`, count })),
    recentAlerts: [],
    sources: ["risk"],
  };
}

test("B5 权威快照接受内部一致的真实聚合", () => {
  const result = normalizeB5Radar(fixture());
  assert.equal(result.abnormalAccounts.count, 3);
  assert.equal(result.withdrawBacklog.totalCount, 6);
  assert.equal(result.alertSeverity.reduce((sum, row) => sum + row.count, 0), 10);
});

test("B5 异常账户总数允许同一用户命中多类，但必须落在类别上下界", () => {
  const overlap = fixture();
  overlap.abnormalAccounts.count = 2;
  assert.equal(normalizeB5Radar(overlap).abnormalAccounts.count, 2);
});

test("B5 拒绝字段齐全但类型被静默强转的响应", () => {
  for (const [field, mutate] of [
    ["abnormal", (value) => { value.abnormalAccounts.count = true; }],
    ["backlog", (value) => { value.withdrawBacklog.totalCount = null; }],
    ["bankrun", (value) => { value.bankrun.ratio24h = ""; }],
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => normalizeB5Radar(value), /B5_RESPONSE_INVALID/, field);
  }
});

test("B5 拒绝业务聚合、比率和信号总量互相矛盾的响应", () => {
  for (const mutate of [
    (value) => { value.abnormalAccounts.count = 99; },
    (value) => { value.withdrawBacklog.totalCount = 99; },
    (value) => { value.withdrawBacklog.totalAmountUsdt = 99; },
    (value) => { value.withdrawBacklog.overSlaCount = 99; },
    (value) => { value.bankrun.ratio24h = 0.99; },
    (value) => { value.bankrun.light = "red"; },
    (value) => { value.bankrun.pressureLight = "red"; },
    (value) => { value.alertVolume[0].count = 99; },
    (value) => { value.coverage.ratio = 999; },
    (value) => { value.coverage.light = "red"; },
    (value) => { value.abnormalAccounts.byCategory[0].category = "retired"; },
    (value) => { value.killSwitches[0].light = "red"; },
    (value) => { value.withdrawBacklog.byState[0].overSlaCount = 2; },
    (value) => { value.pressureHistory[3].label = "wrong"; },
    (value) => { value.alertVolume[3].label = "08-31"; },
    (value) => { value.bankrun.withdraw24hUsdt = 50; },
    (value) => { value.bankrun.reserveUsdt = 50; },
    (value) => { value.coverage.reserveUsdt = 50; },
    (value) => { value.coverage.liabilitiesUsdt = 50; },
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => normalizeB5Radar(value), /B5_RESPONSE_INVALID/);
  }
});

test("B5 告警用户必须是正整数，展示金额必须是比率输入的两位舍入", () => {
  const invalidUser = fixture();
  invalidUser.recentAlerts = [{
    signalNo: "SIG-1", level: "P1", message: "风险", userId: 0,
    createdAt: "2026-08-08T00:00:00", target: "/risk/abuse", handlingStatusAvailable: false,
  }];
  assert.throws(() => normalizeB5Radar(invalidUser), /B5_RESPONSE_INVALID/);

  const rounded = fixture();
  Object.assign(rounded.bankrun, {
    withdraw24hUsdt: 1,
    reserveUsdt: 3,
    ratioWithdraw24hUsdt: 1.004,
    ratioReserveUsdt: 3.004,
    ratio24h: 0.3342,
    light: "yellow",
  });
  assert.equal(normalizeB5Radar(rounded).bankrun.withdraw24hUsdt, 1);
});

test("B5 告警目标与时间戳必须是当前控制台白名单和真实日期", () => {
  for (const mutate of [
    (value) => { value.recentAlerts[0].target = "//evil.example"; },
    (value) => { value.recentAlerts[0].createdAt = "2026-99-99T99:99:99"; },
    (value) => { value.generatedAt = "2026-02-30T00:00:00"; },
  ]) {
    const value = fixture();
    value.recentAlerts = [{
      signalNo: "SIG-1", level: "P1", message: "风险", userId: 1,
      createdAt: "2026-08-08T00:00:00", target: "/risk/abuse", handlingStatusAvailable: false,
    }];
    mutate(value);
    assert.throws(() => normalizeB5Radar(value), /B5_RESPONSE_INVALID/);
  }
});

test("B5 覆盖率与挤兑比零分母都不得冒充健康比例", () => {
  const zero = fixture();
  Object.assign(zero.bankrun, { withdraw24hUsdt: 0, reserveUsdt: 0, ratioWithdraw24hUsdt: 0, ratioReserveUsdt: 0, ratio24h: null, ratioCalculable: false, light: "unavailable" });
  assert.equal(normalizeB5Radar(zero).bankrun.ratio24h, null);

  const nonZero = fixture();
  Object.assign(nonZero.bankrun, { withdraw24hUsdt: 1, reserveUsdt: 0, ratioWithdraw24hUsdt: 1, ratioReserveUsdt: 0, ratio24h: null, ratioCalculable: false, light: "red" });
  assert.equal(normalizeB5Radar(nonZero).bankrun.ratio24h, null);

  const forgedHealthy = structuredClone(zero);
  Object.assign(forgedHealthy.bankrun, { ratio24h: 0, ratioCalculable: true, light: "green" });
  assert.throws(() => normalizeB5Radar(forgedHealthy), /B5_RESPONSE_INVALID:bankrun/);

  for (const reserve of [0, 1]) {
    const coverageZero = fixture();
    Object.assign(coverageZero.coverage, {
      ratio: null,
      light: "unavailable",
      reserveUsdt: reserve,
      liabilitiesUsdt: 0,
      ratioReserveUsdt: reserve,
      ratioLiabilitiesUsdt: 0,
    });
    assert.equal(normalizeB5Radar(coverageZero).coverage.ratio, null);
  }
});

test("B5 用后端未舍入输入校验亚分金额比率，不把展示金额误当计算输入", () => {
  const value = fixture();
  Object.assign(value.bankrun, {
    withdraw24hUsdt: 1,
    reserveUsdt: 3,
    ratioWithdraw24hUsdt: 1.004,
    ratioReserveUsdt: 3.004,
    ratio24h: 0.3342,
    light: "yellow",
  });
  assert.equal(normalizeB5Radar(value).bankrun.ratio24h, 0.3342);
});
