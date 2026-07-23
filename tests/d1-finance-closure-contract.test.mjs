import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeD1NullableString } from "../lib/admin/d1-nullable-string.ts";

const component = readFileSync(new URL("../app/components/domain-views/d-tabs/d1-recon.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/d-client.ts", import.meta.url), "utf8");

test("D1 load failures fail closed and clear stale business data", () => {
  assert.match(component, /setOverview\(null\)/);
  assert.match(component, /setFlows\(EMPTY_D1_FLOWS\)/);
  assert.match(component, /if \(error && !overview\)/);
  assert.match(component, /重试读取/);
  assert.match(component, /disabled=\{loading \|\| busy\}/);
});

test("D1 distinguishes committed writes from a later flow refresh failure and preserves the confirmation form on write failure", () => {
  assert.match(component, /操作已生效并写入审计，但充值流水刷新失败/);
  assert.match(component, /setOverview\(next\)/);
  assert.match(component, /throw err/);
  const domain = readFileSync(new URL("../app/components/domain-views/d-view.tsx", import.meta.url), "utf8");
  assert.match(domain, /await mc\.run\(reason, newValue, businessValue\)/);
  assert.match(domain, /setActionConfirm\(null\)/);
  assert.doesNotMatch(domain, /void mc\.run\(reason, newValue, businessValue\)/);
});

test("D1 uses strict response guards instead of manufacturing zero/default business truth", () => {
  assert.match(client, /function requireD1Overview/);
  assert.match(client, /D1_RESPONSE_INVALID/);
  assert.match(client, /feeBufferComplete/);
  assert.match(client, /treasuryReserveComplete/);
  assert.match(client, /historicalBackfillComplete/);
  assert.match(client, /feeEvidenceAnomalyCount/);
  assert.match(client, /treasuryReserveAnomalyCount/);
  assert.match(client, /historicalBackfillAnomalyCount/);
  assert.doesNotMatch(client, /primaryPsp: text\(raw\?\.primaryPsp, "Checkout\.com"\)/);
  assert.doesNotMatch(client, /diff: text\(row\.diff, "matched"\)/);
  assert.match(client, /diff: d1OptionalString\(row\.diff, `reconciliation\[\$\{index\}\]\.diff`\)/);
});

test("D1 accepts only explicit null for an absent reconciliation diff", () => {
  const invalid = (field) => { throw new Error(`D1_RESPONSE_INVALID:${field}`); };
  assert.equal(normalizeD1NullableString(null, "diff", invalid), "");
  assert.equal(normalizeD1NullableString("", "diff", invalid), "");
  assert.equal(normalizeD1NullableString("金额不一致", "diff", invalid), "金额不一致");
  for (const malformed of [undefined, 0, {}, []]) {
    assert.throws(
      () => normalizeD1NullableString(malformed, "diff", invalid),
      /D1_RESPONSE_INVALID:diff/,
    );
  }
});

test("D1 numeric writes and high-risk closures use structured evidence contracts", () => {
  assert.match(client, /numericValue/);
  assert.match(client, /expectedValue/);
  assert.match(client, /unit/);
  assert.match(client, /method.*evidenceRef/s);
  assert.match(client, /evidenceConfirmed/);
  assert.match(component, /kind: "number"/);
  assert.match(component, /CONFIRM_EXCEPTION/);
  assert.match(component, /evidenceRef/);
});

test("D1 renders actions from exact authorities and links anomaly evidence to K and D4", () => {
  assert.match(component, /finance_d1_channel_manage/);
  assert.match(component, /finance_d1_psp_switch/);
  assert.match(component, /finance_d1_reconcile/);
  assert.match(component, /finance_d1_chargeback_refund/);
  assert.match(component, /\/finance\/ledger/);
  assert.match(component, /\/risk\//);
  assert.match(component, /K1 反多账户中心/);
  assert.match(component, /历史账务证据尚未闭合/);
  assert.match(component, /仅代表当前可验证部分/);
  assert.match(component, /尚未确认/);
  assert.match(component, /尚未入账/);
  assert.match(component, /BIN段|IP|设备指纹/);
  assert.doesNotMatch(component, /\["CHARGEBACK_RECOVERED", "CHARGEBACK_PARTIAL", "CHARGEBACK_REFUNDED"\]/);
});

test("D1 presents lifecycle states as stable Chinese labels instead of internal enums or failure reasons", () => {
  assert.match(component, /function d1StatusText/);
  assert.match(component, /CHARGEBACK_RECOVERED: "拒付已追回"/);
  assert.match(component, /CHARGEBACK_PARTIAL: "拒付部分追回"/);
  assert.match(component, /CHARGEBACK_REVIEW: "拒付复核中"/);
  assert.match(component, /function d1EnteredStatusText/);
  assert.match(component, /"已入账": "已入账"/);
  assert.match(component, /"未找到入账分录": "未找到入账分录"/);
  assert.doesNotMatch(component, />\{row\.status\}<\/span>/);
});
