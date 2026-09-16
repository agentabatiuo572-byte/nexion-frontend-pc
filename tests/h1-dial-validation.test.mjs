import test from "node:test";
import assert from "node:assert/strict";
import { validateH1DialValue } from "../lib/admin/h1-dial-validation.ts";

test("review days accepts explicit zero and integer bounds", () => {
  for (const value of [0, "0", 1, "30", 90, "90"]) {
    assert.doesNotThrow(() => validateH1DialValue("withdrawCooldownDays", value));
  }
});

test("review days rejects negative, fractional, missing and out-of-range input", () => {
  for (const value of [-1, "-0.5", 0.5, "", " ", "no", 91, NaN, Infinity]) {
    assert.throws(() => validateH1DialValue("withdrawCooldownDays", value), /0–90/);
  }
});

test("other H1 dials keep their own validation rules", () => {
  assert.doesNotThrow(() => validateH1DialValue("inviteRewardMultiplier", "1.5"));
  assert.doesNotThrow(() => validateH1DialValue("complianceHoldEnabled", "是"));
});
