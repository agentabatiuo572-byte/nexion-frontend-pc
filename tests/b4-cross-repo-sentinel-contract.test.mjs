import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const feature = readFileSync(
  new URL("../scripts/feature-mapping-walkthrough-proof.mjs", import.meta.url),
  "utf8",
);
const persona = readFileSync(
  new URL("../scripts/uniapp-persona-walkthrough-proof.mjs", import.meta.url),
  "utf8",
);
const coverage = readFileSync(
  new URL("../scripts/fe-be-mapping-coverage.mjs", import.meta.url),
  "utf8",
);
const storage = readFileSync(
  new URL("../scripts/uni-storage-key-sentinel.mjs", import.meta.url),
  "utf8",
);

test("B4 walkthrough follows the current TRC20 selector and read-only withdrawal address", () => {
  assert.match(feature, /\.nx-dep-net-trc20/);
  assert.match(feature, /Send via TRC20/);
  assert.match(persona, /const PAIRED_ADDRESS/);
  assert.match(persona, /nx-withdraw-rebind-entry/);
  assert.match(persona, /addressInputGone/);
  assert.match(persona, /wallet-address-rebind/);
  assert.match(persona, /clickSelector\("\.nx-withdraw-rebind-entry"\)/);
  assert.doesNotMatch(persona, /fill\("\.nx-withdraw-address-input/);
  assert.match(feature, /nexgrid-locale-v1'[\s\S]*code: 'en'/);
  assert.match(persona, /nexgrid-locale-v1'[\s\S]*code: 'en'/);
});

test("B4 mapping coverage locks previously open M9/M10 closed and uses declared checkouts", () => {
  assert.match(coverage, /HISTORICAL_OPEN_BASELINE = new Set\(\["M9", "M10"\]\)/);
  assert.match(coverage, /LOCKED_CLOSED = new Set\(\["M9", "M10"\]\)/);
  assert.match(coverage, /row\.status === "✅"/);
  assert.match(coverage, /resolveNexionAppRoot/);
  assert.match(coverage, /resolveNexionBackendRoot/);
  assert.doesNotMatch(coverage, /Nexion-uniapp/);
  assert.doesNotMatch(coverage, /PLAN_ROOT/);
});

test("storage-key gate understands both brands and resolves the declared NX1.0 checkout", () => {
  assert.match(storage, /\(\?:nexion\|nexgrid\)/);
  assert.match(storage, /resolveNexionAppRoot/);
  assert.match(storage, /walkFiles\(SCRIPTS\)/);
  assert.match(storage, /contextualKeyMatches/);
});
