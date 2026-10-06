import assert from "node:assert/strict";
import test from "node:test";
import { parseDirectReferralPolicy, validateDirectReferralUpdate, directReferralAmplifies, directReferralSummary } from "../lib/admin/direct-referral-policy.ts";

const rule = (patch = {}) => ({ enabled: true, totalRatePct: 5, usdtSharePct: 60, coolingDays: 30, ...patch });
const split = (patch = {}) => ({ enabled: true, usdtSharePct: 60, ...patch });
const update = (patch = {}) => ({ schemaVersion: 2, expectedVersion: 2, expectedSevenLayerRevision: 7, purchaseSplit: split(), deviceEarning: rule(), ...patch });
const policy = () => ({ schemaVersion: 2, policySchemaVersion: 2, purchaseSplitConfigured: true, settlementMode: "SEVEN_V2", sevenLayerEnabled: true, cutoverAt: "2026-10-01T00:00:00Z", source: "server", serverCanonical: true, sourceEnvironment: "PRODUCTION", runId: "", configured: true, policyVersion: 2, sevenLayerRevision: 7, effectiveAt: "2026-10-01T00:00:00Z", nexUsdtPrice: 0.01, purchaseSplit: split(), deviceEarning: rule(), sevenLayerReference: { revision: 7, baseRatePct: 10, coolingDays: 30, legacyNexPerUsd: 2 } });

test("approval summary exposes changed stored shares even while split is disabled", () => {
  const before = directReferralSummary({ ...policy(), purchaseSplit: split({ enabled: false, usdtSharePct: 50 }) });
  const after = directReferralSummary(update({ purchaseSplit: split({ enabled: false, usdtSharePct: 61 }) }));
  assert.match(before, /保存的拆分 USDT 50% \/ NEX 50%，停用期间不生效/);
  assert.match(after, /保存的拆分 USDT 61% \/ NEX 39%，停用期间不生效/);
  assert.match(directReferralSummary({ ...policy(), purchaseSplitConfigured: false }), /当前占位.*尚未生效/);
});

test("v2 parser accepts both cutover states and actual unconfigured references without inventing a budget", () => {
  const disabled = rule({ enabled: false, totalRatePct: 0, usdtSharePct: 50, coolingDays: 0 });
  const result = parseDirectReferralPolicy({ ...policy(), configured: false, policyVersion: 0, effectiveAt: null, nexUsdtPrice: null, purchaseSplit: split({ enabled: false, usdtSharePct: 50 }), deviceEarning: disabled, sevenLayerReference: { revision: 7, baseRatePct: null, coolingDays: null, legacyNexPerUsd: null } });
  assert.equal(result.configured, false);
  assert.equal(result.nexUsdtPrice, null);
  assert.equal(result.sevenLayerReference.baseRatePct, null);
  assert.equal(parseDirectReferralPolicy({ ...policy(), settlementMode: "DIRECT_ONLY_V1", sevenLayerEnabled: false, cutoverAt: null }).sevenLayerEnabled, false);
  for (const mutate of [p => { delete p.deviceEarning; }, p => { p.serverCanonical = false; }, p => { p.purchaseSplit.totalRatePct = 10; }, p => { p.purchase = rule(); }, p => { p.schemaVersion = 1; }, p => { p.policyVersion = 0.5; }, p => { p.nexUsdtPrice = 0; }, p => { p.effectiveAt = "invalid"; }, p => { p.sevenLayerReference.revision = 8; }, p => { p.sevenLayerReference.baseRatePct = 11; }, p => { p.sevenLayerEnabled = false; }]) {
    const p = policy(); mutate(p); assert.throws(() => parseDirectReferralPolicy(p));
  }
});

test("v2 update has one purchase budget authority and binds policy plus seven-layer versions", () => {
  assert.equal(validateDirectReferralUpdate(update()), null);
  for (const patch of [
    { schemaVersion: 1 }, { expectedVersion: -1 }, { expectedSevenLayerRevision: -1 }, { expectedSevenLayerRevision: 0.5 }, { purchase: rule() },
    { purchaseSplit: split({ totalRatePct: 10 }) }, { purchaseSplit: split({ coolingDays: 30 }) }, { purchaseSplit: split({ usdtSharePct: NaN }) },
    { purchaseSplit: split({ usdtSharePct: 0 }) }, { purchaseSplit: split({ usdtSharePct: 100 }) }, { deviceEarning: rule({ totalRatePct: 0 }) }, { deviceEarning: rule({ coolingDays: 366 }) },
    { deviceEarning: rule({ coolingDays: 0.5 }) },
  ]) assert.ok(validateDirectReferralUpdate(update(patch)), JSON.stringify(patch));
  assert.equal(validateDirectReferralUpdate(update({ purchaseSplit: split({ enabled: false, usdtSharePct: 0 }) })), null);
});

test("a v1 effective policy retains device rules and its old purchase projection without turning the placeholder into a configured split", () => {
  const legacy = { ...policy(), policySchemaVersion: 1, purchaseSplitConfigured: false, settlementMode: "DIRECT_ONLY_V1", sevenLayerEnabled: false, cutoverAt: null, purchase: rule({ totalRatePct: 8, usdtSharePct: 70 }), purchaseSplit: split({ enabled: false, usdtSharePct: 50 }) };
  const parsed = parseDirectReferralPolicy(legacy);
  assert.equal(parsed.purchaseSplitConfigured, false);
  assert.equal(parsed.deviceEarning.enabled, true);
  assert.equal(parsed.legacyPurchase.totalRatePct, 8);
  assert.equal(directReferralAmplifies(parsed, update()), true, "compare against original L1 full cash + old extra NEX, not legacy direct-policy share");
  assert.throws(() => parseDirectReferralPolicy({ ...legacy, purchaseSplit: split() }));
  assert.throws(() => parseDirectReferralPolicy({ ...legacy, policySchemaVersion: "1" }));
});

test("B1 checks both currencies and treats closing the L1 split as restoration of full cash and old extra NEX", () => {
  const before = policy();
  assert.equal(directReferralAmplifies(before, update()), false);
  assert.equal(directReferralAmplifies(before, update({ deviceEarning: rule({ totalRatePct: 4 }) })), false);
  assert.equal(directReferralAmplifies(before, update({ deviceEarning: rule({ enabled: false, coolingDays: 0 }) })), false);
  assert.equal(directReferralAmplifies(before, update({ purchaseSplit: split({ enabled: false }) })), true);
  assert.equal(directReferralAmplifies(before, update({ purchaseSplit: split({ usdtSharePct: 70 }) })), true);
  assert.equal(directReferralAmplifies(before, update({ purchaseSplit: split({ usdtSharePct: 50 }) })), true);
  assert.equal(directReferralAmplifies(before, update({ deviceEarning: rule({ coolingDays: 29 }) })), true);
  assert.equal(directReferralAmplifies({ ...before, purchaseSplit: split({ enabled: false }) }, update()), true, "enabling adds split NEX beyond the legacy coefficient");
  assert.equal(directReferralAmplifies({ ...before, nexUsdtPrice: null }, update({ purchaseSplit: split({ enabled: false }) })), true, "unknown direction cannot bypass B1");
});
