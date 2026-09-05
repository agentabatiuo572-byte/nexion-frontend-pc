import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./e2e/a-final7-k3-k4-wrapper.spec.ts", import.meta.url),
  "utf8",
);

test("Final7 K3/K4 wrappers lock one live candidate and controller tokens", () => {
  for (const name of [
    "A_FINAL7_K_WRAPPER_TOKEN",
    "A_FINAL7_K_BASE_URL",
    "A_FINAL7_K_RUN_ID",
    "A_FINAL7_K_RESTRICTED_DIR",
    "A_FINAL7_K_SOURCE_A_MANIFEST",
    "A_FINAL7_K_SOURCE_PUBLISHER_MANIFEST",
    "A_FINAL7_K_EXPECTED_BUILD_ID",
    "A_FINAL7_K_CANDIDATE_JAR",
    "A_FINAL7_K_EXPECTED_JAR_SHA256",
    "A_FINAL7_K_EXPECTED_PC_PID",
    "A_FINAL7_K_EXPECTED_BACKEND_PID",
    "A_FINAL7_K_EXPECTED_PC_PORT",
    "A_FINAL7_K_EXPECTED_BACKEND_PORT",
    "A_FINAL7_K_MFA_BYPASS",
    "A_FINAL7_K_RESTRICTED_OWNER",
  ]) assert.match(source, new RegExp(`required\\("${name}"\\)`), name);
  assert.match(source, /GLOBAL_J1\+B1:\$\{runId\}:\$\{expectedBuildId\}:\$\{expectedJarSha256\}/);
  assert.match(source, /K3_WRITE:\$\{runId\}:\$\{expectedBuildId\}:\$\{expectedJarSha256\}/);
  assert.match(source, /K4_WRITE:\$\{runId\}:\$\{expectedBuildId\}:\$\{expectedJarSha256\}/);
  assert.match(source, /listenerPid\(expectedPcPort\)/);
  assert.match(source, /listenerPid\(expectedBackendPort\)/);
  assert.match(source, /MFA_BYPASS_MUST_BE_FALSE/);
});

test("wrappers expose exact isolated actors required by K3 and K4 carriers", () => {
  assert.match(source, /accounts: \{ j1B1Operator:/);
  assert.match(source, /publisher:/);
  assert.match(source, /maker:/);
  assert.match(source, /checker:/);
  assert.match(source, /K3_J1_B1_OPERATOR_MUST_NOT_BE_K4_WRITER/);
  assert.match(source, /new Set\(\[j1B1Operator\.username, publisher\.username, maker\.username, checker\.username\]\)/);
  assert.match(source, /overview_b1_read/);
  assert.match(source, /finance_d3_injection_create/);
  assert.match(source, /emergency_j1_gate_resume/);
  assert.match(source, /risk_k4_write/);
  assert.match(source, /risk_k4_user_recompute/);
  assert.match(source, /final7-k3-locked-manifest\.json/);
  assert.match(source, /final7-k4-locked-manifest\.json/);
  assert.doesNotMatch(source, /\/api\/admin\/(?:risk|emergency|finance|overview)\//);
});

test("wrapper output is secret-safe, ACL-allowlisted and removed on failure", () => {
  assert.match(source, /test\.use\(\{ trace: "off", video: "off", screenshot: "off" \}\)/);
  assert.match(source, /icacls\.exe/);
  assert.match(source, /\/inheritance:r/);
  assert.match(source, /ACL_PRINCIPAL_OUTSIDE_ALLOWLIST/);
  assert.match(source, /cleanupSensitiveOutputs/);
  assert.match(source, /unlinkSync\(file\)/);
  assert.match(source, /safe-summary\.json/);
  assert.doesNotMatch(source, /Admin@[0-9]{6,}|A123456789Z/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^)]*(?:password|totp|secret)/i);
});
