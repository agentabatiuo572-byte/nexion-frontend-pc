import assert from "node:assert/strict";
import test from "node:test";

import { assertF5Overview } from "../lib/admin/f-overview-contract.ts";

function fixture() {
  const event = {
    commissionId: "CM-7",
    eventId: 7,
    userId: 9,
    user: "U00000009",
    kind: "network",
    currency: "USDT",
    amount: 12.5,
    settledAt: "2026-08-08 12:30:45",
    status: "cooling",
    coolingDaysLeft: 3,
    cooldownPercent: 0,
    cooldownLabel: "冷却计提",
    state: "计提",
    auditKey: "F.commission.CM-7.status",
    version: 1,
  };
  return {
    domain: "F5",
    summary: {
      monthlyCommissionSpendLabel: "USDT 12.50 · NEX 0.00",
      monthlyCommissionSpend: { usdt: 12.5, nex: 0, count: 1 },
      coolingBalanceLabel: "USDT 12.50 · NEX 0.00",
      coolingBalance: { usdt: 12.5, nex: 0, count: 1 },
      withdrawableThisMonthLabel: "USDT 0.00 · NEX 0.00",
      withdrawableThisMonth: { usdt: 0, nex: 0, count: 0 },
      frozenCount: 0,
    },
    commissionKinds: ["network", "binary", "peer", "cultivation", "leadership", "genesis"].map((key) => ({
      key,
      code: key.toUpperCase(),
      label: key,
      amountLabel: key === "network" ? "USDT 12.50 · NEX 0.00" : "USDT 0.00 · NEX 0.00",
      amounts: { usdt: key === "network" ? 12.5 : 0, nex: 0, count: key === "network" ? 1 : 0 },
      count: key === "network" ? 1 : 0,
      countLabel: key === "network" ? "1 笔" : "0 笔",
      className: `k-${key}`,
    })),
    commissionFilters: [
      ["all", "全部状态"], ["cooling", "冷却计提"], ["unlocked", "已解锁可提"],
      ["withdrawn", "已提现"], ["reversed", "已撤销"], ["frozen", "已冻结"],
    ].map(([key, label]) => ({ key, label })),
    commissionEvents: [event],
    statusDistribution: [
      ["已解锁可提", "var(--success)"], ["冷却计提中", "var(--warning)"],
      ["已提现", "var(--cyan)"], ["已撤销", "var(--danger)"], ["已冻结", "var(--ink-4)"],
    ].map(([name, color]) => ({ name, color, count: name === "冷却计提中" ? 1 : 0 })),
    recentAuditFeed: [],
    pagination: { mode: "server-cursor", defaultWindow: "全量游标", defaultPageSize: 20, pageSize: 20, maxPageSize: 100, requestCursor: "", nextCursor: "", total: 1 },
    nextCursor: "",
    anomalies: [],
    coolingPolicy: [],
    operationHistory: [],
    activeSuspensions: [],
    total: 1,
    commissionPolicy: {},
    guardrails: [],
    configValues: {},
    sources: ["server"],
  };
}

test("F5 接受六类五态内的权威游标事件", () => {
  assert.doesNotThrow(() => assertF5Overview(fixture()));
});

test("F5 拒绝旧类别、旧状态、旧币种、畸形时间和非整数标识", () => {
  for (const mutate of [
    (value) => { value.commissionEvents[0].kind = "retired_legacy"; },
    (value) => { value.commissionEvents[0].status = "APPROVED"; },
    (value) => { value.commissionEvents[0].currency = "BTC"; },
    (value) => { value.commissionEvents[0].settledAt = "not-a-date"; },
    (value) => { value.commissionEvents[0].settledAt = "2026-99-99 99:99:99"; },
    (value) => { value.commissionEvents[0].eventId = 0.5; },
    (value) => { value.commissionEvents[0].userId = 0; },
    (value) => { value.commissionEvents[0].coolingDaysLeft = 0.5; },
    (value) => { value.commissionEvents[0].cooldownPercent = 777; },
    (value) => { value.commissionEvents[0].version = 0.5; },
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => assertF5Overview(value), /F5_OVERVIEW_RESPONSE_INVALID/);
  }
});

test("F5 游标必须与当前页末事件一致，事件必须严格降序", () => {
  const value = fixture();
  const newer = structuredClone(value.commissionEvents[0]);
  Object.assign(newer, {
    commissionId: "CM-8",
    eventId: 8,
    auditKey: "F.commission.CM-8.status",
  });
  value.commissionEvents = [newer, value.commissionEvents[0]];
  value.total = 3;
  value.pagination.total = 3;
  value.pagination.pageSize = 2;
  value.nextCursor = "7";
  value.pagination.nextCursor = "7";
  assert.doesNotThrow(() => assertF5Overview(value));

  for (const mutate of [
    (page) => { page.commissionEvents.reverse(); },
    (page) => { page.nextCursor = "8"; },
    (page) => { page.pagination.nextCursor = "not-a-number"; },
    (page) => { page.pagination.pageSize = 1; },
  ]) {
    const malformed = structuredClone(value);
    mutate(malformed);
    assert.throws(() => assertF5Overview(malformed), /F5_OVERVIEW_RESPONSE_INVALID/);
  }
});

test("F5 拒绝事件标识关系和游标总数互相矛盾", () => {
  for (const mutate of [
    (value) => { value.commissionEvents[0].commissionId = "CM-999"; },
    (value) => { value.commissionEvents[0].user = "U00000001"; },
    (value) => { value.commissionEvents[0].cooldownPercent = 100; },
    (value) => { value.total = 0; },
    (value) => { value.pagination.total = 0; },
    (value) => { value.pagination.defaultPageSize = 0; },
    (value) => { value.pagination.maxPageSize = 10; },
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => assertF5Overview(value), /F5_OVERVIEW_RESPONSE_INVALID/);
  }
});

test("F5 六类金额/笔数文案和五态总数必须由结构化全量聚合派生", () => {
  for (const mutate of [
    (value) => { value.summary.monthlyCommissionSpendLabel = "香蕉"; },
    (value) => { value.commissionKinds[0].countLabel = "999999 笔"; },
    (value) => { value.commissionKinds[0].amountLabel = "USDT 999.00 · NEX 0.00"; },
    (value) => { value.statusDistribution[4].count = 1; },
    (value) => { value.summary.frozenCount = 1; },
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => assertF5Overview(value), /F5_OVERVIEW_RESPONSE_INVALID/);
  }
});

test("F5 首屏被截断时必须返回下一批游标", () => {
  const value = fixture();
  value.total = 2;
  value.pagination.total = 2;
  assert.throws(() => assertF5Overview(value), /F5_OVERVIEW_RESPONSE_INVALID/);
});
