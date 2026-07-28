import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readL3FinanceSnapshot, readL3LiveFacts } from "../app/components/domain-views/l-tabs/l3-live-data.ts";

test("L3 maps only the real wallet ledger facts returned by the backend", () => {
  const result = readL3LiveFacts({
    ledgerLive: {
      totalBills: 12,
      refundBills: 2,
      teamCommissionBills: 3,
      genesisDividendBills: 1,
      earningBills: 4,
    },
  });

  assert.deepEqual(
    result.map(({ key, value }) => [key, value]),
    [
      ["totalBills", 12],
      ["earningBills", 4],
      ["teamCommissionBills", 3],
      ["genesisDividendBills", 1],
      ["refundBills", 2],
    ],
  );
  assert.equal(result.find((row) => row.key === "genesisDividendBills")?.label, "Genesis 排放账单");
  assert.ok(result.every((row) => row.label && row.description && row.sourceLabel));
  assert.ok(result.every((row) => !row.sourceLabel.includes("nx_")));
});

test("L3 preserves real zeroes but never fabricates a missing fact", () => {
  assert.deepEqual(
    readL3LiveFacts({ ledgerLive: { totalBills: 0, refundBills: "1" } })
      .map(({ key, value }) => [key, value]),
    [["totalBills", 0], ["refundBills", 1]],
  );
  assert.deepEqual(readL3LiveFacts({}), []);
});

test("L3 reads the canonical treasury snapshot, liabilities and seven-day maturity rows", () => {
  const result = readL3FinanceSnapshot({
    financeLive: {
      generatedAt: "2026-07-17T16:20:00",
      snapshot: {
        reserveUsd: "700000.00",
        liabilitiesUsd: 604385.77,
        coverageRatio: 115.82,
        redlinePct: 100,
        valuationReliable: true,
      },
      accounts: [
        { key: "withdrawable_balance", amount: 500000 },
        { key: "usdt_staking_principal", amount: 100 },
        { key: "staking_interest", amount: 20 },
        { key: "genesis_daily_emission", amount: 30 },
        { key: "nex_v2_future", amount: 40 },
        { key: "withdrawal_queue", amount: 50 },
        { key: "commission_cooling", amount: 60 },
        { key: "lock_other", amount: 70 },
      ],
      maturity7d: [{ day: "2026-07-18", withdrawUsd: 120, interestUsd: 30 }],
    },
  });

  assert.equal(result?.reserveUsd, 700000);
  assert.equal(result?.valuationReliable, true);
  assert.deepEqual(result?.accounts.map(({ label, amount }) => [label, amount]), [
    ["可提余额", 500000],
    ["USDT staking 本金", 100],
    ["staking 应付利息", 20],
    ["Genesis 排放承诺", 30],
    ["NEX v2 未来兑付", 40],
    ["待提现 queue", 50],
    ["佣金冷却未解锁", 60],
    ["锁仓本息其他", 70],
  ]);
  assert.deepEqual(result?.maturity7d, [{ day: "2026-07-18", withdrawUsd: 120, interestUsd: 30 }]);
  assert.equal(readL3FinanceSnapshot({ ledgerLive: { totalBills: 1 } }), null);
});

test("L3 degraded view and export avoid fake periods and expose only governed masked detail", async () => {
  const source = await readFile(
    new URL("../app/components/domain-views/l-tabs/l3-finance.tsx", import.meta.url),
    "utf8",
  );
  const fallback = await readFile(
    new URL("../app/components/domain-views/l-tabs/l3-live-fallback.tsx", import.meta.url),
    "utf8",
  );
  const client = await readFile(
    new URL("../lib/admin/l-client.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /readL3LiveFacts/);
  assert.match(source, /disabled=\{exporting \|\| !ctx\.canExport/);
  assert.match(source, /if \(exportingRef\.current\) return/);
  assert.match(source, /bi_l3_export_detail|canExportFinanceDetail/);
  assert.match(source, /申请导出脱敏资金明细/);
  assert.match(source, /maskPolicy: "MASKED"/);
  assert.match(source, /piiLevel: "HIGH_PII"/);
  assert.match(source, /reasonMin: 8/);
  assert.match(source, /reasonMax: 200/);
  assert.match(client, /网络连接已中断，未收到任务创建成功确认/);
  assert.match(client, /同一请求会自动防重/);
  assert.doesNotMatch(source, /2026-05|48,210|admin\.report_exported/);
  assert.doesNotMatch(fallback, /withdraw\.|confirmed\s*[÷→]|nx_|\bPII\b/);
  assert.match(fallback, /不展示推算值/);
  assert.match(fallback, /字段白名单、行数上限、L5 审批与限时下载令牌/);
});

test("L3 reuses treasury no-due semantics instead of presenting the 999 sentinel as an exact day count", async () => {
  const source = await readFile(
    new URL("../app/components/domain-views/l-tabs/l3-finance.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /formatReserveCoverDays\(maturity30DueUsdt,\s*RESERVE_COVER_DAYS\)/);
  assert.match(source, /maturity30DueUsdt === 0\s*\?\s*"不计算"/);
  assert.doesNotMatch(source, /\{RESERVE_COVER_DAYS\} 天/);
});
