import assert from "node:assert/strict";
import test from "node:test";
import { assertL3FinanceContract, assertL3TreasurySnapshot } from "../lib/admin/l3-finance-contract.ts";

function maturity(days) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date("2026-07-01T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + index);
    return {
      date: date.toISOString().slice(0, 10),
      withdrawDueUsdt: index === 0 ? 5 : 0,
      interestDueUsdt: 0,
      genesisDividendUsdt: 1,
      trialShadowStressUsdt: 0,
      totalDueUsdt: index === 0 ? 6 : 1,
    };
  });
}

function validPayload() {
  const period = {
    granularity: "month",
    from: "2026-07-01",
    to: "2026-07-31",
    label: "2026-07",
    timeZone: "Asia/Tokyo",
  };
  const liabilityCategories = [
    "withdrawable_balance",
    "usdt_staking_principal",
    "staking_interest",
    "genesis_daily_emission",
    "nex_v2_future",
    "withdrawal_queue",
    "commission_cooling",
    "lock_other",
    "unverified_deposit",
  ];
  return {
    overview: { module: "L3" },
    revenue: {
      period,
      serverAuthoritative: true,
      totalUsdt: 100,
      streams: [
        ["device_sales", 40],
        ["team_commission", 30],
        ["token_economy", 20],
        ["compute_matching", 10],
      ].map(([stream, amountUsdt]) => ({
        stream,
        label: String(stream),
        source: "server-ledger",
        amountUsdt,
        previousAmountUsdt: amountUsdt,
        share: Number(amountUsdt) / 100,
        momDelta: 0,
      })),
    },
    redemption: {
      period: { ...period },
      serverAuthoritative: true,
      source: "A4 服务端权威提现生命周期事件",
      submitted: 2,
      confirmed: 3,
      rejected: 0,
      delayed: 0,
      frozen: 0,
      averageLatencyHours: 2.25,
      redemptionRate: 150,
      previousRate: null,
      previousLabel: "2026-06",
    },
    coverage: {
      reserveTotalUsdt: 110,
      liabilityTotalUsdt: 90,
      coverageRatio: 122.22,
      netExposureUsdt: 20,
      redLine: 100,
      yellowLine: 110,
      source: "B1 双账本",
      series: [
        { period: "2026-07-01T00:00:00", coverageRatio: 120 },
        { period: "2026-07-01T03:00:00", coverageRatio: 122.22 },
      ],
      breaches: [],
    },
    liabilities: {
      hardLiabilityCategoryCount: 9,
      trialShadowIncluded: false,
      totalUsdt: 90,
      breakdown: liabilityCategories.map((category) => ({
        category,
        label: category,
        source: "canonical-ledger",
        amountUsdt: 10,
        share: 1 / 9,
      })),
    },
    maturity7: { window: "7d", daily: maturity(7), reserveCoverDays: 12 },
    maturity30: { window: "30d", daily: maturity(30), reserveCoverDays: 12 },
  };
}

test("accepts the complete seven-source L3 contract", () => {
  const payload = validPayload();
  assert.equal(assertL3FinanceContract(payload), payload);
});

test("accepts only a server-authoritative L3 treasury aggregation envelope", () => {
  const payload = validPayload();
  const treasury = {
    serverAuthoritative: true,
    coverage: payload.coverage,
    liabilities: payload.liabilities,
    maturity7: payload.maturity7,
    maturity30: payload.maturity30,
  };

  assert.deepEqual(assertL3TreasurySnapshot(treasury), {
    coverage: payload.coverage,
    liabilities: payload.liabilities,
    maturity7: payload.maturity7,
    maturity30: payload.maturity30,
  });
  assert.throws(
    () => assertL3TreasurySnapshot({ ...treasury, serverAuthoritative: false }),
    /L3_FINANCE_PROTOCOL_INVALID:treasurySnapshot\.serverAuthoritative/,
  );
});

test("accepts the canonical minus one hundred percent month-over-month revenue delta", () => {
  const payload = validPayload();
  payload.revenue.streams[0].amountUsdt = 0;
  payload.revenue.streams[0].previousAmountUsdt = 40;
  payload.revenue.streams[0].share = 0;
  payload.revenue.streams[0].momDelta = -100;
  payload.revenue.totalUsdt = 60;
  assert.equal(assertL3FinanceContract(payload), payload);
});

test("rejects an impossible revenue decrease below minus one hundred percent", () => {
  const payload = validPayload();
  payload.revenue.streams[0].momDelta = -100.1;
  assert.throws(
    () => assertL3FinanceContract(payload),
    /L3_FINANCE_PROTOCOL_INVALID:revenue\.streams\[0\]\.momDelta/,
  );
});

test("rejects an HTTP 200 payload with a missing ninth liability", () => {
  const payload = validPayload();
  payload.liabilities.breakdown.pop();
  assert.throws(
    () => assertL3FinanceContract(payload),
    /L3_FINANCE_PROTOCOL_INVALID:liabilities\.breakdown\.length/,
  );
});

test("rejects counterfeit zeros when an authoritative revenue source is missing", () => {
  const payload = validPayload();
  delete payload.revenue.streams[0].amountUsdt;
  assert.throws(
    () => assertL3FinanceContract(payload),
    /L3_FINANCE_PROTOCOL_INVALID:revenue\.streams\[0\]\.amountUsdt/,
  );
});

test("allows confirmation events for earlier submissions but rejects a state-table source", () => {
  const payload = validPayload();
  assert.doesNotThrow(() => assertL3FinanceContract(payload));
  payload.redemption.source = "提现订单状态机";
  assert.throws(
    () => assertL3FinanceContract(payload),
    /L3_FINANCE_PROTOCOL_INVALID:redemption\.source/,
  );
});

test("rejects a gap in the thirty-day maturity calendar", () => {
  const payload = validPayload();
  payload.maturity30.daily[10].date = "2026-07-20";
  assert.throws(
    () => assertL3FinanceContract(payload),
    /L3_FINANCE_PROTOCOL_INVALID:maturity30\.daily\.consecutive/,
  );
});
