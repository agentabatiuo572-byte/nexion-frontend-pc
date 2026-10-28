import assert from "node:assert/strict";
import { test } from "node:test";
import { depositPolicyUnits, parseDepositPolicy, validDepositPolicy } from "../lib/admin/cregis-deposit-policy.ts";

test("Cregis policy preserves exact decimals and enforces safety limits", () => {
  assert.deepEqual(parseDepositPolicy({ minDepositUsdt: "1.000000", feeUsdt: "0.000000", confirmations: 15, version: 0 }),
    { minDepositUsdt: "1.000000", feeUsdt: "0.000000", confirmations: 15, version: 0 });
  assert.equal(depositPolicyUnits("999999999999.999999") - depositPolicyUnits("999999999999.999998"), BigInt(1));
  for (const [min, fee, confirmations] of [["0", "0", 15], ["1", "1", 15], ["1", "0.0000001", 15], ["1", "0", 14], ["1", "0", 10001], ["1", "0", 15.5]]) {
    assert.equal(validDepositPolicy(min, fee, confirmations), false);
  }
  assert.throws(() => parseDepositPolicy({ minDepositUsdt: 1, feeUsdt: 0, confirmations: 15, version: 0 }));
});
