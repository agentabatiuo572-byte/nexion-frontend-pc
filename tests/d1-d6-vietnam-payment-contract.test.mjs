import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const d1 = readFileSync(new URL("../app/components/domain-views/d-tabs/d1-recon.tsx", import.meta.url), "utf8");
const d3 = readFileSync(new URL("../app/components/domain-views/d-tabs/d3-treasury.tsx", import.meta.url), "utf8");
const d6 = readFileSync(new URL("../app/components/domain-views/d-tabs/d6-fx.tsx", import.meta.url), "utf8");
const dView = readFileSync(new URL("../app/components/domain-views/d-view.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/d-client.ts", import.meta.url), "utf8");
const financeProxy = readFileSync(new URL("../app/api/admin/finance/[...path]/route.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../lib/admin/registry/d.ts", import.meta.url), "utf8");
const errors = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");

test("D1 bank rail is real-API backed and has all five operational views plus an empty state", () => {
  for (const label of ["待付款单", "已匹配回单", "未找到付款单", "信息不一致", "逾期 / 重复回单", "收款账户池"]) {
    assert.match(d1, new RegExp(label));
  }
  for (const explanation of [
    "用户已生成付款单，银行回单尚未登记",
    "银行回单找不到对应付款单",
    "收款账户或金额与付款单不一致",
    "不能入账，只能登记退回",
  ]) {
    assert.match(d1, new RegExp(explanation));
  }
  assert.match(d1, /loadD1VietQrOverview/);
  assert.match(d1, /当前视图暂无银行轨记录/);
  assert.doesNotMatch(d1, /lib\/mock\/admin\/bank-rail/);
});

test("D1 and D6 writes use real finance proxy routes with idempotency and optimistic concurrency", () => {
  for (const endpoint of ["/vietqr/overview", "/vietqr/config", "/vietqr/accounts", "/vietqr/receipts", "/fx-quote"]) {
    assert.ok(client.includes(endpoint) || financeProxy.includes(endpoint), `missing ${endpoint}`);
  }
  assert.match(client, /Idempotency-Key/);
  assert.match(client, /expectedVersion/);
  assert.match(financeProxy, /vietqr/);
  assert.match(financeProxy, /fx-quote/);
});

