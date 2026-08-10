import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertF1Overview,
  assertF2Overview,
  assertF3Overview,
  assertF4Overview,
  assertF5Overview,
} from "../lib/admin/f-overview-contract.ts";

const common = {
  commissionPolicy: {},
  guardrails: [],
  configValues: {},
  sources: ["server"],
};

test("F1 rejects an incomplete successful payload", () => {
  assert.throws(() => assertF1Overview({}), /F1_OVERVIEW_RESPONSE_INVALID/);
});

test("F2 rejects an incomplete successful payload", () => {
  assert.throws(() => assertF2Overview({}), /F2_OVERVIEW_RESPONSE_INVALID/);
});

test("F3 rejects an incomplete successful payload", () => {
  assert.throws(() => assertF3Overview({}), /F3_OVERVIEW_RESPONSE_INVALID/);
});

test("F4 rejects an incomplete successful payload", () => {
  assert.throws(() => assertF4Overview({}), /F4_OVERVIEW_RESPONSE_INVALID/);
});

test("F5 rejects an incomplete successful payload", () => {
  assert.throws(() => assertF5Overview({}), /F5_OVERVIEW_RESPONSE_INVALID/);
});

test("F5 rejects a partial 200 payload instead of normalizing missing totals to zero", () => {
  assert.throws(() => assertF5Overview({
    domain: "F5",
    summary: {},
    commissionKinds: ["network", "binary", "peer", "cultivation", "leadership", "genesis"]
      .map((key) => ({ key })),
    commissionFilters: [],
    commissionEvents: [],
    statusDistribution: [],
    recentAuditFeed: [],
    pagination: {},
    anomalies: [],
    coolingPolicy: [],
    operationHistory: [],
    activeSuspensions: [],
    total: 0,
    ...common,
  }), /F5_OVERVIEW_RESPONSE_INVALID/);
});

test("F1 accepts the complete 13-rank contract", () => {
  const payload = {
    domain: "F1",
    vrankRows: Array.from({ length: 13 }, (_, index) => ({
      v: `V${index}`,
      label: `Rank ${index}`,
      pop: index,
      rewards: [],
    })),
    rewards: {},
    voucherOptions: [],
    voucherLabels: {},
    skuOptions: [],
    skuLabels: {},
    leadership: { ranks: [] },
    configValues: {},
    sources: ["nx_v_rank_config"],
  };
  assert.doesNotThrow(() => assertF1Overview(payload));
});

test("F2-F5 accept their minimum complete contracts", () => {
  assert.doesNotThrow(() => assertF2Overview({
    domain: "F2",
    metrics: [],
    unilevelRates: Array.from({ length: 7 }, (_, index) => ({ level: `L${index + 1}` })),
    rateTiers: [],
    policyParams: [],
    ...common,
  }));
  assert.doesNotThrow(() => assertF3Overview({
    domain: "F3",
    metrics: [],
    formula: {},
    settlements: [],
    dailyCap: {},
    config: {},
    maxTrackGmv: 0,
    participantCount: 0,
    blockedCount: 0,
    monthlyMatchedUsd: 0,
    autoPlacement7dCount: 0,
    dailyMatchUsd: 0,
    ...common,
  }));
  assert.doesNotThrow(() => assertF4Overview({
    domain: "F4",
    metrics: [],
    quotaRows: [],
    ambassadorBands: [],
    podium: [],
    voteWeights: [{ v: "V3", votes: 1 }],
    config: {},
    ...common,
  }));
  assert.doesNotThrow(() => assertF5Overview({
    domain: "F5",
    summary: {
      monthlyCommissionSpendLabel: "USDT 0.00 · NEX 0.00",
      monthlyCommissionSpend: { usdt: 0, nex: 0, count: 0 },
      coolingBalanceLabel: "USDT 0.00 · NEX 0.00",
      coolingBalance: { usdt: 0, nex: 0, count: 0 },
      withdrawableThisMonthLabel: "USDT 0.00 · NEX 0.00",
      withdrawableThisMonth: { usdt: 0, nex: 0, count: 0 },
      frozenCount: 0,
    },
    commissionKinds: ["network", "binary", "peer", "cultivation", "leadership", "genesis"]
      .map((key) => ({
        key,
        code: key.toUpperCase(),
        label: key,
        amountLabel: "USDT 0.00 · NEX 0.00",
        amounts: { usdt: 0, nex: 0, count: 0 },
        count: 0,
        countLabel: "0 笔",
        className: `k-${key}`,
      })),
    commissionFilters: [
      ["all", "全部状态"],
      ["cooling", "冷却计提"],
      ["unlocked", "已解锁可提"],
      ["withdrawn", "已提现"],
      ["reversed", "已撤销"],
      ["frozen", "已冻结"],
    ].map(([key, label]) => ({ key, label })),
    commissionEvents: [],
    statusDistribution: [
      ["已解锁可提", "var(--success)"],
      ["冷却计提中", "var(--warning)"],
      ["已提现", "var(--cyan)"],
      ["已撤销", "var(--danger)"],
      ["已冻结", "var(--ink-4)"],
    ].map(([name, color]) => ({ name, color, count: 0 })),
    recentAuditFeed: [],
    pagination: {
      mode: "server-cursor",
      defaultWindow: "全量游标",
      defaultPageSize: 20,
      pageSize: 20,
      maxPageSize: 100,
      requestCursor: "",
      total: 0,
      nextCursor: "",
    },
    nextCursor: "",
    anomalies: [],
    coolingPolicy: [],
    operationHistory: [],
    activeSuspensions: [],
    total: 0,
    ...common,
  }));
});

test("F1-F5 refresh failures clear the last authoritative snapshot", () => {
  const source = readFileSync(
    new URL("../app/components/domain-views/f-view.tsx", import.meta.url),
    "utf8",
  );
  for (const module of ["F1", "F2", "F3", "F4", "F5"]) {
    assert.match(
      source,
      new RegExp(`set${module}Overview\\(null\\)`),
      `${module} must not retain a stale overview after an unknown refresh result`,
    );
  }
});
