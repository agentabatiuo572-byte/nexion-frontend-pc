import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as contract from "../lib/admin/purchase-payment-contract.ts";
import { outcomeStaysUnknown } from "../lib/admin/outcome-classification.ts";

const constraints = { ratePct: { min: '0', max: '100', scale: 2 }, feeUsdt: { min: '0', max: '1000000', scale: 2 }, minTopupPrincipal: { min: '1', max: '1000000000', integer: true } };
const channels = [
  { paymentMethod: "HDPAY_BANK", configured: true, channelFeeRatePct: "1.25", channelFeeFixed: "0.50", networkConfirmFeeUsdt: "0", minTopupPrincipal: "10" },
  { paymentMethod: "CREGIS_USDT_BSC", configured: true, channelFeeRatePct: "0", channelFeeFixed: "0.10", networkConfirmFeeUsdt: "0.20", minTopupPrincipal: "1" },
];
const policy = { version: 2, channels, constraints };
const record = { intentNo: "PP-1", userId: "12", kind: "ORDER_PAY", paymentMethod: "HDPAY_BANK", status: "MANUAL_REVIEW", subtotalUsdt: "0.50", channelFeeUsdt: "0.01", networkConfirmFeeUsdt: "0", totalUsdt: "0.51", feePolicyVersion: 2, version: 4, reason: "库存不足", createdAt: "2026-10-31T06:00:00Z", updatedAt: "2026-10-31T06:00:00Z" };

test("payment snapshots preserve raw principal, signed rounding and exact integer VND", () => {
  const snapshot = { ...record, businessAmountUsdt: "80.008000", roundingAdjustmentUsdt: "0.002000", amountVnd: "9007199254740993", fxRateVndPerUsdt: "25000.000000" };
  assert.equal(contract.parsePurchasePaymentRecord(snapshot).amountVnd, "9007199254740993");
  for (const patch of [{ businessAmountUsdt: 80.008 }, { businessAmountUsdt: "80.0080001" }, { roundingAdjustmentUsdt: "bad" }, { amountVnd: "12750.50" }, { fxRateVndPerUsdt: "0" }]) assert.throws(() => contract.parsePurchasePaymentRecord({ ...snapshot, ...patch }));
});
test("policy accepts decimals for fees while minimum principal stays a positive integer and HDPay has no network fee", () => {
  assert.deepEqual(contract.parsePurchasePaymentPolicy(policy), policy);
  assert.equal(contract.purchaseMoney("10"), "10.00");
  assert.equal(contract.purchaseMoney("0.5"), "0.50");
  for (const patch of [{ minTopupPrincipal: "0" }, { minTopupPrincipal: "1.5" }, { minTopupPrincipal: "1.00" }, { channelFeeRatePct: "100.01" }, { channelFeeRatePct: "-1" }, { channelFeeFixed: "0.001" }, { networkConfirmFeeUsdt: "1" }]) assert.equal(contract.validPurchaseChannel({ ...channels[0], ...patch }), false);
  for (const raw of [{ ...policy, version: null }, { ...policy, channels: [channels[0], channels[0]] }, { ...policy, channels: [null, channels[1]] }, { ...policy, channels: [] }]) assert.throws(() => contract.parsePurchasePaymentPolicy(raw));
  assert.equal(contract.validPurchaseChannel({ ...channels[0], channelFeeFixed: "1000000.01" }, constraints), false);
  assert.equal(contract.validPurchaseChannel({ ...channels[0], minTopupPrincipal: "1000000001" }, constraints), false);
  assert.throws(() => contract.parsePurchasePaymentPolicy({ ...policy, constraints: { ...constraints, feeUsdt: { min: "0", max: "1", scale: 6 } } }));
});
test("unconfigured channels retain null fees while explicit zero is a distinct configured policy", () => {
  const unset = { ...channels[0], configured: false, channelFeeRatePct: null, channelFeeFixed: null, networkConfirmFeeUsdt: null };
  assert.equal(contract.parsePurchasePaymentPolicy({ ...policy, channels: [unset, channels[1]] }).channels[0].configured, false);
  for (const patch of [{ configured: undefined }, { configured: true }, { channelFeeFixed: "0" }]) assert.throws(() => contract.parsePurchasePaymentPolicy({ ...policy, channels: [{ ...unset, ...patch }, channels[1]] }));
  const explicitZero = { ...channels[0], channelFeeRatePct: "0", channelFeeFixed: "0", networkConfirmFeeUsdt: "0" };
  assert.equal(contract.parsePurchasePaymentPolicy({ ...policy, channels: [explicitZero, channels[1]] }).channels[0].configured, true);
});
test("record parsing rejects wrong identity, unknown states, absent authoritative fees and malformed pages", () => {
  assert.equal(contract.parsePurchasePaymentRecord(record, "PP-1").totalUsdt, "0.51");
  for (const patch of [{ status: "SUCCESS" }, { userId: null }, { totalUsdt: undefined }, { feePolicyVersion: null }, { version: -1 }]) assert.throws(() => contract.parsePurchasePaymentRecord({ ...record, ...patch }));
  assert.throws(() => contract.parsePurchasePaymentRecord(record, "PP-2"));
  assert.throws(() => contract.parsePurchasePaymentPage({ items: [record], pageNum: 1, pageSize: 20, total: 0 }));
});
test("original fulfilment and exact on-chain/provider evidence survive a later payment exception", () => {
  const delivered = contract.parsePurchasePaymentRecord({ ...record, fulfilmentStatus: "DELIVERED", receipt: { orderNo: "ORDER-1" }, providerActualFeeUsdt: "0.123456", arrivals: [{ txid: "0xproof", log_index: 2, amount: "0.000001", block_number: 1, block_hash: "0xblock", confirmations: 20, status: "CONFIRMED" }] });
  assert.equal(contract.purchaseWasDelivered(delivered), true); assert.equal(delivered.status, "MANUAL_REVIEW"); assert.equal(delivered.arrivals[0].amount, "0.000001");
  assert.throws(() => contract.parsePurchasePaymentRecord({ ...record, fulfilmentStatus: "UNKNOWN" }));
  assert.throws(() => contract.parsePurchasePaymentRecord({ ...record, arrivals: [{ txid: "0xproof", log_index: -1 }] }));
});

