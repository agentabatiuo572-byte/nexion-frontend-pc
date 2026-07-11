// FEAT-DEV01/02 real-interface gate: capacity schedule + trade-in ladder.
// The rhythm branch originally compared two mock copies. Main has no mock backend,
// so this gate verifies that every page key is wired through the real E3 client.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const errors = [];

const lifecycle = read("app/components/domain-views/e-tabs/e3-lifecycle.tsx");
const manual = read("app/components/domain-views/e-tabs/e3-manual.tsx");
const client = read("lib/admin/e3-client.ts");

const requiredKeys = [
  "E.device.capacity.band1DeltaPct",
  "E.device.capacity.band2DeltaPct",
  "E.device.capacity.band3DeltaPct",
  "E.device.capacity.floorPct",
  "E.device.capacity.subsidyDays",
  "E.device.capacity.applyTo.phone",
  "E.device.capacity.applyTo.cloud-share",
  "E.device.capacity.applyTo.pc-gpu",
  "E.device.capacity.applyTo.stellarbox-s1",
  "E.device.capacity.applyTo.stellarbox-pro",
  "E.device.capacity.applyTo.stellarbox-pro-v2",
  "E.device.capacity.applyTo.stellarrack-p1",
  "E.device.capacity.applyTo.stellarrack-p2",
  "E.tradein.enabled",
  "E.tradein.ladder.cut1",
  "E.tradein.ladder.cut2",
  "E.tradein.ladder.cut3",
  "E.tradein.ladder.cut4",
  "E.tradein.ladder.credit1",
  "E.tradein.ladder.credit2",
  "E.tradein.ladder.credit3",
  "E.tradein.ladder.credit4",
  "E.tradein.ladder.credit5",
  "E.tradein.requireHigherPrice",
  "E.tradein.maxDevicesPerOrder",
];

const dynamicApplyToKeys = requiredKeys.filter((key) => key.startsWith("E.device.capacity.applyTo."));

for (const key of requiredKeys) {
  if (!client.includes("\"" + key + "\"")) errors.push("e3-client real API mapping missing: " + key);
  if (!dynamicApplyToKeys.includes(key) && !lifecycle.includes(key) && !manual.includes(key)) {
    errors.push("E3 page consumer missing: " + key);
  }
}

if (!lifecycle.includes("E.device.capacity.applyTo.${s.kind}")) {
  errors.push("E3 dynamic apply-to consumer missing");
}
for (const key of dynamicApplyToKeys) {
  const skuKind = key.slice("E.device.capacity.applyTo.".length);
  if (!lifecycle.includes(`kind: "${skuKind}"`)) errors.push("E3 apply-to SKU missing: " + skuKind);
}

const retiredKeys = [
  "E.device.degradeEarly",
  "E.device.degradeMid",
  "E.device.degradeLate",
  "E.device.minEfficiency",
  "E.tradein.salvagePct",
  "E.tradein.minHoldingMonths",
];
for (const key of retiredKeys) {
  if (lifecycle.includes(key) || manual.includes(key)) errors.push("retired E3 page key remains: " + key);
}

for (const proof of ["任务产能节奏", "升级置换阶梯", "参与任务递减"]) {
  if (!lifecycle.includes(proof)) errors.push("rhythm page proof missing: " + proof);
}

if (errors.length) {
  errors.forEach((error) => console.error("  ✗ " + error));
  process.exit(1);
}
console.log("capacity+ladder real-interface gate: " + requiredKeys.length + " keys mapped · rhythm UI present · retired mock keys 0");
