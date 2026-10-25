import assert from "node:assert/strict";
import test from "node:test";
import { deviceRankConfigError, parseDeviceRankConfig } from "../lib/admin/device-rank-config.ts";
import { h9DraftNumber } from "../lib/admin/h9-validation.ts";

const tier = { name: "基础设备", sharePct: 100, minTops: 0, maxTops: 1e9 };
test("default disabled, exact percentage and supported boundary configurations", () => {
  assert.deepEqual(parseDeviceRankConfig({ version: 0, enabled: false, tiers: [] }), { version: 0, enabled: false, tiers: [] });
  assert.equal(deviceRankConfigError(true, [tier]), "");
  assert.equal(deviceRankConfigError(false, [{ ...tier, minTops: 0.000001 }]), "");
  assert.equal(deviceRankConfigError(true, [{ ...tier, sharePct: 99.99 }, { ...tier, sharePct: 0.01 }]), "");
  assert.equal(deviceRankConfigError(true, [{ ...tier, sharePct: 0 }, tier]), "");
  assert.equal(deviceRankConfigError(true, Array.from({ length: 20 }, () => ({ ...tier, sharePct: 5 }))), "");
});

test("invalid drafts and contracts cannot become valid zero or silently rounded values", () => {
  for (const value of ["", " ", "NaN", "Infinity", "0x12"]) assert.equal(Number.isNaN(h9DraftNumber(value)), true);
  for (const tiers of [[], Array(21).fill(tier), [{ ...tier, name: " " }], [{ ...tier, name: "a".repeat(61) }],
    [{ ...tier, sharePct: 99 }], [{ ...tier, sharePct: 101 }], [{ ...tier, sharePct: 100.00000000001 }],
    [{ ...tier, minTops: -1 }], [{ ...tier, maxTops: 1e9 + 1 }], [{ ...tier, minTops: 10, maxTops: 9 }],
    [{ ...tier, minTops: 0.0000001 }], [{ ...tier, minTops: Number.NaN }], [{ ...tier, maxTops: Infinity }]]) {
    assert.notEqual(deviceRankConfigError(true, tiers), "", JSON.stringify(tiers));
  }
  assert.notEqual(deviceRankConfigError(false, [{ ...tier, sharePct: 90 }]), "");
  for (const raw of [null, {}, { version: -1, enabled: false, tiers: [] }, { version: 1, enabled: "false", tiers: [] },
    { version: 0, enabled: true, tiers: [] }, { version: 0, enabled: true, tiers: [{ ...tier, minTops: "0" }] }]) {
    assert.throws(() => parseDeviceRankConfig(raw));
  }
});
