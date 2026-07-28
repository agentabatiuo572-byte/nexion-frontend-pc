import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/components/domain-views/d-tabs/d2-withdrawals.tsx", "utf8");
const d5Page = fs.readFileSync("app/components/domain-views/d-tabs/d5-params.tsx", "utf8");
const client = fs.readFileSync("lib/admin/d-client.ts", "utf8");

test("D2 uses direct business confirmation with exact authority rendering", () => {
  assert.doesNotMatch(page, /usePropose|进入 A2 待确认队列|findHighOp/);
  assert.match(page, /useAdminAuth/);
  for (const authority of [
    "finance_d2_withdrawal_approve",
    "finance_d2_withdrawal_delay",
    "finance_d2_withdrawal_freeze",
    "finance_d2_withdrawal_unfreeze",
    "finance_d2_withdrawal_reject",
    "finance_d2_withdrawal_refund",
    "finance_d2_withdrawal_batch",
  ]) assert.match(page, new RegExp(authority));
});

test("D2 exposes detail, structured lifecycle forms and batch splitting UI", () => {
  assert.match(page, /单笔详情/);
  assert.match(page, /批量执行/);
  assert.match(page, /持有天数/);
  assert.match(page, /责任人/);
  assert.match(page, /复查时间/);
  assert.match(page, /冻结期限/);
  assert.match(page, /手动退款/);
  assert.match(page, /inputKind: "datetime-local"/);
  assert.match(page, /addressVerified/);
  assert.match(page, /IP 段/);
  assert.match(page, /排序字段/);
  assert.match(page, /毛手续费/);
  assert.match(page, /费用减免/);
  assert.match(page, /NEX抵扣率/);
  assert.match(page, /K4 评分明细/);
  assert.match(page, /全部提现历史/);
  assert.match(client, /reviewD2WithdrawalsBatch/);
  assert.match(client, /fetchD2WithdrawalDetail/);
});

test("D2 blocks SENT freeze and keeps idempotency keys below the server limit", () => {
  assert.doesNotMatch(page, /\["REVIEW_PASSED",\s*"PENDING_CHAIN",\s*"PROCESSING",\s*"SENT",\s*"CHAIN_SUBMITTED"\]/);
  assert.match(page, /scope\.replace\([^)]*\)\.slice\(0,\s*12\)/);
  assert.match(page, /uuid\.replaceAll\("-", ""\)\.slice\(0, 16\)/);
  assert.doesNotMatch(page, /\$\{Date\.now\(\)\}/);
});

test("D2 fails closed when persisted fee snapshot facts are absent", () => {
  assert.match(client, /function d2Number\(/);
  for (const field of ["networkFeeRate", "networkFeeMin", "networkFeeMax", "networkFee", "penaltyFeeRate", "grossFee", "nexBurned", "nexFeeOffsetRate", "feeWaived", "actualFee", "netReceive"]) {
    assert.match(client, new RegExp(`${field}: d2Number\\(row\\.${field}`));
  }
});

test("D2 fails closed on dependent facts and reuses a stable command key", () => {
  assert.doesNotMatch(page, /fetchD5WithdrawalParams\(\)\.catch\(\(\) => null\)/);
  assert.match(page, /setRows\([^)]*records:\s*\[\]/s);
  assert.match(page, /writesEnabled/);
  assert.match(client, /idempotencyKey/);
});

test("D2 preserves a missing K4 score as unavailable and blocks approval", () => {
  assert.match(client, /riskScore: number \| null/);
  assert.match(client, /riskScore: d2NullableNumber\(row\.riskScore\)/);
  assert.match(client, /routingPriority: "ESCALATED" \| "HIGH" \| "NORMAL" \| "LOW" \| "UNAVAILABLE"/);
  assert.match(page, /K4 风险评分不可用/);
  assert.match(page, /action === "APPROVE" && routingUnavailable\(row\)/);
  assert.match(page, /按当前生效 K4 模型动态路由/);
  assert.match(page, /row\.k4AutoEscalateScore/);
  assert.doesNotMatch(page, /riskScore\s*>?=\s*70/);
  assert.doesNotMatch(page, /K4 风险分 ≥ 70/);
  assert.doesNotMatch(page, /K4 风险分 \$\{row\.riskScore\}/);
});

test("D5 exposes the canonical NEX fee offset that D2 snapshots", () => {
  assert.match(client, /nexFeeOffsetRate: d5Number\(raw\.nexFeeOffsetRate/);
  assert.match(client, /"nexFeeOffsetRate"/);
  assert.match(d5Page, /NEX 抵扣率/);
  assert.match(d5Page, /\{ nexFeeOffsetRate: nex \}/);
  assert.match(d5Page, /nexFeeOffsetRate\.toFixed\(2\)\}\/NEX/);
});

test("D5 renders each write control only for its exact authority", () => {
  assert.match(d5Page, /useAdminAuth/);
  assert.match(d5Page, /finance_d5_daily_limit_write/);
  assert.match(d5Page, /finance_d5_balance_max_write/);
  assert.match(d5Page, /finance_d5_fee_write/);
  assert.match(d5Page, /canDailyWrite\s*&&/);
  assert.match(d5Page, /canBalanceWrite\s*&&/);
  assert.match(d5Page, /canFeeWrite\s*&&/);
});
