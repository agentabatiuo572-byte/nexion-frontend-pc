import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./e2e/domain-permission-fixture-recovery.spec.ts", import.meta.url), "utf8");

test("recovery harness has no historical Run or credential defaults and requires explicit write enablement", () => {
  assert.match(source, /DOMAIN_PERMISSION_FIXTURE_RECOVERY !== "1"/);
  for (const name of [
    "DOMAIN_PERMISSION_FIXTURE_RUN_ID",
    "DOMAIN_PERMISSION_FIXTURE_RESTRICTED_ROOT",
    "DOMAIN_PERMISSION_FIXTURE_OPERATOR",
    "DOMAIN_PERMISSION_FIXTURE_OPERATOR_PASSWORD",
    "DOMAIN_PERMISSION_FIXTURE_ACCOUNT_PASSWORD",
    "DOMAIN_PERMISSION_FIXTURE_EVIDENCE_DIR",
  ]) assert.match(source, new RegExp(`required\\("${name}"\\)`));
  assert.doesNotMatch(source, /pc-full-acceptance-20\d{6}/);
  assert.doesNotMatch(source, /Admin@[0-9]{6,}|A123456789Z/);
});

test("F maker recovery resumes the already-disabled account, removes dormant privilege, and uses formal keyed cleanup", () => {
  assert.match(source, /must already be disabled by the separately recorded A-002 CAS probe/);
  assert.doesNotMatch(source, /f-maker-status-race-left|f-maker-status-race-right/);
  for (const suffix of ["role", "sessions/revoke", "reset-2fa"]) {
    assert.match(source, new RegExp(`"${suffix}"`));
  }
  assert.match(source, /role: "unassigned"/);
  assert.match(source, /force-logout against any super target/);
  assert.match(source, /f-maker-revoke:v\$\{revokeVersion\}/);
  assert.match(source, /f-maker-reset-2fa:v\$\{resetVersion\}/);
  assert.match(source, /Number\(current\.sessions\) > 0/);
  assert.match(source, /if \(current\.tfa\)/);
  assert.match(source, /"Idempotency-Key": key/);
  assert.match(source, /operator: config\.operator,[\s\S]*reason,[\s\S]*expectedVersion:/);
  assert.match(source, /assertRetiredAuthenticationBarrier/);
  assert.match(source, /retired maker must not retain active sessions/);
});

test("ready state resumes A-E, recovers missing F.json, rebuilds G-M, and persists 52 accounts", () => {
  assert.match(source, /const EXISTING_DOMAINS = \["A", "B", "C", "D", "E"\]/);
  assert.match(source, /const REBUILD_DOMAINS = \["F", "G", "H", "I", "J", "K", "L", "M"\]/);
  assert.match(source, /for \(const domain of EXISTING_DOMAINS\)/);
  assert.match(source, /F\.json is intentionally not required/);
  assert.match(source, /for \(const domain of REBUILD_DOMAINS\)/);
  assert.match(source, /toHaveLength\(52\)/);
  assert.match(source, /const ROLES = \["maker", "readonly", "nowrite", "nomenu"\]/);
  assert.match(source, /global checker must exist in the same Run/);
  assert.match(source, /refusing partial ready state/);
  assert.match(source, /recovery-progress\.json/);
  assert.match(source, /persistRecoveryProgress/);
  assert.match(source, /recovery progress belongs to another run/);
  assert.match(source, /if \(accounts\[roleKey\]\)/);
  assert.match(source, /"cleanup-manifest\.json"/);
  assert.match(source, /restoreOrder/);
  assert.match(source, /keyed by secret: different accounts never share a 30-second lock/);
  assert.match(source, /Never infer the active operator from a visible shell/);
  assert.match(source, /page\.request\.post\("\/api\/admin\/auth\/logout"\)/);
});
