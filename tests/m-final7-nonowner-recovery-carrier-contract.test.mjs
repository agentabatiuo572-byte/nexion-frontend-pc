import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./e2e/m-domain-nonowner-l-read-failclosed-20260729.spec.ts", import.meta.url),
  "utf8",
);

test("M5 read recovery restores data without granting write authority to the M-only non-owner actor", () => {
  const recovery = source.match(/async function readOutcomeUnknownAndRecover[\s\S]*?async function login/)?.[0] ?? "";
  const businessGate = source.match(/test\("M-only reviewer[\s\S]*?type Fault/)?.[0] ?? "";

  assert.match(recovery, /M5-read-result-unknown-recovered/);
  assert.match(recovery, /session-script-new[\s\S]*?toHaveCount\(0\)[\s\S]*?M5-read-result-unknown-fails-closed/);
  assert.match(recovery, /M5-read-result-unknown-fails-closed[\s\S]*?session-script-new[\s\S]*?toHaveCount\(0\)[\s\S]*?M5-read-result-unknown-recovered/);
  assert.doesNotMatch(recovery, /session-script-new[\s\S]*?toBe(?:Disabled|Enabled)\(\)/);

  assert.match(businessGate, /session-script-new[\s\S]*?toHaveCount\(0\)/);
  assert.match(businessGate, /page\.request\.patch\("\/api\/admin\/content\/session-templates\/categories\/advisor"/);
  assert.match(businessGate, /expect\(m5Denied\.status\(\)\)\.toBe\(403\)/);
  assert.match(businessGate, /expect\(advisorAfter\)\.toEqual\(advisor\)/);
});
