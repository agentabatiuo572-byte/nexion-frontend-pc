import assert from "node:assert/strict";
import test from "node:test";
import { fromPurchaseGate, toPurchaseGate } from "../lib/admin/e1-purchase-gate.ts";
import { EMPTY_SKU_FORM, formToGate, gateToType, validateGateForm } from "../app/components/domain-views/e-tabs/data.ts";

test("zero minimums do not become extra enabled conditions in form mappings", () => {
  const gate = { rankMin: 2, activeDirectMin: 0, teamComputePointsMin: 0, mode: "either", enforce: true };
  assert.equal(gateToType(gate), "rank");
  const value = fromPurchaseGate(gate);
  assert.deepEqual(toPurchaseGate(value), { ...gate, quotaCap: null, quotaSold: null, quotaPeriod: null });
  assert.equal(fromPurchaseGate({ ...gate, rankMin: 0 }), undefined);
  const nullable = fromPurchaseGate({ ...gate, activeDirectMin: null, teamComputePointsMin: null });
  assert.equal(nullable.activeDirectMin,0);
  assert.equal(nullable.teamComputePointsMin,0);
});
test("empty and zero forms mean no minimum; quota rules stay unchanged", () => {
  const form = { ...EMPTY_SKU_FORM, tier: "Share", gateType: "combo", gateMode: "either" };
  assert.equal(validateGateForm(form),null);
  assert.equal(formToGate(form),undefined);
  const gate = formToGate({ ...form, gateRankMin: "2" });
  assert.equal(gate.activeDirectMin,0);
  assert.equal(gate.teamComputePointsMin,0);
  assert.match(validateGateForm({ ...form, gateActiveDirectMin: "-1" }),/0/);
  assert.match(validateGateForm({ ...form, gateQuotaCap: "0" }),/大于 0/);
  const quota = formToGate({ ...form, gateQuotaCap: "2", gateQuotaSold: "2" });
  assert.equal(quota.quotaCap,2);
  assert.equal(quota.quotaSold,2);
  assert.equal(quota.rankMin,0);
});
