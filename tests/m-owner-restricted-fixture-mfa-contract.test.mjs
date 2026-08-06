import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const specs = [
  ["M1", "tests/e2e/m1-live-acceptance-20260723.spec.ts", "M1_ADMIN_TOTP_SECRET"],
  ["M2", "tests/e2e/m2-m3-owner-acceptance-20260728.spec.ts", "ADMIN_E2E_TOTP_SECRET"],
  ["M3", "tests/e2e/m3-live-acceptance-20260723.spec.ts", "ADMIN_E2E_TOTP_SECRET"],
  ["M4", "tests/e2e/m4-live-acceptance-20260723.spec.ts", "M4_ADMIN_TOTP_SECRET"],
  ["M5", "tests/e2e/m5-live-acceptance-20260723.spec.ts", "ADMIN_E2E_TOTP_SECRET"],
];

test("M1-M5 owner carriers accept a restricted fixture TOTP secret without MFA bypass", () => {
  for (const [module, file, variable] of specs) {
    const source = readFileSync(file, "utf8");
    assert.match(
      source,
      new RegExp(`process\\.env\\.${variable}`),
      `${module} must consume ${variable} from the restricted runner`,
    );
    assert.doesNotMatch(
      source,
      /(?:MFA_BYPASS|mfaBypass)\s*[:=]\s*(?:true|["']true["'])/i,
      `${module} must not enable MFA bypass`,
    );
  }
});

test("final2 SUPPORT supervisor bootstrap is visible-M1 only, token gated, snapshot restored, and real-MFA", () => {
  const source = readFileSync("tests/e2e/m-final2-support-supervisor-profile-20260729.spec.ts", "utf8");
  assert.match(source, /M_PROFILE_BOOTSTRAP_TOKEN/);
  assert.match(source, /M_PROFILE_RESTORE_TOKEN/);
  assert.match(source, /M_PROFILE_CONTROL_TOKEN/);
  assert.match(source, /data-proof="m1-seat-admin-option"|data-proof=\\?"m1-seat-admin-option\\?"/);
  assert.match(source, /data-proof="m1-seat-role-save"|data-proof=\\?"m1-seat-role-save\\?"/);
  assert.match(source, /m-final2-support-supervisor-before\.restricted\.json/);
  assert.match(source, /expectVisibleProfileEqual/);
  assert.match(source, /supportRole\.toLowerCase\(\)/);
  assert.doesNotMatch(source, /request\.patch\([^)]*support-agents|request\.put\([^)]*support-agents/s);
  assert.doesNotMatch(source, /(?:MFA_BYPASS|mfaBypass)\s*[:=]\s*(?:true|["']true["'])/i);
});

test("final2 M-only checker keeps M1/M5 authorities but must fail their SUPPORT-supervisor business gate", () => {
  const source = readFileSync("tests/e2e/m-final2-owner-gate-20260729.spec.ts", "utf8");
  assert.match(source, /managedM1Probe/);
  assert.match(source, /managedM5Probe/);
  assert.match(source, /managedM1Probe\.status\(\)[\s\S]*toBe\(403\)/);
  assert.match(source, /managedM5Probe\.status\(\)[\s\S]*toBe\(403\)/);
  assert.match(source, /platform_a2_read/);
  assert.match(source, /CHECKER_SESSION_MENU_LEAVES = \["A2", "M1", "M2", "M3", "M4", "M5"\]/);
  assert.match(source, /MAKER_SESSION_MENU_LEAVES = \["A2", "M2", "M3", "M4"\]/);
  assert.match(source, /expect\(authorities, `\$\{label\} authorities must be exact`\)\.toEqual\(expectedAuthorities\)/);
  assert.match(source, /session\.effectiveMenus/);
  assert.match(source, /allowedAudit\.status\(\)[\s\S]*toBe\(200\)/);
  assert.match(source, /M_FINAL2_PC_PID/);
  assert.match(source, /M_FINAL2_BACKEND_PID/);
  assert.match(source, /process\.kill\(FINAL2_PC_PID, 0\)/);
  assert.match(source, /_buildManifest\.js/);
  assert.match(source, /M-only checker has service_m1_write but is not SUPPORT supervisor/);
  assert.match(source, /M-only checker has service_m5_write but is not SUPPORT supervisor/);
});

test("M5 final3 pre-created mode keeps M5 writes on SUPPORT and M3 linked consumption on a second SUPPORT seat", () => {
  const source = readFileSync("tests/e2e/m5-live-acceptance-20260723.spec.ts", "utf8");
  assert.match(source, /M5_SUPPORT_MANIFEST_PATH/);
  assert.match(source, /M5_M3_SUPPORT_MANIFEST_PATH/);
  assert.match(source, /USE_PRECREATED_SUPPORT/);
  assert.match(source, /M3_SUPPORT_ACCOUNT!\.username/);
  assert.match(source, /receiverAgent!\.name/);
  assert.match(source, /M3_SUPPORT_ACCOUNT\?\.username\)\.not\.toBe\(SUPPORT_ACCOUNT\?\.username\)/);
  assert.match(source, /supportAccountAfter[\s\S]*toEqual\(supportAccountBefore\)/);
  assert.match(source, /precreated-support-version-unchanged/);
  assert.match(source, /archiveI18nMirrorAsRoot/);
});

test("M2/M4 final3 uses two distinct M-only operators while M3 positive flow is SUPPORT-only", () => {
  const source = readFileSync("tests/e2e/m234-final2-two-operator-cas-20260729.spec.ts", "utf8");
  assert.match(source, /M_FINAL2_OWNER_FIXTURE_PATH/);
  assert.match(source, /M_FINAL2_CHECKER_MANIFEST_PATH/);
  assert.match(source, /checker!\.username\)\.not\.toBe\(maker!\.username\)/);
  assert.match(source, /MAKER_EXACT_AUTHORITIES/);
  assert.match(source, /MAKER_EXACT_MENU_LEAVES/);
  assert.match(source, /sendAndLoseResponse/);
  assert.match(source, /route\.fetch\(\)[\s\S]*upstreamPayload[\s\S]*route\.abort\("failed"\)/);
  assert.match(source, /expect\(upstreamCode[\s\S]*toBe\(0\)/);
  assert.match(source, /expect\(\[\.\.\.raceCodes\]\.sort[\s\S]*toEqual\(\[0, 409\]\)/);
  assert.match(source, /custom M-only accounts are negative-RBAC actors only/);
  assert.match(source, /M2-CLEANUP-ARCHIVE/);
  assert.match(source, /M4-CLEANUP-DELETE/);
  assert.match(source, /expectFaqMissing/);
});

test("M3 final3 cross-seat carrier locks exact SUPPORT RBAC and fails closed on unknown write results", () => {
  const source = readFileSync("tests/e2e/m3-final3-cross-seat-transfer-20260729.spec.ts", "utf8");
  assert.match(source, /service_m1_read/);
  assert.match(source, /service_m2_read/);
  assert.match(source, /service_m2_write/);
  assert.match(source, /service_m3_read/);
  assert.match(source, /service_m3_write/);
  assert.match(source, /REQUIRED_SUPPORT_MENUS = \["M1", "M2", "M3"\]/);
  assert.match(source, /sorted\(makerOperator\.session\.authorities\)[\s\S]*sorted\(checkerOperator\.session\.authorities\)/);
  assert.match(source, /expectHighRiskWriteForbidden/);
  assert.match(source, /conversationWriteAttempted = true/);
  assert.match(source, /ticketWriteAttempted = true/);
  assert.match(source, /must recover exactly one committed object/);
  assert.match(source, /makerManifest\.createdForRun === true \|\| maker\?\.createdForRun === true/);
  assert.match(source, /checkerManifest\.createdForRun === true \|\| checker\?\.createdForRun === true/);
});

test("final2 M carriers fail fast on bypass, candidate identity, write tokens, and singleton locks", () => {
  const gate = readFileSync("tests/e2e/m-final2-owner-gate-20260729.spec.ts", "utf8");
  const profile = readFileSync("tests/e2e/m-final2-support-supervisor-profile-20260729.spec.ts", "utf8");
  const m1 = readFileSync("tests/e2e/m1-live-acceptance-20260723.spec.ts", "utf8");
  const m2 = readFileSync("tests/e2e/m2-m3-owner-acceptance-20260728.spec.ts", "utf8");
  const m234 = readFileSync("tests/e2e/m234-final2-two-operator-cas-20260729.spec.ts", "utf8");
  const m4 = readFileSync("tests/e2e/m4-live-acceptance-20260723.spec.ts", "utf8");
  const m5 = readFileSync("tests/e2e/m5-live-acceptance-20260723.spec.ts", "utf8");
  for (const [label, source] of [["gate", gate], ["profile", profile], ["M1", m1], ["M2", m2], ["M234", m234], ["M4", m4], ["M5", m5]]) {
    assert.match(source, /M_FINAL2_MFA_BYPASS/, `${label} must require bypass=false`);
    assert.match(source, /BUILD_ID/, `${label} must bind the PC build`);
    assert.match(source, /BACKEND_JAR_SHA256/, `${label} must bind the backend JAR`);
  }
  assert.match(m1, /M_WRITE_TOKEN/);
  assert.match(m1, /M_WRITE_CONTROL_TOKEN/);
  assert.match(m1, /M1_LOAD_CONFIG_LOCK/);
  assert.match(m234, /M_WRITE_TOKEN/);
  assert.match(m234, /M_WRITE_CONTROL_TOKEN/);
  assert.match(m234, /M234_OBJECT_LOCK/);
  assert.match(m2, /M2_OWNER_FIXTURE_PATH/);
  assert.match(m2, /M_WRITE_TOKEN/);
  assert.match(m2, /M_WRITE_CONTROL_TOKEN/);
  assert.match(m4, /M4_OWNER_FIXTURE_PATH/);
  assert.match(m4, /M4_SLA_LOCK/);
  assert.match(m4, /M_WRITE_CONTROL_TOKEN/);
  assert.match(m5, /M_WRITE_TOKEN/);
  assert.match(m5, /M_WRITE_CONTROL_TOKEN/);
  assert.match(m5, /M5_CATEGORY_LOCK/);
  assert.match(m5, /M5_POLICY_LOCK/);
  assert.match(m5, /I6_LOCK/);
});
