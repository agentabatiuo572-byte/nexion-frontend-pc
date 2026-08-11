import assert from "node:assert/strict";
import test from "node:test";

import { normalizePayoutVndConfig } from "../lib/admin/payout-vnd-contract.ts";
import { formatAdminApiError } from "../lib/admin/error-messages.ts";

function fixture() {
  return {
    version: 4,
    baseRateVndPerUsdt: 26000,
    buySpreadPct: 1.5,
    sellSpreadPct: 1.5,
    quoteTtlMinWithdraw: 10,
    requoteTolerancePct: 2,
    feeRatePct: 1,
    feeMinUsd: 1,
    feeMaxUsd: 25,
    minAmountUsd: 20,
    maxAmountUsd: 5000,
    channelEnabled: false,
    providerReady: false,
    providerStatusAvailable: true,
    sandboxAvailable: false,
    defaults: {
      sellSpreadPct: 1.5,
      quoteTtlMinWithdraw: 10,
      requoteTolerancePct: 2,
      feeRatePct: 1,
      feeMinUsd: 1,
      feeMaxUsd: 25,
      minAmountUsd: 20,
      maxAmountUsd: 5000,
    },
    effectiveAt: "2026-08-08T08:00:00Z",
    lastUpdatedBy: "superadmin",
    sources: { baseRateVndPerUsdt: "D6", buySpreadPct: "D6", d7: "platform-config" },
  };
}

test("D7 accepts one internally consistent authoritative server snapshot", () => {
  const result = normalizePayoutVndConfig(fixture());
  assert.equal(result.version, 4);
  assert.equal(result.providerReady, false);
  assert.equal(result.providerStatusAvailable, true);
  assert.equal(result.baseRateVndPerUsdt, 26000);
});

test("D7 rejects type coercion, impossible limits and forged source ownership", () => {
  for (const mutate of [
    (value) => { value.version = true; },
    (value) => { value.channelEnabled = "false"; },
    (value) => { value.feeMinUsd = 30; value.minAmountUsd = 20; },
    (value) => { value.sources.baseRateVndPerUsdt = "D7"; },
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => normalizePayoutVndConfig(value), /D7_RESPONSE_INVALID/);
  }
});

test("D7 still renders an enabled channel during provider outage so the stop-loss action stays reachable", () => {
  const outage = fixture();
  outage.channelEnabled = true;
  outage.providerReady = false;
  outage.providerStatusAvailable = false;
  assert.equal(normalizePayoutVndConfig(outage).channelEnabled, true);
});

test("D7 rejects a ready provider whose readiness source is unavailable", () => {
  const impossible = fixture();
  impossible.providerReady = true;
  impossible.providerStatusAvailable = false;
  assert.throws(() => normalizePayoutVndConfig(impossible), /D7_RESPONSE_INVALID/);
});

test("D7 rejects missing fields and invalid timestamps instead of rendering fallback values", () => {
  const missing = fixture();
  delete missing.sellSpreadPct;
  assert.throws(() => normalizePayoutVndConfig(missing), /D7_RESPONSE_INVALID/);
  const badTime = fixture();
  badTime.effectiveAt = "2026-99-99";
  assert.throws(() => normalizePayoutVndConfig(badTime), /D7_RESPONSE_INVALID/);
});

test("D7 malformed server responses are translated before they reach an operator", () => {
  const rendered = formatAdminApiError("D7_RESPONSE_INVALID:root.sellSpreadPct", "D7_RESPONSE_INVALID");
  assert.match(rendered, /服务端返回的参数不完整|停止展示推测值/);
  assert.doesNotMatch(rendered, /D7_RESPONSE_INVALID|sellSpreadPct/);
});
