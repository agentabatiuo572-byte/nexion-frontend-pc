import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./e2e/a-final7-domain-permission-refresh.spec.ts", import.meta.url), "utf8");

test("Final7 C/E/I fixture refresh is candidate-bound and uses visible A1/A6/A2", () => {
  for (const marker of [
    "FINAL7_DOMAIN_EXPECTED_BUILD_ID",
    "FINAL7_DOMAIN_EXPECTED_JAR_SHA256",
    "FINAL7_DOMAIN_EXPECTED_PC_PID",
    "FINAL7_DOMAIN_EXPECTED_BACKEND_PID",
    "listenerPid",
    "+ 新建角色",
    "编辑授权（权限/菜单）",
    "+ 新建账号",
    "审计 & 操作确认 A2",
    "activateAccount",
  ]) assert.match(source, new RegExp(escapeRegExp(marker)));
});

test("C and E expose fresh maker/readonly/nowrite/nomenu accounts and I6 checker is least privilege", () => {
  assert.match(source, /C_MAKER_PERMISSIONS/);
  assert.match(source, /E_MAKER_PERMISSIONS/);
  assert.match(source, /for \(const domain of \[C_DOMAIN, E_DOMAIN\]\)/);
  for (const key of ["maker", "readonly", "nowrite", "nomenu"]) {
    assert.match(source, new RegExp(`accounts\\[${JSON.stringify(key)}\\]`));
  }
  assert.match(source, /I6_CHECKER_PERMISSIONS\s*=\s*\["content_i6_read",\s*"content_i6_write"\]/);
  assert.match(source, /I6_CHECKER_MENUS\s*=\s*\["I",\s*"I6"\]/);
  assert.match(source, /expect\(session\.roleCode\)\.not\.toBe\("SUPER_ADMIN"\)/);
  assert.match(source, /assertOnlyDomainScope/);
});

