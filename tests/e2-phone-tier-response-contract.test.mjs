import test from "node:test";
import assert from "node:assert/strict";

import { parseE2OnboardingYieldConfig } from "../lib/admin/e2-onboarding-yield-contract.ts";

const canonicalResponse = {
  tiers: [1, 2, 3, 4, 5].map((tier) => ({
    tier,
    name: `Tier ${tier}`,
    baseRateUsdt: (tier * 0.01).toFixed(6),
    baseRateNex: (tier * 2).toFixed(6),
    revision: 1,
    effectiveAt: "2026-08-16 19:07:53",
  })),
  comparisons: [{
    configKey: "phone",
    label: "手机",
    dailyUsdt: "0.060000",
    dailyNex: "10.000000",
    sortOrder: 1,
    revision: 1,
    updatedAt: "2026-08-16 19:07:53",
  }],
  configRevision: 1,
};

test("E2 PC maps canonical phone tier base rates to its daily-yield view model", () => {
  const parsed = parseE2OnboardingYieldConfig(canonicalResponse);

  assert.equal(parsed.tiers.length, 5);
  assert.equal(parsed.tiers[2].dailyUsdt, 0.03);
  assert.equal(parsed.tiers[2].dailyNex, 6);
  assert.equal(parsed.comparisons[0].dailyUsdt, 0.06);
  assert.equal(parsed.configRevision, 1);
});

test("E2 PC fails closed when one canonical phone tier omits a base rate", () => {
  const broken = structuredClone(canonicalResponse);
  delete broken.tiers[2].baseRateUsdt;

  assert.throws(
    () => parseE2OnboardingYieldConfig(broken),
    /E2_ONBOARDING_YIELD_PROTOCOL_INVALID/,
  );
});
