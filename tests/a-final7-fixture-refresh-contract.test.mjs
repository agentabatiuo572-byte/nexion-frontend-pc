import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./e2e/a-final7-fixture-refresh.spec.ts", import.meta.url),
  "utf8",
);

test("Final7 A/K4 fixture refresh is explicit, loopback-only, and secret-free", () => {
  for (const name of [
    "A_FIXTURE_REFRESH_TOKEN",
    "A_FINAL7_BASE_URL",
    "A_FINAL7_RUN_ID",
    "A_FINAL7_RESTRICTED_DIR",
    "A_FINAL7_CURRENT_MANIFEST",
    "A_FINAL7_DB_NAME",
    "A_FINAL7_FIXTURE_OPERATOR",
    "A_FINAL7_FIXTURE_OPERATOR_PASSWORD",
    "A_FINAL7_FIXTURE_DB_PASSWORD",
    "A_FINAL7_MFA_ENCRYPTION_KEY",
    "A_FINAL7_RESTRICTED_OWNER",
    "A_FINAL7_EXPECTED_BUILD_ID",
    "A_FINAL7_CANDIDATE_JAR",
    "A_FINAL7_EXPECTED_JAR_SHA256",
  ]) assert.match(source, new RegExp(`required\\("${name}"\\)`), name);
  assert.match(source, /fixture refresh only permits a loopback admin endpoint/);
  assert.match(source, /test\.use\(\{ trace: "off", video: "off", screenshot: "off" \}\)/);
  assert.match(source, /icacls\.exe/);
  assert.match(source, /\/inheritance:r/);
  assert.match(source, /RESTRICTED_OWNER_UNSAFE/);
  assert.match(source, /ACL_PRINCIPAL_OUTSIDE_ALLOWLIST/);
  assert.doesNotMatch(source, /Admin@[0-9]{6,}|A123456789Z/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn)\([^)]*(?:password|totp|secret|dbPassword)/i);
});

test("Final6 mismatch diagnosis and Final7 manifests expose only bounded fixture metadata", () => {
  assert.match(source, /manifestSecretMatchesDatabase/);
  assert.match(source, /normalLoginGate/);
  assert.match(source, /visibleModules: \["A1", "A6", "A7"\]/);
  assert.match(source, /ffix\.a\.final7\.m\./);
  assert.match(source, /ffix\.a\.final7\.c\./);
  assert.match(source, /ffix\.a\.final7\.x\./);
  assert.match(source, /ffix\.k4\.final7\.p\./);
  assert.match(source, /final7-a-fixture-manifest\.json/);
  assert.match(source, /final7-k4-publisher-manifest\.json/);
  assert.match(source, /safe-summary\.json/);
  assert.doesNotMatch(source, /safeSummary[\s\S]{0,400}(?:password|totpSecret|dbPassword)/);
});

test("refresh fails closed and cleans every actor created by a failed run", () => {
  assert.match(source, /createdActorIds/);
  assert.match(source, /catch \(error\)[\s\S]*cleanupCreatedActors/);
  assert.match(source, /catch \(error\)[\s\S]*cleanupSensitiveOutputs/);
  assert.match(source, /unlinkSync\(file\)/);
  assert.match(source, /DELETE FROM nx_admin_role_relation WHERE admin_id=/);
  assert.match(source, /ADMIN_MFA_NOT_BOUND/);
  assert.match(source, /unexpected reset-2fa conflict/);
  assert.match(source, /cleanupPlan/);
  assert.match(source, /K4 publisher fixture only; no K-domain business endpoint is called/);
});
