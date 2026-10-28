import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { readL3FinanceSnapshot, readL3LiveFacts } from "../app/components/domain-views/l-tabs/l3-live-data.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const render = require("react-dom/server").renderToStaticMarkup;
const imports = {
  "react": React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "@/app/components/kit/gloss": { AutoGloss: ({ children }) => children },
  "@/lib/admin/error-messages": { displayAdminError: String },
  "./l3-live-data": { readL3FinanceSnapshot, readL3LiveFacts },
};
function loadComponent(file) {
  const module = { exports: {} };
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  runInNewContext(compiled.outputText, {
    module, exports: module.exports,
    require: name => { assert.ok(name in imports, `unexpected import: ${name}`); return imports[name]; },
  });
  return module.exports;
}
imports["./live-data"] = loadComponent("../app/components/domain-views/l-tabs/live-data.tsx");
imports["./l3-live-fallback"] = loadComponent("../app/components/domain-views/l-tabs/l3-live-fallback.tsx");
imports["@/lib/admin/treasury-cover-days"] = loadComponent("../lib/admin/treasury-cover-days.ts");
const { L3Finance } = loadComponent("../app/components/domain-views/l-tabs/l3-finance.tsx");

function financeView(rate, prevRate, netExposure) {
  return {
    ledger: { reserveUsd: 90 + netExposure, liabilitiesUsd: 90 },
    treasury: { coverageRatio: 100, redLine: 100, yellowLine: 110, netExposure },
    redemption: { submitted: 4, confirmed: 2, rejected: 0, delayed: 0, frozen: 0, rate, prevRate },
    revenueExt: [{ nm: "设备销售", src: "server-ledger", amt: 10, mom: "0.0%", up: false }],
    liabilities: [{ id: 1, name: "可提余额", amount: 90 }],
    coverage12w: [100, 110], coverageWeeks: ["上期", "本期"],
    maturityWindow: { "7d": { withdraw: 0, interest: 0, genesis: 0 }, "30d": { withdraw: 0, interest: 0, genesis: 0 } },
    maturitySchedule: { weeks: ["本周"], data: [[0, 0, 0]] }, reserveCoverDays: 999,
  };
}

test("L3 renders actual sign-derived tones and single signs for redemption change and net exposure", () => {
  for (const [rate, previous, exposure, delta, amount, color] of [
    [50, 75, -20, "-25.0 个百分点", "-$20", "danger"],
    [75, 50, 20, "+25.0 个百分点", "+$20", "success"],
    [50, 50, 0, "0.0 个百分点", "$0", "ink-3"],
    [null, 50, 0, "—", "$0", "ink-3"],
    [50, null, 0, "—", "$0", "ink-3"],
  ]) {
    const html = render(React.createElement(L3Finance, { ctx: { biData: { l3: financeView(rate, previous, exposure) } } }));
    const deltaMarkup = html.match(/较上期变化<\/div><div class="v"[^>]*>[^<]*<\/div>/)?.[0];
    const exposureMarkup = html.match(/<span class="lcode"[^>]*>储备与应付款差额 [^<]*<\/span>/)?.[0];
    assert.equal(deltaMarkup, `较上期变化</div><div class="v" style="color:var(--${color})">${delta}</div>`);
    assert.equal(exposureMarkup, `<span class="lcode" style="color:var(--${color})">储备与应付款差额 ${amount}</span>`);
    assert.doesNotMatch(html, /\+-|--\$|NaN|Infinity/);
  }
});

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
  assert.equal(result.find((row) => row.key === "genesisDividendBills")?.label, "创世节点分红账单");
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
    ["USDT 质押本金", 100],
    ["质押应付利息", 20],
    ["创世节点应付分红", 30],
    ["UVT 锁仓到期应付", 40],
    ["待处理提现", 50],
    ["冷却期内未发放的佣金", 60],
    ["其他锁仓本息", 70],
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
  assert.match(fallback, /页面不会估算这些数字/);
  assert.match(fallback, /需要审批，下载链接限时有效/);
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
