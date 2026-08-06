import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const c3 = readFileSync(new URL("../app/components/domain-views/c-tabs/c3-adjust.tsx", import.meta.url), "utf8");
const d4 = readFileSync(new URL("../app/components/domain-views/d-tabs/d4-ledger.tsx", import.meta.url), "utf8");
const dView = readFileSync(new URL("../app/components/domain-views/d-view.tsx", import.meta.url), "utf8");
const dRegistry = readFileSync(new URL("../lib/admin/registry/d.ts", import.meta.url), "utf8");
const dClient = readFileSync(new URL("../lib/admin/d-client.ts", import.meta.url), "utf8");
const treasuryRoute = readFileSync(new URL("../app/api/admin/treasury/[...path]/route.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/user360-client.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/admin/users/[...path]/route.ts", import.meta.url), "utf8");
const errors = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");

test("C3 selects a stable user id and loads the complete impact context", () => {
  assert.match(c3, /account\?\.userId \?\? account\?\.id/);
  assert.match(c3, /fetchUserAssetAdjustmentContext/);
  assert.match(c3, /fetchUserAssetAdjustmentAccounts/);
  assert.match(c3, /data-proof="c3-target-card"/);
  for (const field of ["walletUsdt", "walletNex", "pendingWithdraw", "kycStatus", "riskBand", "registeredAt"]) {
    assert.match(c3, new RegExp(field));
  }
});

test("C3 creates a pending review request with structured evidence and retry-stable idempotency", () => {
  assert.match(c3, /reasonCode/);
  assert.match(c3, /evidenceRef/);
  // 命令号跨刷新存活(sessionStorage 共享 store),不再是刷新即清零的 useState/useRef。
  assert.match(c3, /const key = c3Commands\.get\(fingerprint\) \?\? newIdempotencyKey\("c3-adjust"\)/);
  assert.match(c3, /c3Commands\.remember\(fingerprint, key\)/);
  assert.match(c3, /setAmountText\(""\)/);
  assert.match(c3, /setReason\(""\)/);
  assert.match(c3, /setEvidenceRef\(""\)/);
  assert.match(client, /idempotencyKey: input\.idempotencyKey/);
  assert.match(c3, /requestLargeUserAssetAdjustment/);
  assert.match(c3, /客服不能直接执行超过 500 USDT 等值/);
  assert.match(c3, /调整申请已提交/);
  assert.match(c3, /等待独立复核/);
  assert.match(c3, /批准后才更新余额并生成关联账单/);
  assert.doesNotMatch(c3, /usePropose|挂起中的加钱申请/);
});

test("C3 previews balance and coverage boundaries before execution", () => {
  assert.match(c3, /balanceAfter/);
  assert.match(c3, /projectedCoverage/);
  assert.match(c3, /amountUsd > maxAmount/);
  assert.match(c3, /reasonLength < 8 \|\| reasonLength > 200/);
  assert.match(c3, /debitInsufficient/);
  assert.match(c3, /amountFormatValid/);
  assert.match(c3, /coverageReliable/);
  assert.match(c3, /creditCoverageUnavailable/);
  assert.match(c3, /function formatUsdEquivalent/);
  assert.match(c3, /maximumFractionDigits: 8/);
  assert.match(c3, /formatUsdEquivalent\(amountUsd\)/);
  assert.match(c3, /formatUsdEquivalent\(detailRow\.amountUsd\)/);
  for (const code of ["C3_COVERAGE_UNRELIABLE", "C3_INSUFFICIENT_BALANCE", "C3_ADJUSTMENT_REVIEW_FORBIDDEN", "C3_MAKER_CANNOT_REVIEW", "AMOUNT_INVALID"]) {
    assert.match(errors, new RegExp(code));
  }
});

test("C3 reversal is dedicated, append-only and D4-linked by adjustment number", () => {
  assert.match(client, /\/reverse/);
  assert.match(route, /parts\[2\] === "reverse"/);
  assert.match(c3, /!row\.reversalOf && !row\.reversedBy/);
  assert.match(c3, /approvedOriginal && canReverse/);
  assert.match(c3, /authorities\.includes\("finance_d4_read"\)/);
  assert.match(c3, /row\.ledgerId && canReadLedger/);
  assert.match(c3, /reasonCodeLabel\(detailRow\.reasonCode\)/);
  assert.match(c3, /finance\/ledger\?bizNo=/);
  assert.match(d4, /searchParams\?\.get\("bizNo"\)/);
  assert.match(d4, /data-proof="d4-deep-link"/);
  assert.match(d4, /bizNo: deepBizNo && applied\.keyword === deepBizNo \? deepBizNo : undefined/);
  assert.match(d4, /keyword: deepBizNo && applied\.keyword === deepBizNo \? undefined : applied\.keyword/);
  assert.doesNotMatch(c3, /后端ID|C3 数据加载|C3 是余额|复用同一幂等键|>幂等键</);
  assert.doesNotMatch(d4, /后端分页返回|提交写后端|由后端生成|D4 数据加载|C3 关联账单|IN \/ CREDIT|OUT \/ DEBIT/);
  assert.doesNotMatch(dView, /服务器是唯一账本|客户端报的账一律不认|每笔资金动作必落账/);
  assert.doesNotMatch(dRegistry, /服务器唯一账本|C3 调账专用类|和 D3 的储备/);
  assert.match(d4, /BILL_TYPE_LABELS\[row\.billType\]/);
  assert.match(d4, /BILL_STATUS_LABELS\[row\.status\.toUpperCase\(\)\] \?\? row\.status/);
  assert.match(d4, /assetAmount\(row\.amount, row\.asset\)/);
  assert.doesNotMatch(d4, /createD4Adjustment|submitAdjustment|手动调账|提交调账/);
  assert.doesNotMatch(dClient, /createD4Adjustment|\/ledger\/adjustments|d4-adjustment/);
  assert.doesNotMatch(treasuryRoute, /ledger\/adjustments/);
  assert.match(dRegistry, /该页面只负责核对/);
});
