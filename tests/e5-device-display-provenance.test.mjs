import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import {
  operatorDeviceIdentifier,
  operatorDeviceName,
  operatorRate,
} from "../lib/admin/e-operator-display.ts";
import { parseE5DeviceDailyRate } from "../lib/admin/e5-device-rate.ts";
import { parseE5DeviceIdentity } from "../lib/admin/e5-device-identity.ts";

// Keep the alias adapter scoped to this runtime test. Production code and the
// repository's normal node --test invocation retain their existing behavior.
register("./e5-client-test-loader.mjs", import.meta.url);
const { mapE5Device } = await import("../lib/admin/e5-client.ts");

const e5Ops = readFileSync(new URL("../app/components/domain-views/e-tabs/e5-ops.tsx", import.meta.url), "utf8");

test("E5 preserves server-issued PHONE and paired-compute identifiers while retaining fixture redaction", () => {
  const phone = `PHONE-${"A".repeat(48)}`;
  const paired = "PC-Executor_01:Tokyo.7";

  assert.equal(operatorDeviceIdentifier(phone), phone);
  assert.equal(operatorDeviceName("Mobile NPU · 28 TOPS", phone), "Mobile NPU · 28 TOPS");
  assert.equal(operatorDeviceIdentifier(paired), paired);
  assert.equal(operatorDeviceName("Compute Share · RTX 4090", paired), "Compute Share · RTX 4090");
  assert.equal(operatorDeviceIdentifier("TRIAL-DEV-001"), "本地验收夹具");
  assert.equal(operatorDeviceIdentifier("PC-<script>"), "设备编号待核验");
});

test("E5 renders authoritative daily snapshots with units instead of catalog copy", () => {
  assert.equal(operatorRate(18, 90), "18 USDT/日 · 90 NEX/日");
  assert.equal(operatorRate(0.19, null), "0.19 USDT/日");
  assert.equal(operatorRate(null, null), "收益待核验");
});

test("E5 keeps missing, invalid, and negative daily snapshots unknown while preserving legal zero", () => {
  assert.deepEqual(parseE5DeviceDailyRate(null, undefined), { dailyUsdt: null, dailyNex: null });
  assert.deepEqual(parseE5DeviceDailyRate("NaN", -1), { dailyUsdt: null, dailyNex: null });
  assert.deepEqual(parseE5DeviceDailyRate(0, "0"), { dailyUsdt: 0, dailyNex: 0 });
});

test("E5 maps the actual device snapshot over catalog baseRate and wires it to the rendered rate", () => {
  const mapped = mapE5Device({
    id: 822,
    userId: 7,
    instanceNo: `NEX-ORD-${"A".repeat(24)}`,
    name: "NexionBox Pro v2",
    status: "ACTIVE",
    baseRate: "$14.00/d · 90 NEX",
    dailyUsdt: "18",
    dailyNex: "90",
  });

  assert.equal(mapped.dailyUsdt, 18);
  assert.equal(mapped.dailyNex, 90);
  assert.equal(operatorRate(mapped.dailyUsdt, mapped.dailyNex), "18 USDT/日 · 90 NEX/日");
  assert.match(e5Ops, /operatorRate\(d\.dailyUsdt, d\.dailyNex\)/);
  assert.doesNotMatch(e5Ops, /operatorRate\(d\.baseRate\)/);
});

test("E5 uses a fallback only as a local row key and never invents a server device identity", () => {
  assert.deepEqual(parseE5DeviceIdentity(null, undefined, 91), {
    id: "device-91",
    serial: "",
    deviceName: "",
  });
});
