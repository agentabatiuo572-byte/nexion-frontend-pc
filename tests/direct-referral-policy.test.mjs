import assert from "node:assert/strict";
import test from "node:test";
import { parseDirectReferralPolicy, validateDirectReferralUpdate, directReferralAmplifies } from "../lib/admin/direct-referral-policy.ts";

const rule = (patch = {}) => ({ enabled: true, totalRatePct: 10, usdtSharePct: 60, coolingDays: 30, ...patch });
const update = (patch = {}) => ({ expectedVersion: 2, purchase: rule(), deviceEarning: rule({ totalRatePct: 5 }), ...patch });
const policy = () => ({ source: "server", serverCanonical: true, sourceEnvironment: "PRODUCTION", runId: "", configured: true, policyVersion: 2, effectiveAt: "2026-10-01T00:00:00Z", nexUsdtPrice: 0.01, purchase: rule(), deviceEarning: rule({ totalRatePct: 5 }) });

test("policy parser accepts the canonical disabled placeholder without inventing a rate or price", () => {
  const disabled = rule({ enabled: false, totalRatePct: 0, usdtSharePct: 50, coolingDays: 0 });
  const result = parseDirectReferralPolicy({ ...policy(), configured: false, policyVersion: 0, effectiveAt: null, nexUsdtPrice: null, purchase: disabled, deviceEarning: disabled });
  assert.equal(result.configured, false);
  assert.equal(result.nexUsdtPrice, null);
  assert.equal(result.purchase.enabled, false);
  for (const mutate of [p => { delete p.deviceEarning; }, p => { p.serverCanonical = false; }, p => { p.purchase.totalRatePct = "garbage"; }, p => { p.policyVersion = 0.5; }, p => { p.nexUsdtPrice = 0; }, p => { p.effectiveAt = "invalid"; }]) {
    const p = policy(); mutate(p); assert.throws(() => parseDirectReferralPolicy(p));
  }
});

test("whole policy validation rejects malformed money, split, cooling and CAS values", () => {
  assert.equal(validateDirectReferralUpdate(update()), null);
  for (const patch of [
    { expectedVersion: -1 },
    { purchase: rule({ totalRatePct: NaN }) }, { purchase: rule({ totalRatePct: 101 }) },
    { purchase: rule({ totalRatePct: 0 }) }, { purchase: rule({ usdtSharePct: 0 }) },
    { purchase: rule({ usdtSharePct: 100 }) }, { deviceEarning: rule({ coolingDays: 366 }) },
    { deviceEarning: rule({ coolingDays: 0.5 }) },
  ]) assert.ok(validateDirectReferralUpdate(update(patch)), JSON.stringify(patch));
  assert.equal(validateDirectReferralUpdate(update({ purchase: rule({ enabled: false, totalRatePct: 0, usdtSharePct: 0, coolingDays: 365 }) })), null);
});

test("B1 direction compares both currencies, enablement and cooling, and permits contraction", () => {
  const before = policy();
  assert.equal(directReferralAmplifies(before, update()), false);
  assert.equal(directReferralAmplifies(before, update({ purchase: rule({ totalRatePct: 9 }) })), false);
  assert.equal(directReferralAmplifies(before, update({ purchase: rule({ enabled: false, coolingDays: 0 }) })), false);
  assert.equal(directReferralAmplifies(before, update({ purchase: rule({ usdtSharePct: 70 }) })), true);
  assert.equal(directReferralAmplifies(before, update({ purchase: rule({ usdtSharePct: 50 }) })), true);
  assert.equal(directReferralAmplifies(before, update({ purchase: rule({ coolingDays: 29 }) })), true);
  assert.equal(directReferralAmplifies({ ...before, purchase: rule({ enabled: false }) }, update()), true);
});
