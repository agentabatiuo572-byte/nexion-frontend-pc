import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/components/domain-views/d-tabs/d2-withdrawals.tsx", "utf8");
const d5Page = fs.readFileSync("app/components/domain-views/d-tabs/d5-params.tsx", "utf8");
const client = fs.readFileSync("lib/admin/d-client.ts", "utf8");
const dCss = fs.readFileSync("app/components/domain-views/d-domain.css", "utf8");
const financeRoute = fs.readFileSync("app/api/admin/finance/[...path]/route.ts", "utf8");

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
  assert.match(page, /等待天数/);
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

test("D2 presents an immediately visible drawer with compact Chinese operations copy", () => {
  assert.match(page, /import \{ Drawer, KV,/);
  assert.match(page, /<Drawer[\s\S]*title=\{`单笔详情/);
  assert.match(page, /详情中查看完整费用/);
  assert.match(page, /H1_COOLDOWN_FAST_TRACK:\s*"低风险提现冷却中，到期后系统自动复查"/);
  assert.doesNotMatch(page, /延长持有\(extended-hold\)/);
  assert.doesNotMatch(page, /已提交\(submitted\)/);
  assert.match(dCss, /\.ddom \.d2-fee-summary/);
  assert.match(dCss, /\.ddom \.d2-detail-grid/);
});

test("D2 truncates long withdrawal and asset-chain labels while exposing the full value", () => {
  assert.match(page, /className="l-btn sm d2-withdrawal-link"/);
  assert.match(page, /title=\{row\.withdrawalNo\}/);
  assert.match(page, /aria-label=\{`打开提现单 \$\{row\.withdrawalNo\} 的详情`\}/);
  assert.match(page, /className="d2-cell-ellipsis">\{row\.withdrawalNo\}<\/span>/);
  assert.match(page, /title=\{`\$\{row\.asset\} \/ \$\{row\.chain\}`\}/);
  assert.match(page, /aria-label=\{`资产与链：\$\{row\.asset\} \/ \$\{row\.chain\}`\}/);
  assert.match(dCss, /\.ddom \.d2-cell-ellipsis\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.match(dCss, /\.ddom \.d2-withdrawal-link\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
});

test("D2 lets operators select rows before choosing a permitted batch action", () => {
  assert.doesNotMatch(page, /if \(!action\) return false/);
  assert.match(page, /availableBatchActions/);
  assert.match(page, /可先勾选提现单，再选择批量动作/);
  assert.match(page, /已勾选 \{selectedRows\.length\} 笔/);
  assert.match(page, /batchTargets\(visibleRows, current, "", availableBatchActions\)/);
  assert.doesNotMatch(page, /batchTargets\(visibleRows, current, batchAction, availableBatchActions\)/);
  assert.match(page, /当前批量动作“\$\{actionLabel\(batchAction\)\}”不适用于该状态/);
  assert.match(page, /disabled=\{!selectable && !selectedNow\}/);
  assert.match(dCss, /\.ddom \.d2-selection-note/);
});

test("D2 separates the primary search bar from advanced filters", () => {
  assert.match(page, /d2-search-toolbar/);
  assert.match(page, /高级筛选/);
  assert.match(page, /d2-advanced-filters/);
  assert.match(dCss, /\.ddom \.d2-search-toolbar/);
  assert.match(dCss, /\.ddom \.d2-advanced-filters/);
  assert.match(page, /void load\(1, \{[\s\S]*minAmount: "", maxAmount: "", minRiskScore: ""/);
});

test("D2 detail fetch is latest-only and fails closed before any write", () => {
  assert.match(page, /const detailRequestSeq = useRef\(0\)/);
  assert.match(page, /const seq = \+\+detailRequestSeq\.current/);
  assert.match(page, /if \(seq === detailRequestSeq\.current\) setDetail\(latest\)/);
  assert.match(page, /detailRequestSeq\.current \+= 1/);
  assert.match(page, /setDetailError\(message\)/);
  assert.match(page, /detailLoading \|\| !!detailError/);
  assert.match(page, /为避免按旧数据处置，写操作已关闭/);
});

test("D2 exposes an order-scoped development cooldown simulation without client time travel", () => {
  assert.match(client, /fetchD2DevelopmentCapabilities/);
  assert.match(client, /simulateD2CooldownExpiry/);
  assert.match(client, /\/withdrawals\/development\/capabilities/);
  assert.match(client, /\/withdrawals\/development\/\$\{encodeURIComponent\(withdrawalNo\)\}\/simulate-cooldown-expiry/);
  assert.match(financeRoute, /parts\.length === 3[\s\S]*parts\[0\] === "withdrawals"[\s\S]*parts\[1\] === "development"[\s\S]*parts\[2\] === "capabilities"/);
  assert.match(financeRoute, /parts\.length === 4[\s\S]*parts\[0\] === "withdrawals"[\s\S]*parts\[1\] === "development"[\s\S]*parts\[3\] === "simulate-cooldown-expiry"/);
  assert.match(financeRoute, /return null;/);
  assert.doesNotMatch(financeRoute, /parts\[1\] === "development"[\s\S]{0,160}return `\/api\/admin\/finance\/withdrawals\/development\/\$\{parts\.slice/s);
  assert.match(page, /模拟冷却到期/);
  assert.match(page, /仅开发环境/);
  assert.match(page, /按真实到期状态机重新检查 K3、K4、B1/);
  assert.match(page, /developmentSimulationScope/);
  assert.match(page, /row\.status\.toUpperCase\(\) === "EXTENDED_HOLD"/);
  assert.match(page, /row\.previousStatus\.toUpperCase\(\) === "REVIEW_PASSED"/);
  assert.match(page, /pendingKeys\.remember\(scope, key\)/);
  assert.doesNotMatch(client, /targetTime|effectiveNow|requestedAt/);
  assert.doesNotMatch(page, /simulateD2CooldownExpiry\([^)]*Date\./s);
});

test("D2 localizes unknown machine values instead of exposing raw codes", () => {
  assert.match(page, /\^\[A-Z0-9_.:-\]\+\$\/i/);
  assert.match(page, /未识别路由/);
  assert.match(page, /未识别账户状态/);
  assert.match(page, /未识别期限/);
  assert.match(page, /ruleSummary\(row\.hitRules\)/);
  assert.match(page, /userStatusLabel\(row\.userStatus\)/);
});

test("D2 blocks SENT freeze and keeps idempotency keys below the server limit", () => {
  assert.doesNotMatch(page, /\["REVIEW_PASSED",\s*"PENDING_CHAIN",\s*"PROCESSING",\s*"SENT",\s*"CHAIN_SUBMITTED"\]/);
  assert.match(page, /scope\.replace\([^)]*\)\.slice\(0,\s*12\)/);
  assert.match(page, /uuid\.replaceAll\("-", ""\)\.slice\(0, 16\)/);
  assert.doesNotMatch(page, /\$\{Date\.now\(\)\}/);
});

test("D2 fails closed when persisted fee snapshot facts are absent", () => {
  assert.match(client, /function d2Number\(/);
  // FEAT-WD02 双形态:共享费字段仍必填解析;旧模型六字段改为可空解析(新单后端序列化 null,
  // 必填会把 100% 新单打成 invalid),各形态缺自家字段的 fail-closed 在 financialInvariants 分支验
  // (行为固定靶见 tests/wd02-network-confirm-fee-contract.test.mjs 三态测试)。
  for (const field of ["nexBurned", "nexFeeOffsetRate", "feeWaived", "actualFee", "netReceive"]) {
    assert.match(client, new RegExp(`${field}: d2Number\\(row\\.${field}`));
  }
  for (const field of ["networkFeeRate", "networkFeeMin", "networkFeeMax", "networkFee", "penaltyFeeRate", "grossFee"]) {
    assert.match(client, new RegExp(`${field}: d2NullableNumber\\(row\\.${field}`));
  }
  // 判型键 + 双形态分支存在
  assert.match(client, /networkConfirmUsd = d2NullableNumber\(row\.networkConfirmUsd/);
  assert.match(client, /feeModel: networkConfirmUsd !== null \? "confirm" : "legacy"/);
  assert.match(client, /d2Invalid\("withdrawal\.feeModel"\)/);
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