test("D1 manual match trusts canonical intent ownership instead of an operator-entered user id", () => {
  assert.doesNotMatch(d1, /\{ key: "userId", label: "目标用户 ID"/);
  assert.match(d1, /用户归属由服务端意向单唯一确定/);
  assert.match(d1, /银行回单 \/ 工单凭证/);
  assert.match(client, /evidenceRef: string/);
  assert.match(d1, /登记真实银行回单/);
  assert.match(d1, /交易参考号不是付款单号，也不能自行编写/);
  assert.match(d1, /inputKind: "asset-upload"/);
  assert.match(d1, /uploadPurpose: "vietqr-receipt"/);
  assert.match(financeProxy, /"receipt-evidence"/);
  assert.match(financeProxy, /request\.arrayBuffer\(\)/);
  assert.match(d1, /付款单分配账户/);
  assert.match(d1, /row\.viewType === "INFLIGHT"/);
  assert.match(d1, /mismatchReason/);
  assert.match(d1, /收款账户不一致的回单不能按实收核销/);
  assert.match(d1, /vietQrReceivedAtInstant/);
  assert.match(d1, /`\$\{normalized\}\+07:00`/);
  assert.match(d1, /calendarCheck\.getUTCFullYear\(\)/);
  assert.match(d1, /银行到账时间包含不存在的日期或时间/);
  assert.match(d1, /row\.paymentReference/);
  assert.match(d1, /timeText\(row\.receivedAt\)/);
  assert.match(d1, /后续调参不会反向卡死已匹配回单/);
  for (const code of [
    "VIETQR_INTENT_NOT_FOUND",
    "VIETQR_INTENT_USER_MISMATCH",
    "VIETQR_INTENT_ALREADY_TERMINAL",
    "VIETQR_INTENT_VERSION_CONFLICT",
    "VIETQR_INTENT_EXPIRED",
    "VIETQR_INTENT_AMOUNT_MISMATCH",
    "VIETQR_INTENT_BANK_ACCOUNT_MISMATCH",
    "VIETQR_EVIDENCE_REFERENCE_INVALID",
    "VIETQR_BOUND_INTENT_OVERRIDE_NOT_ALLOWED",
    "VIETQR_BANK_ACCOUNT_RECEIPT_TOTAL_UPDATE_FAILED",
    "VIETQR_RECEIPT_PREDATES_INTENT",
    "VIETQR_RECEIPT_CREDIT_LIMIT_EXCEEDED",
    "VIETQR_ORPHAN_RETURN_TARGET_NOT_ALLOWED",
  ]) {
    assert.match(errors, new RegExp(code));
  }
  assert.match(d1, /row\.viewType === "LATE"/);
  assert.match(d1, /\["ORPHAN", "MISMATCH", "LATE"\]\.includes\(row\.viewType\)/);
  assert.match(d1, /迟到或补充回单不复用原付款单的过期锁价/);
  assert.doesNotMatch(d1, /action: `补入账/);
});

test("D1 keeps the current bank queue visible after a deterministic reconciliation rejection", () => {
  const bankWrite = d1.match(/const applyBankWrite = async[\s\S]*?\n  };/)?.[0] ?? "";
  assert.match(bankWrite, /setError/);
  assert.doesNotMatch(bankWrite, /setVietQr\(null\)/);
  assert.match(bankWrite, /isDOutcomeUnknownError/);
  assert.match(bankWrite, /操作已被服务端受理，但最新列表回读失败/);
  assert.match(bankWrite, /return;/);
  assert.doesNotMatch(bankWrite, /throw readbackError/);
});

test("shared operation forms visibly mark and enforce required uploaded evidence", () => {
  const kit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
  assert.match(kit, /inputKind\?:[\s\S]*"asset-upload"/);
  assert.match(kit, /uploadAdminMedia/);
  assert.match(kit, /aria-required/);
  assert.match(kit, /必填/);
  assert.match(kit, /role="alert"/);
});

test("D6 derives quote from base plus spread, renders history from the server, and fails closed", () => {
  assert.match(d6, /基准价/);
  assert.match(d6, /买入点差/);
  assert.match(d6, /锁价窗/);
  assert.match(d6, /调价不影响在途单/);
  assert.match(d6, /loadD6FxQuote/);
  assert.match(d6, /updateD6FxQuote/);
  assert.match(d6, /setData\(null\)/);
  assert.match(d6, /参数值未变化，本次未提交/);
  assert.match(d6, /D1 新付款单与回单/);
  assert.match(d6, /A2 调价审计/);
  assert.match(d6, /A4 调价事件/);
  assert.match(client, /rangeOrDerivedQuote/);
  assert.match(client, /result\.quoteRateVndPerUsdt !== Math\.round/);
  assert.doesNotMatch(d6, /lib\/mock\//);
  assert.match(dView, /D6:\s*"D6"/);
  assert.match(dView, /tab === "D6" && <D6Fx/);
});

test("D3 exposes nine canonical liabilities and the bank suspense source", () => {
  assert.match(d3, /应付负债 · 9 类科目/);
  assert.match(client, /unverified_deposit/);
  assert.match(client, /D3_LIABILITY_KEYS\.length !== 9|D3_LIABILITY_KEYS\.length != 9/);
  assert.doesNotMatch(d3, /应付负债 · 8 类科目/);
  assert.doesNotMatch(registry, /固定 8 类应付负债/);
  assert.match(registry, /path: "\/finance\/fx-rate"/);
});

test("D1 and D6 translate concurrency and validation failures into actionable operator guidance", () => {
  for (const code of [
    "VIETQR_RECONCILIATION_ALREADY_TERMINAL",
    "VIETQR_RECONCILIATION_VERSION_CONFLICT",
    "VIETQR_BANK_ACCOUNT_VERSION_OR_STATE_CONFLICT",
    "VIETQR_CONFIG_VERSION_CONFLICT",
    "FX_QUOTE_VERSION_CONFLICT",
    "FX_QUOTE_NO_CHANGES",
    "FX_BASE_RATE_OUT_OF_RANGE",
  ]) {
    assert.match(errors, new RegExp(`${code}:`), `missing operator message for ${code}`);
  }
});
