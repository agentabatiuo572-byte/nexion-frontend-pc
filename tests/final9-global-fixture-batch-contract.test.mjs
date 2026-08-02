import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const carrierPath = new URL("./e2e/a-final7-domain-permission-refresh.spec.ts", import.meta.url);
const source = await readFile(carrierPath, "utf8");
const start = source.indexOf('test("Final10 global fixture batch');
const end = source.indexOf("\nfunction role(", start);
assert.ok(start > 0 && end > start, "Final10 global fixture batch carrier must exist");
const carrier = source.slice(start, end);

test("Final10-ready batch is token-gated and writes four atomic restricted manifests only after validation", () => {
  assert.match(source, /expectedGlobalFixtureBatchToken = `\$\{runId\}:FINAL10:B-F-H-M:VISIBLE-A1-A6-A2:/);
  assert.match(carrier, /GLOBAL_FIXTURE_BATCH_FINAL10_LOCK/);
  assert.match(carrier, /verifyFinal10RuntimeLock\(\)/);
  assert.match(carrier, /GLOBAL_FIXTURE_BATCH_LOCK token is required/);
  for (const output of ["B_FINAL9_MANIFEST", "F_FINAL9_MANIFEST", "H_FINAL9_MANIFEST", "M_FINAL9_MANIFEST"]) {
    assert.match(carrier, new RegExp(`writeRestrictedJson\\(${output}`));
  }
  assert.match(source, /renameSync\(temporary, file\)/);
  assert.match(source, /restrictFileAcl\(file\)/);
  assert.match(carrier, /oldObjectsModified: 0, globalConfigWrites: 0/);
  assert.doesNotMatch(carrier, /writeRestrictedJson\(I_MANIFEST/);
});

test("six new least-privilege roles and seven new normal-MFA actors are explicit", () => {
  for (const role of [
    "B_FINAL9_MAKER_ROLE", "B_FINAL9_SECOND_ROLE", "F1_FINAL9_CHECKER_ROLE",
    "F25_FINAL9_CHECKER_ROLE", "H3_FINAL9_SECOND_ROLE", "H8_FINAL9_CHECKER_ROLE",
  ]) assert.match(carrier, new RegExp(role));
  assert.match(source, /function final9Role[\s\S]*ACC_F10_/);
  assert.match(carrier, /accountsCreated: 7/);
  assert.match(carrier, /normalMfaActors: 7/);
  assert.match(carrier, /provisionFinal9SupportAccount\(page, browser\)/);
  assert.match(carrier, /assignFinal9SupportSupervisorVisible\(page, mSupportSupervisor\.accountId\)/);
});

test("maker-checker, refresh-relogin and fail-closed probes are mandatory", () => {
  assert.match(carrier, /assertSelfApprovalDeniedFinal9\(page, operationId\)/);
  assert.match(carrier, /approveVisibleA2\(reviewerPage, operationId\)/);
  assert.match(source, /A2_MAKER_CHECKER_REQUIRED/);
  assert.match(source, /out-of-scope direct write must fail before validation/);
  assert.match(source, /refreshStable: true, reloginStable: true/);
  assert.match(carrier, /activeTicketLocks\(operationId\)/);
});

test("checker decision permissions remain narrow and documented", () => {
  assert.match(source, /F1_FINAL9_CHECKER_MENUS = \["A2", "F1"\]/);
  assert.match(source, /F25_FINAL9_CHECKER_MENUS = \["A2", "F2", "F3", "F4", "F5"\]/);
  assert.match(source, /H8_FINAL9_CHECKER_MENUS = \["A2", "H8"\]/);
  assert.match(source, /network_f1_write is required by delegated F1 A2 execution/);
  assert.match(source, /growth_h8_settle is required by delegated H8 A2 execution/);
});
