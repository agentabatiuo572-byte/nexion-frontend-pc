import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./e2e/b-final10-main-write.spec.ts", import.meta.url), "utf8");

test("Final10 B main write carrier requires explicit candidate, fixture, DB, lock, evidence and token inputs with no historical fallback", () => {
  for (const variable of [
    "B_FINAL10_WRITE_TOKEN", "B_FINAL10_RUN_ID", "B_FINAL10_BASE_URL", "B_FINAL10_DATABASE",
    "B_FINAL10_FIXTURE_PATH", "B_FINAL10_EVIDENCE_DIR", "B_FINAL10_RUNTIME_LOCK_PATH",
    "B_FINAL10_BACKEND_JAR_PATH", "B_FINAL10_MYSQL_PASSWORD", "B_FINAL10_CASE_ID",
  ]) assert.match(source, new RegExp(`required\\("${variable}"\\)|process\\.env\\.${variable}`));
  assert.match(source, /const EXPECTED_CANDIDATE = process\.env\.B_EXPECTED_CANDIDATE\?\.trim\(\) \|\| "Final10"/);
  assert.match(source, /expect\(lock\.candidate\)\.toBe\(EXPECTED_CANDIDATE\)/);
  assert.match(source, /process\.kill\(pid, 0\)/);
  assert.match(source, /_next\/static\/\$\{lock\.pcBuildId\}/);
  assert.match(source, /expect\(fixture\.sensitive.*\)\.toBe\(true\)/);
  assert.doesNotMatch(source, /nexion_acceptance_20260729_114336_d|CONSUMED-B-WRITE-TOKEN-20260729-R7|domain-permission-fixtures\\\\B\.json/);
});

test("Final10 B carrier locks two independently authenticated writers, Final10 idempotency namespace, CAS/unknown recovery, audit/outbox and exact cleanup", () => {
  assert.match(source, /accounts\.maker/);
  assert.match(source, /accounts\.secondWriter/);
  assert.match(source, /expect\(secondWriter\.username\)\.not\.toBe\(maker\.username\)/);
  assert.match(source, /const PREFIX = "FINAL10-B"/);
  assert.match(source, /\[first\.status, second\.status\]\.sort\(\)\)\.toEqual\(\[200, 409\]\)/);
  assert.match(source, /IDEMPOTENCY_KEY_PAYLOAD_MISMATCH/);
  assert.match(source, /commitThenDisconnect/);
  assert.match(source, /route\.fetch\(\)/);
  assert.match(source, /route\.abort\("connectionreset"\)/);
  assert.match(source, /nx_audit_log/);
  assert.match(source, /nx_event_outbox/);
  assert.match(source, /restoreConfig/);
  assert.match(source, /deleteViews/);
  assert.match(source, /expect\(await snapshotConfig[\s\S]*?\)\.toEqual\(beforeConfig\)/);
});

test("Final10 B carrier starts with real visible login and sidebar navigation and does not persist credentials", () => {
  assert.match(source, /input\[autocomplete="username"\]/);
  assert.match(source, /input\[autocomplete="current-password"\]/);
  assert.match(source, /一次性验证码/);
  assert.match(source, /openVisibleB2/);
  assert.match(source, /openVisibleB3/);
  assert.doesNotMatch(source, /Admin@123456|A123456789Z|console\.(?:log|warn|error)\([^)]*(?:password|totp|token)/i);
});