test("H blockers receive disposable H3 secondWriter and H8 scoped A2 checker without H business writes", () => {
  assert.match(source, /H3_SECOND_WRITER_PERMISSIONS\s*=\s*\["growth_h3_read",\s*"growth_h3_write"\]/);
  assert.match(source, /H8_CHECKER_PERMISSIONS\s*=\s*\[[\s\S]*"growth_h8_settle"[\s\S]*"platform_a2_operation_approve"/);
  assert.match(source, /secondWriter:\s*h3SecondWriter/);
  assert.match(source, /h8DecisionAuthority:\s*"growth_h8_settle"/);
  assert.match(source, /businessWrites:\s*\{ C: 0, E: 0, I: 0, H: 0 \}/);
});

test("G receives isolated visible A1/A6/A2 maker/read-only/no-write/no-menu actors", () => {
  assert.match(source, /G_MAKER_PERMISSIONS/);
  assert.match(source, /G_READ_PERMISSIONS\s*=\s*\[[\s\S]*"finprod_g7_read"/);
  assert.match(source, /G_MENUS\s*=\s*\["G",\s*"G1",\s*"G2",\s*"G3",\s*"G4",\s*"G7"\]/);
  assert.match(source, /Final7 provisions G permission actors through visible A1\/A6\/A2/);
  assert.match(source, /businessWrites:\s*\{ G: 0 \}/);
  assert.match(source, /G-final7-permission-manifest\.json/);
  assert.match(source, /G-final7-safe-summary\.json/);
});

test("E3/E6 dual-operator fixture uses a distinct normal-MFA least-privilege checker", () => {
  assert.match(source, /E_CHECKER_PERMISSIONS\s*=\s*\[[\s\S]*"platform_a2_operation_approve"[\s\S]*"device_e3_read"[\s\S]*"device_e6_read"/);
  assert.match(source, /Final7 adds independent E3\/E6 checker through visible A1\/A6\/A2/);
  assert.match(source, /expect\(checker\.accountId\)\.not\.toBe\(String\(existingMaker\.accountId\)\)/);
  assert.match(source, /normalMfa:\s*true/);
  assert.match(source, /checkerRole/);
  assert.match(source, /dualOperator:[\s\S]*distinct:\s*true/);
});

test("I nowrite diagnosis performs two serial normal-MFA sessions without cookie values", () => {
  assert.match(source, /Final7 diagnoses I nowrite serial MFA session issuance/);
  assert.match(source, /for \(let attempt = 1; attempt <= 2; attempt \+= 1\)/);
  assert.match(source, /diagnoseNormalMfaSession/);
  assert.match(source, /cookieMetadata/);
  assert.match(source, /I-final7-nowrite-session-diagnostic\.json/);
  assert.doesNotMatch(source, /cookie\.value/);
});

test("E3/E6 CAS second writer is independent and cannot approve A2", () => {
  assert.match(source, /E_SECOND_WRITER_PERMISSIONS\s*=\s*\[\s*"device_e3_read",\s*"device_e3_write",\s*"device_e6_read",\s*"device_e6_write"\s*\]/);
  assert.match(source, /Final7 adds independent E3\/E6 CAS second writer through visible A1\/A6\/A2/);
  assert.match(source, /expect\(secondWriter\.accountId\)\.not\.toBe\(String\(existingChecker\.accountId\)\)/);
  assert.match(source, /a2ApproveAuthority:\s*false/);
  assert.doesNotMatch(source, /E_SECOND_WRITER_PERMISSIONS\s*=\s*\[[^\]]*platform_a2_operation_approve/);
});

test("C specialized actors are three independent least-privilege normal-MFA identities", () => {
  assert.match(source, /C3_CHECKER_PERMISSIONS\s*=\s*\["user_c3_read",\s*"user_c3_adjust_approve",\s*"user_c3_adjust_reverse"\]/);
  assert.match(source, /C5_K5_CHECKER_PERMISSIONS\s*=\s*\["risk_k5_read",\s*"risk_k5_write",\s*"risk_k5_ticket_pass",\s*"risk_k5_ticket_reject"\]/);
  assert.match(source, /C6_SECOND_WRITER_PERMISSIONS\s*=\s*\["user_c6_read",\s*"user_c6_write"\]/);
  assert.match(source, /Final7 adds C3 checker, C5-K5 checker and C6 second writer through visible A1\/A6\/A2/);
  assert.match(source, /expect\(actorIds\.size\)\.toBe\(7\)/);
  assert.match(source, /accounts:\s*\{ \.\.\.existingAccounts, c3Checker, c5K5Checker, secondWriter: c6SecondWriter \}/);
});

test("G second writer is independent, royalty-scoped and maker MFA is stable twice", () => {
  assert.match(source, /expectedGSecondWriterToken/);
  assert.match(source, /G_SECOND_WRITER_MENUS\s*=\s*\["G",\s*"G1",\s*"G2",\s*"G3",\s*"G4",\s*"G7"\]/);
  assert.match(source, /"finprod_g4_royalty_write"/);
  assert.doesNotMatch(source.match(/const G_SECOND_WRITER_PERMISSIONS = \[[\s\S]*?\] as const;/)?.[0] ?? "", /finprod_g4_write/);
  assert.match(source, /accounts:\s*\{ \.\.\.existingAccounts, secondWriter \}/);
  assert.match(source, /expect\(secondWriter\.accountId\)\.not\.toBe\(existingMaker\.accountId\)/);
  assert.match(source, /classification:\s*"STABLE_TWO_OF_TWO"/);
  assert.match(source, /G-final7-maker-session-diagnostic\.json/);
});

test("I approval actor is independent normal-MFA and exactly scoped to A2 plus I decisions", () => {
  assert.match(source, /expectedIA2ApproverToken/);
  assert.match(source, /I_A2_APPROVER_MENUS\s*=\s*\["A",\s*"A2"\]/);
  for (const code of [
    "platform_a2_read", "platform_a2_operation_approve", "content_i3_cap_adjust",
    "content_i4_publish_standard", "content_i4_trust_section_manage",
    "content_i5_disclosure_publish", "content_i5_gate_adjust",
  ]) assert.match(source, new RegExp(`"${code}"`));
  assert.match(source, /accounts:\s*\{ \.\.\.existingAccounts, a2Approver \}/);
  assert.match(source, /expect\(a2Approver\.accountId\)\.not\.toBe\(String\(existingMaker\.accountId\)\)/);
  assert.match(source, /expect\(a2Approver\.accountId\)\.not\.toBe\(String\(existingI6Checker\.accountId\)\)/);
});

test("expanded tail provisions an A2-A4 read-only actor and a visible pending A6 negative probe", () => {
  assert.match(source, /expectedExpandedTailToken/);
  assert.match(source, /A_AUDIT_READER_PERMISSIONS\s*=\s*\["platform_a2_read",\s*"platform_a4_read"\]/);
  assert.match(source, /A_AUDIT_READER_MENUS\s*=\s*\["A",\s*"A2",\s*"A4"\]/);
  assert.match(source, /businessWriteAuthorities:\s*0/);
  assert.match(source, /expectedECheckerApproveStatus:\s*403/);
  assert.match(source, /status:\s*"PENDING_E_CHECKER_NEGATIVE_PROBE"/);
  assert.match(source, /await grantRoleVisible\(page, pendingCreated, pendingRole\.permissions, pendingRole\.menus\)/);
  assert.doesNotMatch(source.match(/const E6_CROSS_PENDING_PERMISSIONS = \[[\s\S]*?\] as const;/)?.[0] ?? "", /device_e/);
});

test("expanded cleanup requires E 403 evidence and visibly rejects all three A tickets", () => {
  assert.match(source, /expectedExpandedCleanupToken/);
  assert.match(source, /expect\(manifest\.status\)\.toBe\("PENDING_E_CHECKER_NEGATIVE_PROBE"\)/);
  assert.match(source, /"WO-260724122231653-700"/);
  assert.match(source, /"WO-260730000609294-300"/);
  assert.match(source, /await rejectVisibleA2\(page, item\.operationId\)/);
  assert.match(source, /approveAttempts:\s*1/);
  assert.match(source, /httpStatus:\s*403/);
  assert.match(source, /status:\s*"REJECTED_AND_CLEANED"/);
});

test("sensitive manifests are atomic, ACL allowlisted, hashed, and failure-cleaned", () => {
  for (const marker of [
    "writeRestrictedJson",
    "restrictDirectoryAcl",
    "assertAclRestricted",
    "ACL_PRINCIPAL_OUTSIDE_ALLOWLIST",
    "fileSha256",
    "cleanupFailedProvision",
    "deleteExactDatabaseAccount",
    "deleteExactDatabaseRole",
    "unlinkSync",
  ]) assert.match(source, new RegExp(marker));
  assert.match(source, /sensitive:\s*true/);
  assert.match(source, /doNotUpload:\s*true/);
  assert.doesNotMatch(source, /Admin@123456|A123456789Z/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