function clientFixture(responses, options = {}) {
  let rows = [], sequence = 0, authEpoch = 1;
  const calls = [];
  const session = { adminId: 12, role: "operator", authorities: options.authorities ?? ["finance_d1_fx_manage", "finance_d1_bank_reconcile"] };
  const dependencies = {
    "@/lib/admin/error-messages": { formatAdminApiError: (message, fallback) => message || fallback, guardedFetch: async (path, init) => { calls.push({ path, init }); const next = responses.shift(); if (next instanceof Error) throw next; if (next.changeEpoch) authEpoch++; return new Response(JSON.stringify(next.body), { status: next.status, headers: next.headers }); } },
    "@/lib/admin/auth-session": { isAdminAuthFailure: status => status === 401 },
    "@/lib/admin/auth-lifecycle": { adminAuthLifecycleEpoch: () => authEpoch, AdminAuthEpochChangedError: class extends Error {} },
    "@/lib/store/admin-auth": { useAdminAuth: { getState: () => ({ session, signOut() {} }) } },
    "@/lib/admin/outcome-classification": { outcomeStaysUnknown },
    "@/lib/admin/a2-client": { createA2CommandKey: () => `command-${++sequence}` },
    "@/lib/admin/pending-mutation-store": { createPendingMutationStore: () => ({ list: () => rows, remember: (fingerprint, commandKey, extra) => rows.push({ fingerprint, commandKey, createdAt: Date.now(), expiresAt: Date.now() + 86400000, ...extra }), isDurablyStored: () => options.durable !== false, forget: (fingerprint, commandKey) => { rows = rows.filter(row => row.fingerprint !== fingerprint || row.commandKey !== commandKey); } }) },
    "@/lib/admin/purchase-payment-contract": contract,
  };
  const source = readFileSync(new URL("../lib/admin/purchase-payment-client.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", code)(name => dependencies[name], module.exports, module);
  return { client: module.exports, calls, session };
}
test("unknown policy command persists exact key/body, blocks replacement, and same-key retry returns authoritative rules", async () => {
  const { client, calls } = clientFixture([{ status: 503, body: { code: 503 } }, { status: 200, body: { code: 0, data: policy } }]);
  await assert.rejects(client.updatePurchasePaymentPolicy(12, 1, channels, "依据核验后的渠道费用调整本次规则"));
  const original = client.pendingPurchasePayments(12)[0];
  assert.ok(original); assert.equal(client.pendingPurchasePayments(13).length, 0);
  await assert.rejects(client.updatePurchasePaymentPolicy(12, 1, channels, "不能换请求绕过原操作"));
  assert.equal(calls.length, 1);
  assert.deepEqual(await client.retryPurchasePayment(original), policy);
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(calls[0].init.headers["Idempotency-Key"], calls[1].init.headers["Idempotency-Key"]);
  assert.equal(JSON.parse(calls[0].init.body).expectedVersion, 1);
  assert.equal(client.pendingPurchasePayments(12).length, 0);
});
test("manual revalidation sends original intent/CAS/reason and never reports business delivery from pending state", async () => {
  const { client, calls } = clientFixture([{ status: 200, body: { code: 0, data: record } }]);
  const result = await client.revalidatePurchasePayment(12, "PP-1", 4, "已核对原支付商资金后申请重新核验");
  assert.equal(result.status, "MANUAL_REVIEW");
  assert.equal(calls[0].path, "/api/admin/finance/purchase-payment-records/PP-1/revalidate-deliver");
  assert.deepEqual(JSON.parse(calls[0].init.body), { expectedVersion: 4, reason: "已核对原支付商资金后申请重新核验" });
});
test("permission, owner, storage, identity change and retry expiry fail closed", async () => {
  for (const options of [{ durable: false }, { authorities: [] }]) {
    const { client, calls } = clientFixture([], options);
    await assert.rejects(client.updatePurchasePaymentPolicy(12, 1, channels, "依据核验后的渠道费用调整本次规则")); assert.equal(calls.length, 0);
  }
  const { client, calls, session } = clientFixture([{ status: 503, body: { code: 503 } }]);
  await assert.rejects(client.revalidatePurchasePayment(12, "PP-1", 4, "已核对原支付商资金后申请重新核验"));
  const original = client.pendingPurchasePayments(12)[0];
  await assert.rejects(client.retryPurchasePayment({ ...original, createdAt: Date.now() - 600001 }));
  session.adminId = 13; await assert.rejects(client.retryPurchasePayment(original)); assert.equal(calls.length, 1);
  const changed = clientFixture([{ status: 200, changeEpoch: true, body: { code: 0, data: policy } }]);
  await assert.rejects(changed.client.updatePurchasePaymentPolicy(12, 1, channels, "依据核验后的渠道费用调整本次规则"));
  assert.equal(changed.client.pendingPurchasePayments(12).length, 1);
});


test("ERC20 has its own initially unconfigured channel and preserves older two-channel responses", () => {
  const erc20 = { paymentMethod: "CREGIS_USDT_ERC20", configured: false, channelFeeRatePct: null, channelFeeFixed: null, networkConfirmFeeUsdt: null, minTopupPrincipal: "10" };
  assert.deepEqual(contract.parsePurchasePaymentPolicy({ ...policy, channels: [...channels, erc20] }).channels[2], erc20);
  assert.equal(contract.parsePurchasePaymentPolicy(policy).channels.length, 2);
  assert.throws(() => contract.parsePurchasePaymentPolicy({ ...policy, channels: [...channels, { ...erc20, configured: true }] }));
  assert.throws(() => contract.parsePurchasePaymentPolicy({ ...policy, channels: [...channels, channels[1]] }));
  assert.equal(contract.parsePurchasePaymentRecord({ ...record, paymentMethod: "CREGIS_USDT_ERC20" }).paymentMethod, "CREGIS_USDT_ERC20");
});
