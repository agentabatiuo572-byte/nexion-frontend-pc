import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./e2e/k4-final7-owner-carrier.spec.ts", import.meta.url),
  "utf8",
);

test("K4 Final7 carrier is bound to one locked candidate and normal MFA actors", () => {
  for (const name of [
    "K4_FINAL7_RUN_ID", "K4_FINAL7_LOCK", "K4_FINAL7_BASE_URL",
    "K4_FINAL7_MFA_BYPASS", "K4_FINAL7_EVIDENCE_DIR", "K4_FINAL7_RESTRICTED_DIR",
    "K4_FINAL7_PUBLISHER_MANIFEST", "K4_FINAL7_MAKER_MANIFEST", "K4_FINAL7_CHECKER_MANIFEST",
    "K4_FINAL7_EXPECTED_BUILD_ID", "K4_FINAL7_BUILD_ID_PATH", "K4_FINAL7_CANDIDATE_JAR", "K4_FINAL7_EXPECTED_JAR_SHA256",
    "K4_FINAL7_DB_NAME", "K4_FINAL7_DB_PASSWORD", "K4_FINAL7_TARGET_USER_NO",
  ]) assert.match(source, new RegExp(`required\\(\\"${name}\\"\\)`), name);
  assert.match(source, /mfaBypass\)\.toBe\(\"false\"\)/);
  assert.match(source, /verifyCandidate\(/);
  assert.match(source, /readFileSync\(config\.buildIdPath/);
  assert.match(source, /buildId/);
  assert.match(source, /backendJarSha256/);
  assert.match(source, /new URL\(config\.baseUrl\)\.hostname/);
  assert.match(source, /K4_WRITE:\$\{config\.runId\}:\$\{config\.expectedBuildId\}:\$\{config\.expectedJarSha256\}/);
  assert.match(source, /K4_FINAL7_MANIFEST_RUN_REQUIRED/);
  assert.match(source, /K4_FINAL7_MANIFEST_CANDIDATE_MISMATCH/);
  assert.match(source, /\.restricted/);
});

test("K4 Final7 carrier uses visible login/sidebar and fails immediately on an MFA verify response", () => {
  assert.match(source, /input\[autocomplete=\"username\"\]/);
  assert.match(source, /once `verification` request/);
  assert.match(source, /\/api\/admin\/auth\/mfa\/verify/);
  assert.match(source, /MFA_VERIFY_FAILED status=\$\{response\.status\(\)\} code=\$\{payload\?\.code/);
  assert.match(source, /openK4FromVisibleSidebar/);
  assert.match(source, /nav-group-K/);
});

test("K4 Final7 carrier contains the complete write/consistency/cleanup closure", () => {
  for (const needle of [
    "saveDraftThroughVisibleUi", "publishDraftThroughVisibleUi", "concurrentOverrideCas",
    "assertIdempotencyReplay", "assertResultUnknown", "assertDatabaseAndEventEvidence",
    "restoreBaselineThroughVisibleUi", "recomputeUserThroughVisibleUi", "assertExactCleanup",
    "nx_admin_risk_score_model", "nx_admin_idempotency_record", "nx_audit_log", "nx_event_outbox",
  ]) assert.match(source, new RegExp(needle.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")), needle);
  assert.match(source, /finally[\s\S]*assertExactCleanup/);
  assert.match(source, /publisherPage\.reload/);
  assert.match(source, /route\.fetch\(\)/);
  assert.match(source, /X-Nexion-Upstream-Outcome/);
  assert.match(source, /DELETE FROM nx_admin_idempotency_record/);
  assert.match(source, /expect\(unexpectedBrowserFaults\(faults\)\)\.toEqual\(\[\]\)/);
  assert.doesNotMatch(source, /operations\s*=\s*\{\s*cas,\s*idempotency/);
  assert.match(source, /password|totpSecret|dbPassword/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^)]*(?:password|totpSecret|dbPassword)/i);
  assert.doesNotMatch(source, /Admin@[0-9]{6,}|A123456789Z/);
});

test("K4 Final7 carrier waits for durable cleanup and only exempts replaced navigation cancellations", () => {
  assert.match(source, /expect\.poll\(async \(\) => \(await scoreUser\(maker, userNo\)\)\.overridden/);
  assert.match(source, /successfulNavigationPaths/);
  assert.match(source, /cancelledNavigationPaths/);
  assert.match(source, /unexpectedBrowserFaults/);
  assert.match(source, /response\.status\(\) === 200/);
  assert.match(source, /failure\(\)\?\.errorText === "net::ERR_ABORTED"/);
  assert.match(source, /await loginWithNormalMfa\(checkerPage, checker\);[\s\S]*captureBrowserFaults/);
});

test("K4 cleanup compares semantic configuration, permits archived history, and preserves outbox evidence across async dispatch", () => {
  assert.match(source, /isDeepStrictEqual\(modelConfig\(left\), modelConfig\(right\)\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(modelConfig\(/);
  assert.match(source, /activeModels/);
  assert.match(source, /archivedHistory/);
  assert.match(source, /activeOverrides/);
  assert.match(source, /processingIdempotency/);
  assert.match(source, /operationMutex/);
  assert.match(source, /carrier never deletes audit\/outbox rows/i);
  assert.match(source, /observedOutboxRows/);
  assert.match(source, /terminalOutboxRows/);
});
