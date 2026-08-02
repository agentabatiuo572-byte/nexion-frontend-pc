import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page, type Response } from "@playwright/test";

const token = required("FINAL7_DOMAIN_REFRESH_TOKEN");
const baseUrl = required("FINAL7_DOMAIN_BASE_URL");
const runId = required("FINAL7_DOMAIN_RUN_ID");
const outputDir = required("FINAL7_DOMAIN_OUTPUT_DIR");
const sourceAManifestPath = required("FINAL7_DOMAIN_SOURCE_A_MANIFEST");
const sourceIManifestPath = required("FINAL7_DOMAIN_SOURCE_I_MANIFEST");
const sourceHManifestPath = required("FINAL7_DOMAIN_SOURCE_H_MANIFEST");
const expectedBuildId = required("FINAL7_DOMAIN_EXPECTED_BUILD_ID");
const candidateJar = required("FINAL7_DOMAIN_CANDIDATE_JAR");
const expectedJarSha256 = required("FINAL7_DOMAIN_EXPECTED_JAR_SHA256").toUpperCase();
const expectedPcPid = positiveInteger(required("FINAL7_DOMAIN_EXPECTED_PC_PID"), "PC_PID");
const expectedBackendPid = positiveInteger(required("FINAL7_DOMAIN_EXPECTED_BACKEND_PID"), "BACKEND_PID");
const restrictedOwner = required("FINAL7_DOMAIN_RESTRICTED_OWNER");
const dbName = required("FINAL7_DOMAIN_DB_NAME");
const dbPassword = required("FINAL7_DOMAIN_DB_PASSWORD");
const mysqlBin = process.env.FINAL7_DOMAIN_MYSQL_BIN?.trim()
  || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const expectedToken = `${runId}:FINAL7:C-E-I-H:VISIBLE-A1-A6-A2:${expectedPcPid}:${expectedBackendPid}`;
const expectedGToken = `${runId}:FINAL7:G:VISIBLE-A1-A6-A2:${expectedPcPid}:${expectedBackendPid}`;
const expectedECheckerToken = `${runId}:FINAL7:E-CHECKER:VISIBLE-A1-A6-A2:${expectedPcPid}:${expectedBackendPid}`;
const expectedESecondWriterToken = `${runId}:FINAL7:E-SECOND-WRITER:VISIBLE-A1-A6-A2:${expectedPcPid}:${expectedBackendPid}`;
const expectedCSpecializedToken = `${runId}:FINAL7:C-SPECIALIZED:VISIBLE-A1-A6-A2:${expectedPcPid}:${expectedBackendPid}`;
const expectedGSecondWriterToken = `${runId}:FINAL7:G-SECOND-WRITER:VISIBLE-A1-A6-A2:${expectedPcPid}:${expectedBackendPid}`;
const expectedIA2ApproverToken = `${runId}:FINAL7:I-A2-APPROVER:VISIBLE-A1-A6-A2:${expectedPcPid}:${expectedBackendPid}`;
const expectedExpandedTailToken = `${runId}:FINAL7:A-AUDIT-READER-E6-PENDING:VISIBLE-A1-A6-A2:${expectedPcPid}:${expectedBackendPid}`;
const expectedExpandedCleanupToken = `${runId}:FINAL7:EXPANDED-A-CLEANUP:AFTER-E-403:VISIBLE-A2:${expectedPcPid}:${expectedBackendPid}`;
const expectedISessionDiagToken = `${runId}:FINAL7:I-NOWRITE-SESSION-DIAG:${expectedPcPid}:${expectedBackendPid}`;
const expectedGlobalFixtureBatchToken = `${runId}:FINAL10:B-F-H-M:VISIBLE-A1-A6-A2:${expectedPcPid}:${expectedBackendPid}`;
const final10RuntimeLockPath = process.env.FINAL10_RUNTIME_LOCK_PATH?.trim()
  || `D:/workspace/bug-pic/.restricted/${runId}/candidate-rebuild-final10/final10-runtime-lock.json`;
const globalFixtureSourcePath = process.env.FINAL9_GLOBAL_SOURCE_MANIFEST?.trim() || sourceAManifestPath;
const globalBSourcePath = process.env.FINAL9_GLOBAL_B_SOURCE_MANIFEST?.trim()
  || `D:/workspace/bug-pic/.restricted/${runId}/A/domain-permission-fixtures/B.json`;
const globalHSourcePath = process.env.FINAL9_GLOBAL_H_SOURCE_MANIFEST?.trim() || sourceHManifestPath;
const reason = token === expectedGToken
  ? `${runId} Final7 G least-privilege fixture refresh`
  : token === expectedECheckerToken
    ? `${runId} Final7 E3/E6 independent checker fixture refresh`
    : token === expectedESecondWriterToken
      ? `${runId} Final7 E3/E6 independent CAS second writer fixture refresh`
      : token === expectedCSpecializedToken
        ? `${runId} Final7 C3/C5-K5/C6 specialized actor fixture refresh`
        : token === expectedGSecondWriterToken
          ? `${runId} Final7 G independent second writer fixture refresh`
          : token === expectedIA2ApproverToken
            ? `${runId} Final7 I independent A2 approver fixture refresh`
            : token === expectedExpandedTailToken
              ? `${runId} Final7 A2-A4 audit reader and E6 cross-domain pending probe fixture`
              : token === expectedExpandedCleanupToken
                ? `${runId} Final7 expanded A2 pending and lock cleanup after E checker 403`
                : token === expectedGlobalFixtureBatchToken
                  ? `${runId} Final10 B/F/H/M dedicated least-privilege fixture batch`
        : `${runId} Final7 C/E/I/H least-privilege fixture refresh`;
const nonce = randomBytes(5).toString("hex");
const C_MANIFEST = path.join(outputDir, "C-final7-permission-manifest.json");
const E_MANIFEST = path.join(outputDir, "E-final7-permission-manifest.json");
const I_MANIFEST = path.join(outputDir, "I-final7-permission-manifest.json");
const H_MANIFEST = path.join(outputDir, "H-final7-permission-manifest.json");
const SAFE_SUMMARY = path.join(outputDir, "safe-summary.json");
const OUTPUTS = [C_MANIFEST, E_MANIFEST, I_MANIFEST, H_MANIFEST, SAFE_SUMMARY];
const G_MANIFEST = path.join(outputDir, "G-final7-permission-manifest.json");
const G_SAFE_SUMMARY = path.join(outputDir, "G-final7-safe-summary.json");
const G_OUTPUTS = [G_MANIFEST, G_SAFE_SUMMARY];
const G_MAKER_SESSION_DIAGNOSTIC = path.join(outputDir, "G-final7-maker-session-diagnostic.json");
const I_SESSION_DIAGNOSTIC = path.join(outputDir, "I-final7-nowrite-session-diagnostic.json");
const A_AUDIT_READER_MANIFEST = path.join(outputDir, "A-final7-audit-reader-manifest.json");
const A_AUDIT_READER_SAFE_SUMMARY = path.join(outputDir, "A-final7-audit-reader-safe-summary.json");
const E6_CROSS_PENDING_MANIFEST = path.join(outputDir, "E6-final7-cross-domain-pending-manifest.json");
const B_FINAL9_MANIFEST = path.join(outputDir, "B-final10-fixture-manifest.json");
const F_FINAL9_MANIFEST = path.join(outputDir, "F-final10-checker-manifest.json");
const H_FINAL9_MANIFEST = path.join(outputDir, "H-final10-fixture-manifest.json");
const M_FINAL9_MANIFEST = path.join(outputDir, "M-final10-support-supervisor-manifest.json");
const GLOBAL_FINAL9_SAFE_SUMMARY = path.join(outputDir, "safe-summary.json");
const GLOBAL_FINAL9_OUTPUTS = [B_FINAL9_MANIFEST, F_FINAL9_MANIFEST, H_FINAL9_MANIFEST, M_FINAL9_MANIFEST, GLOBAL_FINAL9_SAFE_SUMMARY];
const createdAccounts: Credential[] = [];
const createdRoles: RoleRuntime[] = [];
const plannedUsernames = new Set<string>();
const usedTotpSteps = new Map<string, number>();

const C_MAKER_PERMISSIONS = [
  "platform_a2_read", "user_c1_read", "user_c1_write", "user_c1hub_read", "user_c1hub_write",
  "user_c1hub_account_freeze", "user_c1hub_account_unfreeze", "user_c1hub_session_revoke_all",
  "user_c1hub_session_revoke_one", "user_c1hub_password_reset", "user_c1hub_password_force_change",
  "user_c1hub_2fa_reset", "user_c1hub_device_replace", "user_c1hub_device_recycle",
  "user_c1hub_earning_grant", "user_c1hub_earning_reverse", "user_c1hub_compensation_grant",
  "user_c2_read", "user_c2_write", "user_c2_account_freeze", "user_c2_account_unfreeze",
  "user_c2_session_revoke_all", "user_c2_impersonate_terminate", "user_c2_blocklist_add",
  "user_c3_read", "user_c3_write", "user_c3_adjust_create", "user_c3_adjust_reverse",
  "user_c4_read", "user_c5_read", "user_c5_write", "user_c5_session_revoke_one",
  "user_c5_session_revoke_all", "user_c5_2fa_disable", "user_c5_password_reset", "user_c6_read",
  "user_c6_write", "platform_a2_proposal_create", "user_c2_impersonate_start", "user_c4_verify",
  "user_c4_revoke", "user_c4_trigger_review", "user_c4_export", "user_c4_network_write",
  "user_c5_unlock_short", "user_c5_unlock_long",
] as const;
const C_READ_PERMISSIONS = ["user_c1_read", "user_c2_read", "user_c3_read", "user_c4_read", "user_c5_read", "user_c6_read"] as const;
const C_MENUS = ["C", "C1", "C2", "C3", "C4", "C5", "C6"] as const;
const C3_CHECKER_PERMISSIONS = ["user_c3_read", "user_c3_adjust_approve", "user_c3_adjust_reverse"] as const;
const C3_CHECKER_MENUS = ["C", "C3"] as const;
const C5_K5_CHECKER_PERMISSIONS = ["risk_k5_read", "risk_k5_write", "risk_k5_ticket_pass", "risk_k5_ticket_reject"] as const;
const C5_K5_CHECKER_MENUS = ["K", "K5"] as const;
const C6_SECOND_WRITER_PERMISSIONS = ["user_c6_read", "user_c6_write"] as const;
const C6_SECOND_WRITER_MENUS = ["C", "C6"] as const;

const E_MAKER_PERMISSIONS = [
  "platform_a2_read", "device_e1_read", "device_e1_write", "device_e1_generation_gate_force_unlock",
  "device_e1_generation_gate_force_lock", "device_e2_read", "device_e2_write", "device_e2_phone_tier_usdt",
  "device_e2_phone_tier_nex", "device_e3_read", "device_e3_write", "device_e3_degrade_late",
  "device_e3_salvage_pct", "device_e3_promo_mult", "device_e4_read", "device_e4_write",
  "device_e4_order_refund", "device_e5_read", "device_e5_write", "device_e5_device_force_activate",
  "device_e5_device_unbind", "device_e5_datacenter_pause", "device_e6_read", "device_e6_write",
  "platform_a2_proposal_create", "device_e6_flag_toggle",
] as const;
const E_READ_PERMISSIONS = ["device_e1_read", "device_e2_read", "device_e3_read", "device_e4_read", "device_e5_read", "device_e6_read"] as const;
const E_MENUS = ["E", "E1", "E2", "E3", "E4", "E5", "E6"] as const;
const E_CHECKER_PERMISSIONS = [
  "platform_a2_read", "platform_a2_operation_approve", "device_e3_read", "device_e6_read",
] as const;
const E_CHECKER_MENUS = ["A2", "E", "E3", "E6"] as const;
const E_SECOND_WRITER_PERMISSIONS = ["device_e3_read", "device_e3_write", "device_e6_read", "device_e6_write"] as const;
const E_SECOND_WRITER_MENUS = ["E", "E3", "E6"] as const;

const G_MAKER_PERMISSIONS = [
  "platform_a2_read", "finprod_g1_read", "finprod_g1_write", "finprod_g1_apy_write",
  "finprod_g1_penalty_write", "finprod_g1_min_write", "finprod_g1_kill_toggle", "finprod_g2_read",
  "finprod_g2_write", "finprod_g2_cap_user_write", "finprod_g2_cap_platform_write",
  "finprod_g2_cap_per_tx_write", "finprod_g2_fee_rate_write", "finprod_g2_swap_toggle",
  "finprod_g2_queue_cancel", "finprod_g3_read", "finprod_g3_write",
  "finprod_g3_curve_target_price_write", "finprod_g3_curve_pump_prob_write",
  "finprod_g3_override_price_write", "finprod_g3_engine_pause_toggle", "finprod_g4_read",
  "finprod_g4_write", "finprod_g4_price_write", "finprod_g4_dividend_rate_write",
  "finprod_g4_royalty_write", "finprod_g4_market_toggle", "finprod_g7_read", "finprod_g7_write",
  "finprod_g7_apy_write", "finprod_g7_nurture_write", "finprod_g4_airdrop_pct_write",
  "finprod_g4_emission_curve_write", "finprod_g4_airdrop_lock_days_write", "platform_a2_proposal_create",
] as const;
const G_READ_PERMISSIONS = ["finprod_g1_read", "finprod_g2_read", "finprod_g3_read", "finprod_g4_read", "finprod_g7_read"] as const;
const G_MENUS = ["G", "G1", "G2", "G3", "G4", "G7"] as const;
const G_SECOND_WRITER_PERMISSIONS = [
  "finprod_g1_read", "finprod_g1_min_write", "finprod_g2_read", "finprod_g2_fee_rate_write",
  "finprod_g3_read", "finprod_g3_write", "finprod_g4_read", "finprod_g4_royalty_write",
  "finprod_g7_read", "finprod_g7_apy_write",
] as const;
const G_SECOND_WRITER_MENUS = ["G", "G1", "G2", "G3", "G4", "G7"] as const;

const I6_CHECKER_PERMISSIONS = ["content_i6_read", "content_i6_write"] as const;
const I6_CHECKER_MENUS = ["I", "I6"] as const;
const I_A2_APPROVER_PERMISSIONS = [
  "platform_a2_read", "platform_a2_operation_approve", "content_i3_cap_adjust",
  "content_i4_publish_standard", "content_i4_trust_section_manage",
  "content_i5_disclosure_publish", "content_i5_gate_adjust",
] as const;
const I_A2_APPROVER_MENUS = ["A", "A2"] as const;
const A_AUDIT_READER_PERMISSIONS = ["platform_a2_read", "platform_a4_read"] as const;
const A_AUDIT_READER_MENUS = ["A", "A2", "A4"] as const;
const E6_CROSS_PENDING_PERMISSIONS = ["platform_a8_read"] as const;
const E6_CROSS_PENDING_MENUS = ["A", "A8"] as const;
const H3_SECOND_WRITER_PERMISSIONS = ["growth_h3_read", "growth_h3_write"] as const;
const H3_SECOND_WRITER_MENUS = ["H3"] as const;
const H8_CHECKER_PERMISSIONS = [
  "growth_h8_read", "growth_h8_settle", "platform_a2_read", "platform_a2_operation_approve",
] as const;
const H8_CHECKER_MENUS = ["A2", "H8"] as const;

const B_FINAL9_MAKER_PERMISSIONS = [
  "platform_a2_read", "platform_a2_proposal_create",
  "overview_b1_read", "overview_b1_write", "overview_b1_redline_write", "overview_b1_runrisk_write",
  "overview_b1_kill_switch_trigger", "overview_b2_read", "overview_b2_write", "overview_b2_export",
  "overview_b3_read", "overview_b3_view_write", "overview_b3_export", "overview_b4_read",
  "overview_b4_jump", "overview_b4_export", "overview_b5_read", "overview_b5_triage",
  "overview_b5_subscribe", "overview_b5_threshold_write",
] as const;
const B_FINAL9_MAKER_MENUS = ["B", "B1", "B2", "B3", "B4", "B5"] as const;
const B_FINAL9_SECOND_PERMISSIONS = ["overview_b2_read", "overview_b2_write", "overview_b3_read", "overview_b3_view_write"] as const;
const B_FINAL9_SECOND_MENUS = ["B2", "B3"] as const;
const F1_FINAL9_CHECKER_PERMISSIONS = [
  "platform_a2_read", "platform_a2_operation_approve", "network_f1_read", "network_f1_write",
] as const;
const F1_FINAL9_CHECKER_MENUS = ["A2", "F1"] as const;
const F25_FINAL9_CHECKER_PERMISSIONS = [
  "platform_a2_read", "platform_a2_operation_approve", "network_f2_read", "network_f3_read",
  "network_f4_read", "network_f5_read", "network_f2_policy_amplify", "network_f2_royalty_rate",
  "network_f2_write", "network_f3_engine_pause", "network_f3_match_rate", "network_f3_write",
  "network_f4_leaderboard_control", "network_f4_pool_fund", "network_f4_write",
  "network_f5_commission_dispose", "network_f5_commission_reject", "network_f5_write",
] as const;
const F25_FINAL9_CHECKER_MENUS = ["A2", "F2", "F3", "F4", "F5"] as const;
const H3_FINAL9_SECOND_PERMISSIONS = ["growth_h3_read", "growth_h3_write"] as const;
const H3_FINAL9_SECOND_MENUS = ["H3"] as const;
const H8_FINAL9_CHECKER_PERMISSIONS = [
  "platform_a2_read", "platform_a2_operation_approve", "growth_h8_read", "growth_h8_settle",
] as const;
const H8_FINAL9_CHECKER_MENUS = ["A2", "H8"] as const;

type Credential = { accountId: string; username: string; password: string; totpSecret: string };
type SourceManifest = {
  runId?: string;
  candidate?: { buildId?: string; jarSha256?: string };
  actors?: Record<string, Partial<Credential>>;
  accounts?: Record<string, Record<string, unknown>>;
  checker?: Record<string, unknown>;
  [key: string]: unknown;
};
type Session = { username: string; roleCode: string; authorities: string[]; menus: string[] };
type RoleSpec = { code: string; name: string; permissions: readonly string[]; menus: readonly string[] };
type RoleRuntime = RoleSpec & { id: number; grantOperationId: string };
type DomainSpec = {
  code: "C" | "E" | "G";
  makerRole: RoleSpec;
  readRole: RoleSpec;
  makerPermissions: readonly string[];
  readPermissions: readonly string[];
  menus: readonly string[];
  readPath: string;
  crossPath: string;
};
type Provisioned = Credential & { roleCode: string; authorities: string[]; effectiveMenus: string[]; normalMfa: true };

const C_DOMAIN: DomainSpec = {
  code: "C",
  makerRole: role("C_MK", "Final7 C maker", C_MAKER_PERMISSIONS, C_MENUS),
  readRole: role("C_RO", "Final7 C readonly", C_READ_PERMISSIONS, C_MENUS),
  makerPermissions: C_MAKER_PERMISSIONS,
  readPermissions: C_READ_PERMISSIONS,
  menus: C_MENUS,
  readPath: "/api/admin/users/overview",
  crossPath: "/api/admin/devices/overview",
};
const E_DOMAIN: DomainSpec = {
  code: "E",
  makerRole: role("E_MK", "Final7 E maker", E_MAKER_PERMISSIONS, E_MENUS),
  readRole: role("E_RO", "Final7 E readonly", E_READ_PERMISSIONS, E_MENUS),
  makerPermissions: E_MAKER_PERMISSIONS,
  readPermissions: E_READ_PERMISSIONS,
  menus: E_MENUS,
  readPath: "/api/admin/devices/overview",
  crossPath: "/api/admin/users/overview",
};
const G_DOMAIN: DomainSpec = {
  code: "G",
  makerRole: role("G_MK", "Final7 G maker", G_MAKER_PERMISSIONS, G_MENUS),
  readRole: role("G_RO", "Final7 G readonly", G_READ_PERMISSIONS, G_MENUS),
  makerPermissions: G_MAKER_PERMISSIONS,
  readPermissions: G_READ_PERMISSIONS,
  menus: G_MENUS,
  readPath: "/api/admin/market/staking",
  crossPath: "/api/admin/users/overview",
};
const E_CHECKER_ROLE = role("E36_CK", "Final7 E3 E6 checker", E_CHECKER_PERMISSIONS, E_CHECKER_MENUS);
const E_SECOND_WRITER_ROLE = role("E36_W2", "Final7 E3 E6 second writer", E_SECOND_WRITER_PERMISSIONS, E_SECOND_WRITER_MENUS);
const C3_CHECKER_ROLE = role("C3_CK", "Final7 C3 checker", C3_CHECKER_PERMISSIONS, C3_CHECKER_MENUS);
const C5_K5_CHECKER_ROLE = role("C5K5_CK", "Final7 C5 K5 checker", C5_K5_CHECKER_PERMISSIONS, C5_K5_CHECKER_MENUS);
const C6_SECOND_WRITER_ROLE = role("C6_W2", "Final7 C6 second writer", C6_SECOND_WRITER_PERMISSIONS, C6_SECOND_WRITER_MENUS);
const G_SECOND_WRITER_ROLE = role("G_W2", "Final7 G second writer", G_SECOND_WRITER_PERMISSIONS, G_SECOND_WRITER_MENUS);
const I_A2_APPROVER_ROLE = role("I_A2_AP", "Final7 I A2 approver", I_A2_APPROVER_PERMISSIONS, I_A2_APPROVER_MENUS);
const A_AUDIT_READER_ROLE = role("A24_RO", "Final7 A2 A4 audit reader", A_AUDIT_READER_PERMISSIONS, A_AUDIT_READER_MENUS);
const E6_CROSS_PENDING_ROLE = role("E6_XDOM", "Final7 E6 cross-domain negative probe", E6_CROSS_PENDING_PERMISSIONS, E6_CROSS_PENDING_MENUS);
const I6_ROLE = role("I6_CK", "Final7 I6 checker", I6_CHECKER_PERMISSIONS, I6_CHECKER_MENUS);
const H3_ROLE = role("H3_W2", "Final7 H3 second writer", H3_SECOND_WRITER_PERMISSIONS, H3_SECOND_WRITER_MENUS);
const H8_ROLE = role("H8_CK", "Final7 H8 checker", H8_CHECKER_PERMISSIONS, H8_CHECKER_MENUS);
const B_FINAL9_MAKER_ROLE = final9Role("B_MK", "Final10 B maker", B_FINAL9_MAKER_PERMISSIONS, B_FINAL9_MAKER_MENUS);
const B_FINAL9_SECOND_ROLE = final9Role("B23_W2", "Final10 B2 B3 second writer", B_FINAL9_SECOND_PERMISSIONS, B_FINAL9_SECOND_MENUS);
const F1_FINAL9_CHECKER_ROLE = final9Role("F1_CK", "Final10 F1 checker", F1_FINAL9_CHECKER_PERMISSIONS, F1_FINAL9_CHECKER_MENUS);
const F25_FINAL9_CHECKER_ROLE = final9Role("F25_CK", "Final10 F2 F5 checker", F25_FINAL9_CHECKER_PERMISSIONS, F25_FINAL9_CHECKER_MENUS);
const H3_FINAL9_SECOND_ROLE = final9Role("H3_W2", "Final10 H3 second writer", H3_FINAL9_SECOND_PERMISSIONS, H3_FINAL9_SECOND_MENUS);
const H8_FINAL9_CHECKER_ROLE = final9Role("H8_CK", "Final10 H8 checker", H8_FINAL9_CHECKER_PERMISSIONS, H8_FINAL9_CHECKER_MENUS);
const ALL_ROLE_SPECS = [C_DOMAIN.makerRole, C_DOMAIN.readRole, E_DOMAIN.makerRole, E_DOMAIN.readRole, I6_ROLE, H3_ROLE, H8_ROLE] as const;

test.use({
  baseURL: baseUrl,
  trace: token === expectedGlobalFixtureBatchToken ? "on" : "off",
  screenshot: "off",
  video: "off",
});
test.describe.configure({ mode: "serial", timeout: 1_800_000 });

test("Final7 refreshes C/E permission actors, I6 checker, H3 secondWriter and H8 decision checker", async ({ page, browser }) => {
  expect(token, "controller-issued critical-section token is required").toBe(expectedToken);
  validateStaticScope();
  verifyCandidateAndListeners();
  mkdirSync(outputDir, { recursive: true });
  restrictDirectoryAcl(outputDir);
  for (const file of OUTPUTS) if (existsSync(file)) throw new Error(`FINAL7_OUTPUT_ALREADY_EXISTS:${path.basename(file)}`);

  const sourceA = readManifest(sourceAManifestPath);
  const sourceI = readManifest(sourceIManifestPath);
  const sourceH = readManifest(sourceHManifestPath);
  expect(sourceA.runId).toBe(runId);
  expect(sourceI.runId).toBe(runId);
  expect(sourceH.runId).toBe(runId);
  const maker = credential(sourceA.actors?.maker, "SOURCE_A_MAKER");
  const reviewer = credential(sourceA.actors?.checker, "SOURCE_A_REVIEWER");
  expect(maker.username).not.toBe(reviewer.username);

  const reviewerContext = await browser.newContext({ baseURL: baseUrl });
  const reviewerPage = await reviewerContext.newPage();
  let completed = false;
  try {
    await loginMfa(page, maker);
    await assertSourceAdmin(page, maker.username);
    await loginMfa(reviewerPage, reviewer);
    await assertSourceAdmin(reviewerPage, reviewer.username);

    const roleRuntimes = new Map<string, RoleRuntime>();
    for (const spec of ALL_ROLE_SPECS) {
      const created = await createRoleVisible(page, spec);
      const runtime: RoleRuntime = { ...spec, id: created.id, grantOperationId: "" };
      createdRoles.push(runtime);
      const grantOperationId = await grantRoleVisible(page, created, spec.permissions, spec.menus);
      await approveVisibleA2(reviewerPage, grantOperationId);
      runtime.grantOperationId = grantOperationId;
      await assertRoleGrantExact(page, runtime);
      roleRuntimes.set(spec.code, runtime);
    }

    const domainManifests = new Map<string, Record<string, Provisioned>>();
    for (const domain of [C_DOMAIN, E_DOMAIN]) {
      const accounts: Record<string, Provisioned> = {};
      accounts["maker"] = await provisionVisibleAccount(
        page, browser, `${domain.code.toLowerCase()}m`, roleRuntimes.get(domain.makerRole.code)!, domain.makerPermissions, domain.menus,
      );
      accounts["readonly"] = await provisionVisibleAccount(
        page, browser, `${domain.code.toLowerCase()}r`, roleRuntimes.get(domain.readRole.code)!, domain.readPermissions, domain.menus,
      );
      accounts["nowrite"] = await provisionVisibleAccount(
        page, browser, `${domain.code.toLowerCase()}n`, roleRuntimes.get(domain.readRole.code)!, domain.readPermissions, domain.menus,
      );
      accounts["nomenu"] = await provisionVisibleAccount(
        page, browser, `${domain.code.toLowerCase()}x`, undefined, [], [],
      );
      domainManifests.set(domain.code, accounts);
    }

    const i6Checker = await provisionVisibleAccount(
      page, browser, "i6c", roleRuntimes.get(I6_ROLE.code)!, I6_CHECKER_PERMISSIONS, I6_CHECKER_MENUS,
    );
    const h3SecondWriter = await provisionVisibleAccount(
      page, browser, "h3w", roleRuntimes.get(H3_ROLE.code)!, H3_SECOND_WRITER_PERMISSIONS, H3_SECOND_WRITER_MENUS,
    );
    const h8Checker = await provisionVisibleAccount(
      page, browser, "h8c", roleRuntimes.get(H8_ROLE.code)!, H8_CHECKER_PERMISSIONS, H8_CHECKER_MENUS,
    );

    for (const domain of [C_DOMAIN, E_DOMAIN]) {
      const accounts = domainManifests.get(domain.code)!;
      for (const key of ["maker", "readonly", "nowrite"] as const) {
        await verifyNormalActor(browser, accounts[key], domain.readPath, domain.crossPath, domain.code);
      }
      await verifyNormalActor(browser, accounts.nomenu, domain.readPath, domain.crossPath, domain.code);
    }
    await verifyNormalActor(browser, i6Checker, "/api/admin/content/i18n-learning/overview", "/api/admin/users/overview", "I6");
    await verifyNormalActor(browser, h3SecondWriter, "/api/admin/growth/quest-events/tasks", "/api/admin/users/overview", "H3");
    await verifyNormalActor(browser, h8Checker, "/api/admin/growth/referral-rewards", "/api/admin/users/overview", "H8");

    const permissionId = await permissionIdByCode(page, "growth_h8_settle");
    const candidate = candidateBinding();
    const generatedAt = new Date().toISOString();
    const CAccounts = domainManifests.get("C")!;
    const EAccounts = domainManifests.get("E")!;
    writeRestrictedJson(C_MANIFEST, domainManifest("C", CAccounts, [roleRuntimes.get(C_DOMAIN.makerRole.code)!, roleRuntimes.get(C_DOMAIN.readRole.code)!], candidate, generatedAt));
    writeRestrictedJson(E_MANIFEST, domainManifest("E", EAccounts, [roleRuntimes.get(E_DOMAIN.makerRole.code)!, roleRuntimes.get(E_DOMAIN.readRole.code)!], candidate, generatedAt));
    writeRestrictedJson(I_MANIFEST, {
      ...sourceI,
      sensitive: true,
      doNotUpload: true,
      runId,
      generatedAt,
      candidate,
      source: "Final7 visible A1/A6/A2 dedicated I6 checker; no I-domain business write",
      checker: i6Checker,
      final7Role: publicRole(roleRuntimes.get(I6_ROLE.code)!),
      cleanup: cleanupPlan([i6Checker], [roleRuntimes.get(I6_ROLE.code)!]),
    });
    writeRestrictedJson(H_MANIFEST, {
      ...sourceH,
      sensitive: true,
      doNotUpload: true,
      runId,
      generatedAt,
      candidate,
      source: "Final7 visible A1/A6/A2 H3/H8 actor refresh; zero H business writes",
      accounts: { ...(sourceH.accounts ?? {}), secondWriter: h3SecondWriter },
      checker: {
        ...h8Checker,
        h8DecisionAuthority: "growth_h8_settle",
        h8DecisionScope: "H8 only",
        h8DecisionRoleId: roleRuntimes.get(H8_ROLE.code)!.id,
        h8DecisionPermissionId: permissionId,
      },
      final7Roles: [publicRole(roleRuntimes.get(H3_ROLE.code)!), publicRole(roleRuntimes.get(H8_ROLE.code)!)],
      cleanup: cleanupPlan([h3SecondWriter, h8Checker], [roleRuntimes.get(H3_ROLE.code)!, roleRuntimes.get(H8_ROLE.code)!]),
    });
    writeRestrictedJson(SAFE_SUMMARY, {
      runId,
      generatedAt,
      candidate,
      visibleProvisioning: ["A1", "A6", "A2"],
      businessWrites: { C: 0, E: 0, I: 0, H: 0 },
      manifests: [C_MANIFEST, E_MANIFEST, I_MANIFEST, H_MANIFEST].map((file) => ({
        file: path.basename(file), sha256: fileSha256(file),
      })),
      actors: createdAccounts.map((actor) => ({ accountId: actor.accountId, username: actor.username })),
      roles: createdRoles.map((roleRow) => ({ roleId: roleRow.id, roleCode: roleRow.code })),
      acl: { inherited: false, allowlistOnly: true },
      status: "READY",
    });
    completed = true;
  } catch (error) {
    await cleanupFailedProvision(page).catch(() => undefined);
    for (const file of OUTPUTS) if (existsSync(file)) unlinkSync(file);
    throw error;
  } finally {
    if (!completed) {
      for (const file of OUTPUTS) if (existsSync(file)) unlinkSync(file);
    }
    await reviewerContext.close();
  }
});

test("Final7 provisions G permission actors through visible A1/A6/A2", async ({ page, browser }) => {
  expect(token, "controller-issued G critical-section token is required").toBe(expectedGToken);
  validateStaticScope();
  verifyCandidateAndListeners();
  mkdirSync(outputDir, { recursive: true });
  restrictDirectoryAcl(outputDir);
  for (const file of G_OUTPUTS) if (existsSync(file)) throw new Error(`FINAL7_OUTPUT_ALREADY_EXISTS:${path.basename(file)}`);

  const sourceA = readManifest(sourceAManifestPath);
  expect(sourceA.runId).toBe(runId);
  const maker = credential(sourceA.actors?.maker, "SOURCE_A_MAKER");
  const reviewer = credential(sourceA.actors?.checker, "SOURCE_A_REVIEWER");
  expect(maker.username).not.toBe(reviewer.username);

  const reviewerContext = await browser.newContext({ baseURL: baseUrl });
  const reviewerPage = await reviewerContext.newPage();
  let completed = false;
  try {
    await loginMfa(page, maker);
    await assertSourceAdmin(page, maker.username);
    await loginMfa(reviewerPage, reviewer);
    await assertSourceAdmin(reviewerPage, reviewer.username);

    const roleRuntimes = new Map<string, RoleRuntime>();
    for (const spec of [G_DOMAIN.makerRole, G_DOMAIN.readRole]) {
      const created = await createRoleVisible(page, spec);
      const runtime: RoleRuntime = { ...spec, id: created.id, grantOperationId: "" };
      createdRoles.push(runtime);
      const grantOperationId = await grantRoleVisible(page, created, spec.permissions, spec.menus);
      await approveVisibleA2(reviewerPage, grantOperationId);
      runtime.grantOperationId = grantOperationId;
      await assertRoleGrantExact(page, runtime);
      roleRuntimes.set(spec.code, runtime);
    }

    const accounts: Record<string, Provisioned> = {};
    accounts["maker"] = await provisionVisibleAccount(
      page, browser, "gm", roleRuntimes.get(G_DOMAIN.makerRole.code)!, G_DOMAIN.makerPermissions, G_DOMAIN.menus,
    );
    accounts["readonly"] = await provisionVisibleAccount(
      page, browser, "gr", roleRuntimes.get(G_DOMAIN.readRole.code)!, G_DOMAIN.readPermissions, G_DOMAIN.menus,
    );
    accounts["nowrite"] = await provisionVisibleAccount(
      page, browser, "gn", roleRuntimes.get(G_DOMAIN.readRole.code)!, G_DOMAIN.readPermissions, G_DOMAIN.menus,
    );
    accounts["nomenu"] = await provisionVisibleAccount(page, browser, "gx", undefined, [], []);
    for (const key of ["maker", "readonly", "nowrite", "nomenu"] as const) {
      await verifyNormalActor(browser, accounts[key], G_DOMAIN.readPath, G_DOMAIN.crossPath, G_DOMAIN.code);
    }

    const roles = [roleRuntimes.get(G_DOMAIN.makerRole.code)!, roleRuntimes.get(G_DOMAIN.readRole.code)!];
    const candidate = candidateBinding();
    const generatedAt = new Date().toISOString();
    writeRestrictedJson(G_MANIFEST, domainManifest("G", accounts, roles, candidate, generatedAt));
    writeRestrictedJson(G_SAFE_SUMMARY, {
      runId,
      generatedAt,
      candidate,
      visibleProvisioning: ["A1", "A6", "A2"],
      businessWrites: { G: 0 },
      manifest: { file: path.basename(G_MANIFEST), sha256: fileSha256(G_MANIFEST) },
      actors: Object.values(accounts).map((actor) => ({ accountId: actor.accountId, username: actor.username })),
      roles: roles.map((roleRow) => ({ roleId: roleRow.id, roleCode: roleRow.code })),
      acl: { inherited: false, allowlistOnly: true },
      status: "READY",
    });
    completed = true;
  } catch (error) {
    await cleanupFailedProvision(page).catch(() => undefined);
    for (const file of G_OUTPUTS) if (existsSync(file)) unlinkSync(file);
    throw error;
  } finally {
    if (!completed) for (const file of G_OUTPUTS) if (existsSync(file)) unlinkSync(file);
    await reviewerContext.close();
  }
});

test("Final7 adds independent E3/E6 checker through visible A1/A6/A2", async ({ page, browser }) => {
  expect(token, "controller-issued E checker critical-section token is required").toBe(expectedECheckerToken);
  validateStaticScope();
  verifyCandidateAndListeners();
  restrictDirectoryAcl(outputDir);
  if (!existsSync(E_MANIFEST) || !existsSync(SAFE_SUMMARY)) throw new Error("FINAL7_E_CHECKER_SOURCE_MISSING");
  const originalEText = readFileSync(E_MANIFEST, "utf8");
  const originalSafeText = readFileSync(SAFE_SUMMARY, "utf8");
  const existingE = JSON.parse(originalEText) as Record<string, unknown>;
  const existingSafe = JSON.parse(originalSafeText) as Record<string, unknown>;
  expect(existingE.runId).toBe(runId);
  expect(existingE.checker, "E checker must not already exist").toBeUndefined();
  const existingAccounts = objectRecord(existingE.accounts, "E_ACCOUNTS");
  const existingMaker = objectRecord(existingAccounts.maker, "E_MAKER");
  expect(String(existingMaker.accountId)).toMatch(/^\d+$/);

  const sourceA = readManifest(sourceAManifestPath);
  expect(sourceA.runId).toBe(runId);
  const maker = credential(sourceA.actors?.maker, "SOURCE_A_MAKER");
  const reviewer = credential(sourceA.actors?.checker, "SOURCE_A_REVIEWER");
  expect(maker.username).not.toBe(reviewer.username);

  const reviewerContext = await browser.newContext({ baseURL: baseUrl });
  const reviewerPage = await reviewerContext.newPage();
  let completed = false;
  let filesChanged = false;
  try {
    await loginMfa(page, maker);
    await assertSourceAdmin(page, maker.username);
    await loginMfa(reviewerPage, reviewer);
    await assertSourceAdmin(reviewerPage, reviewer.username);

    const created = await createRoleVisible(page, E_CHECKER_ROLE);
    const checkerRole: RoleRuntime = { ...E_CHECKER_ROLE, id: created.id, grantOperationId: "" };
    createdRoles.push(checkerRole);
    checkerRole.grantOperationId = await grantRoleVisible(page, created, checkerRole.permissions, checkerRole.menus);
    await approveVisibleA2(reviewerPage, checkerRole.grantOperationId);
    await assertRoleGrantExact(page, checkerRole);
    const checker = await provisionVisibleAccount(
      page, browser, "e36c", checkerRole, E_CHECKER_PERMISSIONS, E_CHECKER_MENUS,
    );
    expect(checker.accountId).not.toBe(String(existingMaker.accountId));
    expect(checker.normalMfa).toBe(true);
    await verifyNormalActor(browser, checker, E_DOMAIN.readPath, E_DOMAIN.crossPath, "E3/E6 checker");

    const previousCleanup = objectRecord(existingE.cleanup, "E_CLEANUP");
    const incrementalCleanup = cleanupPlan([checker], [checkerRole]);
    const generatedAt = new Date().toISOString();
    const updatedE = {
      ...existingE,
      generatedAt,
      checker,
      checkerRole: publicRole(checkerRole),
      dualOperator: {
        scopes: ["E3", "E6"],
        makerAccountId: String(existingMaker.accountId),
        checkerAccountId: checker.accountId,
        distinct: true,
        checkerMayWriteBusinessDomain: false,
      },
      cleanup: {
        ...previousCleanup,
        required: true,
        accounts: [...objectArray(previousCleanup.accounts), ...incrementalCleanup.accounts],
        roles: [...objectArray(previousCleanup.roles), ...incrementalCleanup.roles],
      },
    };
    writeRestrictedJson(E_MANIFEST, updatedE);
    filesChanged = true;

    const safeActors = objectArray(existingSafe.actors);
    const safeRoles = objectArray(existingSafe.roles);
    const safeManifests = objectArray(existingSafe.manifests).map((entry) => {
      const row = objectRecord(entry, "SAFE_MANIFEST_ENTRY");
      return row.file === path.basename(E_MANIFEST)
        ? { ...row, sha256: fileSha256(E_MANIFEST) }
        : row;
    });
    writeRestrictedJson(SAFE_SUMMARY, {
      ...existingSafe,
      generatedAt,
      manifests: safeManifests,
      actors: [...safeActors, { accountId: checker.accountId, username: checker.username }],
      roles: [...safeRoles, { roleId: checkerRole.id, roleCode: checkerRole.code }],
      dualOperator: { E3: true, E6: true, distinctAccountIds: true },
      status: "READY",
    });
    completed = true;
  } catch (error) {
    await cleanupFailedProvision(page).catch(() => undefined);
    if (filesChanged) {
      writeRestrictedText(E_MANIFEST, originalEText);
      writeRestrictedText(SAFE_SUMMARY, originalSafeText);
    }
    throw error;
  } finally {
    if (!completed && filesChanged) {
      writeRestrictedText(E_MANIFEST, originalEText);
      writeRestrictedText(SAFE_SUMMARY, originalSafeText);
    }
    await reviewerContext.close();
  }
});

test("Final7 diagnoses I nowrite serial MFA session issuance", async ({ browser }) => {
  expect(token, "controller-issued I session diagnostic token is required").toBe(expectedISessionDiagToken);
  validateStaticScope();
  verifyCandidateAndListeners();
  restrictDirectoryAcl(outputDir);
  if (existsSync(I_SESSION_DIAGNOSTIC)) throw new Error("FINAL7_I_SESSION_DIAGNOSTIC_ALREADY_EXISTS");
  const sourceI = readManifest(sourceIManifestPath);
  expect(sourceI.runId).toBe(runId);
  const nowrite = credential(sourceI.accounts?.nowrite as Partial<Credential> | undefined, "SOURCE_I_NOWRITE");
  const attempts: Array<Record<string, unknown>> = [];
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      attempts.push(await diagnoseNormalMfaSession(browser, nowrite, attempt));
    }
    expect(attempts.every((row) => row.sessionStatus === 200 && row.logoutStatus === 200 && row.afterLogoutSessionStatus === 401)).toBe(true);
    const totpSteps = attempts.map((row) => Number(row.totpStep));
    expect(totpSteps[1]).toBeGreaterThan(totpSteps[0]);
    writeRestrictedJson(I_SESSION_DIAGNOSTIC, {
      runId,
      generatedAt: new Date().toISOString(),
      candidate: candidateBinding(),
      actor: { accountId: nowrite.accountId, username: nowrite.username, manifestField: "accounts.nowrite" },
      serial: true,
      independentContexts: true,
      distinctTotpWindows: true,
      attempts,
      classification: "STABLE_TWO_OF_TWO",
      secretMaterialIncluded: false,
    });
  } catch (error) {
    writeRestrictedJson(I_SESSION_DIAGNOSTIC, {
      runId,
      generatedAt: new Date().toISOString(),
      candidate: candidateBinding(),
      actor: { accountId: nowrite.accountId, username: nowrite.username, manifestField: "accounts.nowrite" },
      serial: true,
      independentContexts: true,
      attempts,
      classification: "REPRODUCED_SESSION_ISSUANCE_FAILURE",
      failure: error instanceof Error ? { name: error.name, message: error.message } : { name: "UNKNOWN" },
      secretMaterialIncluded: false,
    });
    throw error;
  }
});

test("Final7 adds independent E3/E6 CAS second writer through visible A1/A6/A2", async ({ page, browser }) => {
  expect(token, "controller-issued E second-writer critical-section token is required").toBe(expectedESecondWriterToken);
  validateStaticScope();
  verifyCandidateAndListeners();
  restrictDirectoryAcl(outputDir);
  if (!existsSync(E_MANIFEST) || !existsSync(SAFE_SUMMARY)) throw new Error("FINAL7_E_SECOND_WRITER_SOURCE_MISSING");
  const originalEText = readFileSync(E_MANIFEST, "utf8");
  const originalSafeText = readFileSync(SAFE_SUMMARY, "utf8");
  const existingE = JSON.parse(originalEText) as Record<string, unknown>;
  const existingSafe = JSON.parse(originalSafeText) as Record<string, unknown>;
  expect(existingE.runId).toBe(runId);
  const existingAccounts = objectRecord(existingE.accounts, "E_ACCOUNTS");
  expect(existingAccounts.secondWriter, "E second writer must not already exist").toBeUndefined();
  const existingMaker = objectRecord(existingAccounts.maker, "E_MAKER");
  const existingChecker = objectRecord(existingE.checker, "E_CHECKER");
  expect(String(existingMaker.accountId)).toMatch(/^\d+$/);
  expect(String(existingChecker.accountId)).toMatch(/^\d+$/);
  expect(String(existingMaker.accountId)).not.toBe(String(existingChecker.accountId));

  const sourceA = readManifest(sourceAManifestPath);
  expect(sourceA.runId).toBe(runId);
  const maker = credential(sourceA.actors?.maker, "SOURCE_A_MAKER");
  const reviewer = credential(sourceA.actors?.checker, "SOURCE_A_REVIEWER");
  const reviewerContext = await browser.newContext({ baseURL: baseUrl });
  const reviewerPage = await reviewerContext.newPage();
  let completed = false;
  let filesChanged = false;
  try {
    await loginMfa(page, maker);
    await assertSourceAdmin(page, maker.username);
    await loginMfa(reviewerPage, reviewer);
    await assertSourceAdmin(reviewerPage, reviewer.username);
    const created = await createRoleVisible(page, E_SECOND_WRITER_ROLE);
    const secondWriterRole: RoleRuntime = { ...E_SECOND_WRITER_ROLE, id: created.id, grantOperationId: "" };
    createdRoles.push(secondWriterRole);
    secondWriterRole.grantOperationId = await grantRoleVisible(page, created, secondWriterRole.permissions, secondWriterRole.menus);
    await approveVisibleA2(reviewerPage, secondWriterRole.grantOperationId);
    await assertRoleGrantExact(page, secondWriterRole);
    const secondWriter = await provisionVisibleAccount(
      page, browser, "e36w", secondWriterRole, E_SECOND_WRITER_PERMISSIONS, E_SECOND_WRITER_MENUS,
    );
    expect(secondWriter.accountId).not.toBe(String(existingMaker.accountId));
    expect(secondWriter.accountId).not.toBe(String(existingChecker.accountId));
    await verifyNormalActor(browser, secondWriter, E_DOMAIN.readPath, E_DOMAIN.crossPath, "E3/E6 second writer");

    const previousCleanup = objectRecord(existingE.cleanup, "E_CLEANUP");
    const incrementalCleanup = cleanupPlan([secondWriter], [secondWriterRole]);
    const previousDual = objectRecord(existingE.dualOperator, "E_DUAL_OPERATOR");
    const generatedAt = new Date().toISOString();
    writeRestrictedJson(E_MANIFEST, {
      ...existingE,
      generatedAt,
      accounts: { ...existingAccounts, secondWriter },
      secondWriter,
      secondWriterRole: publicRole(secondWriterRole),
      dualOperator: {
        ...previousDual,
        secondWriterAccountId: secondWriter.accountId,
        distinctMakerCheckerSecondWriter: true,
        a2ApproveAuthority: false,
      },
      cleanup: {
        ...previousCleanup,
        required: true,
        accounts: [...objectArray(previousCleanup.accounts), ...incrementalCleanup.accounts],
        roles: [...objectArray(previousCleanup.roles), ...incrementalCleanup.roles],
      },
    });
    filesChanged = true;
    const safeManifests = objectArray(existingSafe.manifests).map((entry) => {
      const row = objectRecord(entry, "SAFE_MANIFEST_ENTRY");
      return row.file === path.basename(E_MANIFEST) ? { ...row, sha256: fileSha256(E_MANIFEST) } : row;
    });
    const safeDual = objectRecord(existingSafe.dualOperator, "SAFE_DUAL_OPERATOR");
    writeRestrictedJson(SAFE_SUMMARY, {
      ...existingSafe,
      generatedAt,
      manifests: safeManifests,
      actors: [...objectArray(existingSafe.actors), { accountId: secondWriter.accountId, username: secondWriter.username }],
      roles: [...objectArray(existingSafe.roles), { roleId: secondWriterRole.id, roleCode: secondWriterRole.code }],
      dualOperator: { ...safeDual, E3CasSecondWriter: true, E6CasSecondWriter: true, threeDistinctActors: true },
      status: "READY",
    });
    completed = true;
  } catch (error) {
    await cleanupFailedProvision(page).catch(() => undefined);
    if (filesChanged) {
      writeRestrictedText(E_MANIFEST, originalEText);
      writeRestrictedText(SAFE_SUMMARY, originalSafeText);
    }
    throw error;
  } finally {
    if (!completed && filesChanged) {
      writeRestrictedText(E_MANIFEST, originalEText);
      writeRestrictedText(SAFE_SUMMARY, originalSafeText);
    }
    await reviewerContext.close();
  }
});

test("Final7 adds C3 checker, C5-K5 checker and C6 second writer through visible A1/A6/A2", async ({ page, browser }) => {
  expect(token, "controller-issued C specialized critical-section token is required").toBe(expectedCSpecializedToken);
  validateStaticScope();
  verifyCandidateAndListeners();
  restrictDirectoryAcl(outputDir);
  if (!existsSync(C_MANIFEST) || !existsSync(SAFE_SUMMARY)) throw new Error("FINAL7_C_SPECIALIZED_SOURCE_MISSING");
  const originalCText = readFileSync(C_MANIFEST, "utf8");
  const originalSafeText = readFileSync(SAFE_SUMMARY, "utf8");
  const existingC = JSON.parse(originalCText) as Record<string, unknown>;
  const existingSafe = JSON.parse(originalSafeText) as Record<string, unknown>;
  expect(existingC.runId).toBe(runId);
  const existingAccounts = objectRecord(existingC.accounts, "C_ACCOUNTS");
  for (const field of ["c3Checker", "c5K5Checker", "secondWriter"]) {
    expect(existingAccounts[field], `C ${field} must not already exist`).toBeUndefined();
  }

  const sourceA = readManifest(sourceAManifestPath);
  expect(sourceA.runId).toBe(runId);
  const maker = credential(sourceA.actors?.maker, "SOURCE_A_MAKER");
  const reviewer = credential(sourceA.actors?.checker, "SOURCE_A_REVIEWER");
  const reviewerContext = await browser.newContext({ baseURL: baseUrl });
  const reviewerPage = await reviewerContext.newPage();
  let completed = false;
  let filesChanged = false;
  try {
    await loginMfa(page, maker);
    await assertSourceAdmin(page, maker.username);
    await loginMfa(reviewerPage, reviewer);
    await assertSourceAdmin(reviewerPage, reviewer.username);

    const roles: RoleRuntime[] = [];
    for (const spec of [C3_CHECKER_ROLE, C5_K5_CHECKER_ROLE, C6_SECOND_WRITER_ROLE]) {
      const created = await createRoleVisible(page, spec);
      const runtime: RoleRuntime = { ...spec, id: created.id, grantOperationId: "" };
      createdRoles.push(runtime);
      runtime.grantOperationId = await grantRoleVisible(page, created, runtime.permissions, runtime.menus);
      await approveVisibleA2(reviewerPage, runtime.grantOperationId);
      await assertRoleGrantExact(page, runtime);
      roles.push(runtime);
    }
    const [c3Role, c5K5Role, c6Role] = roles;
    const c3Checker = await provisionVisibleAccount(page, browser, "c3c", c3Role, C3_CHECKER_PERMISSIONS, C3_CHECKER_MENUS);
    const c5K5Checker = await provisionVisibleAccount(page, browser, "c5k5c", c5K5Role, C5_K5_CHECKER_PERMISSIONS, C5_K5_CHECKER_MENUS);
    const c6SecondWriter = await provisionVisibleAccount(page, browser, "c6w", c6Role, C6_SECOND_WRITER_PERMISSIONS, C6_SECOND_WRITER_MENUS);
    await verifyNormalActor(browser, c3Checker, "/api/admin/users/asset-adjustments/overview", C_DOMAIN.crossPath, "C3 checker");
    await verifyNormalActor(browser, c5K5Checker, "/api/admin/risk/kyc-review/overview", C_DOMAIN.crossPath, "C5-K5 checker");
    await verifyNormalActor(browser, c6SecondWriter, "/api/admin/users/registration-risk/overview", C_DOMAIN.crossPath, "C6 second writer");
    const actorIds = new Set([
      ...Object.values(existingAccounts).map((entry) => String(objectRecord(entry, "C_EXISTING_ACTOR").accountId)),
      c3Checker.accountId, c5K5Checker.accountId, c6SecondWriter.accountId,
    ]);
    expect(actorIds.size).toBe(7);

    const previousCleanup = objectRecord(existingC.cleanup, "C_CLEANUP");
    const incrementalCleanup = cleanupPlan([c3Checker, c5K5Checker, c6SecondWriter], roles);
    const generatedAt = new Date().toISOString();
    writeRestrictedJson(C_MANIFEST, {
      ...existingC,
      generatedAt,
      accounts: { ...existingAccounts, c3Checker, c5K5Checker, secondWriter: c6SecondWriter },
      checker: c3Checker,
      c3Checker,
      c5K5Checker,
      c6SecondWriter,
      specializedRoles: roles.map(publicRole),
      workflowActors: {
        C3: { checkerAccountId: c3Checker.accountId, exclusiveApproveAuthority: true },
        C5K5: { checkerAccountId: c5K5Checker.accountId, exclusiveK5Scope: true },
        C6: { secondWriterAccountId: c6SecondWriter.accountId, distinct: true },
      },
      cleanup: {
        ...previousCleanup,
        required: true,
        accounts: [...objectArray(previousCleanup.accounts), ...incrementalCleanup.accounts],
        roles: [...objectArray(previousCleanup.roles), ...incrementalCleanup.roles],
      },
    });
    filesChanged = true;
    const safeManifests = objectArray(existingSafe.manifests).map((entry) => {
      const row = objectRecord(entry, "SAFE_MANIFEST_ENTRY");
      return row.file === path.basename(C_MANIFEST) ? { ...row, sha256: fileSha256(C_MANIFEST) } : row;
    });
    writeRestrictedJson(SAFE_SUMMARY, {
      ...existingSafe,
      generatedAt,
      manifests: safeManifests,
      actors: [
        ...objectArray(existingSafe.actors),
        { accountId: c3Checker.accountId, username: c3Checker.username },
        { accountId: c5K5Checker.accountId, username: c5K5Checker.username },
        { accountId: c6SecondWriter.accountId, username: c6SecondWriter.username },
      ],
      roles: [...objectArray(existingSafe.roles), ...roles.map((roleRow) => ({ roleId: roleRow.id, roleCode: roleRow.code }))],
      specializedActors: { C3Checker: true, C5K5Checker: true, C6SecondWriter: true, allDistinct: true },
      status: "READY",
    });
    completed = true;
  } catch (error) {
    await cleanupFailedProvision(page).catch(() => undefined);
    if (filesChanged) {
      writeRestrictedText(C_MANIFEST, originalCText);
      writeRestrictedText(SAFE_SUMMARY, originalSafeText);
    }
    throw error;
  } finally {
    if (!completed && filesChanged) {
      writeRestrictedText(C_MANIFEST, originalCText);
      writeRestrictedText(SAFE_SUMMARY, originalSafeText);
    }
    await reviewerContext.close();
  }
});

test("Final7 adds G second writer and diagnoses maker serial MFA sessions through visible A1/A6/A2", async ({ page, browser }) => {
  expect(token, "controller-issued G second-writer critical-section token is required").toBe(expectedGSecondWriterToken);
  validateStaticScope();
  verifyCandidateAndListeners();
  restrictDirectoryAcl(outputDir);
  if (!existsSync(G_MANIFEST) || !existsSync(G_SAFE_SUMMARY)) throw new Error("FINAL7_G_SECOND_WRITER_SOURCE_MISSING");
  if (existsSync(G_MAKER_SESSION_DIAGNOSTIC)) throw new Error("FINAL7_G_MAKER_SESSION_DIAGNOSTIC_ALREADY_EXISTS");
  const originalGText = readFileSync(G_MANIFEST, "utf8");
  const originalSafeText = readFileSync(G_SAFE_SUMMARY, "utf8");
  const existingG = JSON.parse(originalGText) as Record<string, unknown>;
  const existingSafe = JSON.parse(originalSafeText) as Record<string, unknown>;
  expect(existingG.runId).toBe(runId);
  const existingAccounts = objectRecord(existingG.accounts, "G_ACCOUNTS");
  expect(existingAccounts.secondWriter, "G second writer must not already exist").toBeUndefined();
  const existingMaker = credential(existingAccounts.maker as Partial<Credential> | undefined, "G_EXISTING_MAKER");

  const sourceA = readManifest(sourceAManifestPath);
  expect(sourceA.runId).toBe(runId);
  const fixtureAdmin = credential(sourceA.actors?.maker, "SOURCE_A_MAKER");
  const reviewer = credential(sourceA.actors?.checker, "SOURCE_A_REVIEWER");
  const reviewerContext = await browser.newContext({ baseURL: baseUrl });
  const reviewerPage = await reviewerContext.newPage();
  let completed = false;
  let filesChanged = false;
  try {
    await loginMfa(page, fixtureAdmin);
    await assertSourceAdmin(page, fixtureAdmin.username);
    await loginMfa(reviewerPage, reviewer);
    await assertSourceAdmin(reviewerPage, reviewer.username);

    const created = await createRoleVisible(page, G_SECOND_WRITER_ROLE);
    const secondWriterRole: RoleRuntime = { ...G_SECOND_WRITER_ROLE, id: created.id, grantOperationId: "" };
    createdRoles.push(secondWriterRole);
    secondWriterRole.grantOperationId = await grantRoleVisible(
      page, created, secondWriterRole.permissions, secondWriterRole.menus,
    );
    await approveVisibleA2(reviewerPage, secondWriterRole.grantOperationId);
    await assertRoleGrantExact(page, secondWriterRole);
    const secondWriter = await provisionVisibleAccount(
      page, browser, "gw2", secondWriterRole, G_SECOND_WRITER_PERMISSIONS, G_SECOND_WRITER_MENUS,
    );
    expect(secondWriter.accountId).not.toBe(existingMaker.accountId);
    expect(secondWriter.authorities).not.toContain("platform_a2_operation_approve");
    expect(secondWriter.authorities).not.toContain("finprod_g4_write");
    await verifyNormalActor(browser, secondWriter, G_DOMAIN.readPath, G_DOMAIN.crossPath, "G second writer");

    const attempts: Array<Record<string, unknown>> = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      attempts.push(await diagnoseNormalMfaSession(browser, existingMaker, attempt, "G maker"));
    }
    expect(attempts.every((row) => row.sessionStatus === 200 && row.logoutStatus === 200 && row.afterLogoutSessionStatus === 401)).toBe(true);
    const totpSteps = attempts.map((row) => Number(row.totpStep));
    expect(totpSteps[1]).toBeGreaterThan(totpSteps[0]);
    writeRestrictedJson(G_MAKER_SESSION_DIAGNOSTIC, {
      runId,
      generatedAt: new Date().toISOString(),
      candidate: candidateBinding(),
      actor: { accountId: existingMaker.accountId, username: existingMaker.username, manifestField: "accounts.maker" },
      serial: true,
      independentContexts: true,
      distinctTotpWindows: true,
      attempts,
      classification: "STABLE_TWO_OF_TWO",
      secretMaterialIncluded: false,
    });
    filesChanged = true;

    const previousCleanup = objectRecord(existingG.cleanup, "G_CLEANUP");
    const incrementalCleanup = cleanupPlan([secondWriter], [secondWriterRole]);
    const generatedAt = new Date().toISOString();
    writeRestrictedJson(G_MANIFEST, {
      ...existingG,
      generatedAt,
      accounts: { ...existingAccounts, secondWriter },
      secondWriter,
      secondWriterRole: publicRole(secondWriterRole),
      dualOperator: {
        makerAccountId: existingMaker.accountId,
        secondWriterAccountId: secondWriter.accountId,
        distinct: true,
        a2ApproveAuthority: false,
        g4GenericWriteAuthority: false,
        g4RoyaltyWriteAuthority: true,
      },
      makerSessionDiagnostic: {
        file: path.basename(G_MAKER_SESSION_DIAGNOSTIC),
        sha256: fileSha256(G_MAKER_SESSION_DIAGNOSTIC),
        classification: "STABLE_TWO_OF_TWO",
      },
      cleanup: {
        ...previousCleanup,
        required: true,
        accounts: [...objectArray(previousCleanup.accounts), ...incrementalCleanup.accounts],
        roles: [...objectArray(previousCleanup.roles), ...incrementalCleanup.roles],
      },
    });

    const existingManifestSummary = objectRecord(existingSafe.manifest, "G_SAFE_MANIFEST");
    writeRestrictedJson(G_SAFE_SUMMARY, {
      ...existingSafe,
      generatedAt,
      manifest: { ...existingManifestSummary, sha256: fileSha256(G_MANIFEST) },
      actors: [...objectArray(existingSafe.actors), { accountId: secondWriter.accountId, username: secondWriter.username }],
      roles: [...objectArray(existingSafe.roles), { roleId: secondWriterRole.id, roleCode: secondWriterRole.code }],
      dualOperator: { G: true, distinctAccountIds: true, leastPrivilege: true, a2ApproveAuthority: false },
      diagnostics: [{
        file: path.basename(G_MAKER_SESSION_DIAGNOSTIC),
        sha256: fileSha256(G_MAKER_SESSION_DIAGNOSTIC),
        classification: "STABLE_TWO_OF_TWO",
      }],
      status: "READY",
    });
    completed = true;
  } catch (error) {
    await cleanupFailedProvision(page).catch(() => undefined);
    if (filesChanged) {
      writeRestrictedText(G_MANIFEST, originalGText);
      writeRestrictedText(G_SAFE_SUMMARY, originalSafeText);
      if (existsSync(G_MAKER_SESSION_DIAGNOSTIC)) unlinkSync(G_MAKER_SESSION_DIAGNOSTIC);
    }
    throw error;
  } finally {
    if (!completed && filesChanged) {
      writeRestrictedText(G_MANIFEST, originalGText);
      writeRestrictedText(G_SAFE_SUMMARY, originalSafeText);
      if (existsSync(G_MAKER_SESSION_DIAGNOSTIC)) unlinkSync(G_MAKER_SESSION_DIAGNOSTIC);
    }
    await reviewerContext.close();
  }
});

test("Final7 adds independent I A2 approver through visible A1/A6/A2", async ({ page, browser }) => {
  expect(token, "controller-issued I A2 approver critical-section token is required").toBe(expectedIA2ApproverToken);
  validateStaticScope();
  verifyCandidateAndListeners();
  restrictDirectoryAcl(outputDir);
  if (!existsSync(I_MANIFEST) || !existsSync(SAFE_SUMMARY)) throw new Error("FINAL7_I_A2_APPROVER_SOURCE_MISSING");
  const originalIText = readFileSync(I_MANIFEST, "utf8");
  const originalSafeText = readFileSync(SAFE_SUMMARY, "utf8");
  const existingI = JSON.parse(originalIText) as Record<string, unknown>;
  const existingSafe = JSON.parse(originalSafeText) as Record<string, unknown>;
  expect(existingI.runId).toBe(runId);
  expect(existingI.a2Approver, "I A2 approver must not already exist").toBeUndefined();
  const existingAccounts = objectRecord(existingI.accounts, "I_ACCOUNTS");
  expect(existingAccounts.a2Approver, "I accounts.a2Approver must not already exist").toBeUndefined();
  const existingMaker = objectRecord(existingAccounts.maker, "I_MAKER");
  const existingI6Checker = objectRecord(existingI.checker, "I6_CHECKER");
  expect(String(existingMaker.accountId)).toMatch(/^\d+$/);
  expect(String(existingI6Checker.accountId)).toMatch(/^\d+$/);
  expect(String(existingMaker.accountId)).not.toBe(String(existingI6Checker.accountId));

  const sourceA = readManifest(sourceAManifestPath);
  expect(sourceA.runId).toBe(runId);
  const fixtureAdmin = credential(sourceA.actors?.maker, "SOURCE_A_MAKER");
  const reviewer = credential(sourceA.actors?.checker, "SOURCE_A_REVIEWER");
  const reviewerContext = await browser.newContext({ baseURL: baseUrl });
  const reviewerPage = await reviewerContext.newPage();
  let completed = false;
  let filesChanged = false;
  try {
    await loginMfa(page, fixtureAdmin);
    await assertSourceAdmin(page, fixtureAdmin.username);
    await loginMfa(reviewerPage, reviewer);
    await assertSourceAdmin(reviewerPage, reviewer.username);

    const created = await createRoleVisible(page, I_A2_APPROVER_ROLE);
    const approverRole: RoleRuntime = { ...I_A2_APPROVER_ROLE, id: created.id, grantOperationId: "" };
    createdRoles.push(approverRole);
    approverRole.grantOperationId = await grantRoleVisible(page, created, approverRole.permissions, approverRole.menus);
    await approveVisibleA2(reviewerPage, approverRole.grantOperationId);
    await assertRoleGrantExact(page, approverRole);
    const a2Approver = await provisionVisibleAccount(
      page, browser, "ia2ap", approverRole, I_A2_APPROVER_PERMISSIONS, I_A2_APPROVER_MENUS,
    );
    expect(a2Approver.accountId).not.toBe(String(existingMaker.accountId));
    expect(a2Approver.accountId).not.toBe(String(existingI6Checker.accountId));
    await verifyNormalActor(
      browser, a2Approver, "/api/admin/platform/audit/overview", "/api/admin/users/overview", "I A2 approver",
    );

    const previousCleanup = objectRecord(existingI.cleanup, "I_CLEANUP");
    const incrementalCleanup = cleanupPlan([a2Approver], [approverRole]);
    const generatedAt = new Date().toISOString();
    writeRestrictedJson(I_MANIFEST, {
      ...existingI,
      generatedAt,
      accounts: { ...existingAccounts, a2Approver },
      a2Approver,
      a2ApproverRole: publicRole(approverRole),
      dualOperator: {
        makerAccountId: String(existingMaker.accountId),
        i6CheckerAccountId: String(existingI6Checker.accountId),
        a2ApproverAccountId: a2Approver.accountId,
        allDistinct: true,
        exactMenus: ["A", "A2"],
        contentApprovalScopes: ["I3", "I4", "I5"],
      },
      cleanup: {
        ...previousCleanup,
        required: true,
        accounts: [...objectArray(previousCleanup.accounts), ...incrementalCleanup.accounts],
        roles: [...objectArray(previousCleanup.roles), ...incrementalCleanup.roles],
      },
    });
    filesChanged = true;
    const safeManifests = objectArray(existingSafe.manifests).map((entry) => {
      const row = objectRecord(entry, "SAFE_MANIFEST_ENTRY");
      return row.file === path.basename(I_MANIFEST) ? { ...row, sha256: fileSha256(I_MANIFEST) } : row;
    });
    writeRestrictedJson(SAFE_SUMMARY, {
      ...existingSafe,
      generatedAt,
      manifests: safeManifests,
      actors: [...objectArray(existingSafe.actors), { accountId: a2Approver.accountId, username: a2Approver.username }],
      roles: [...objectArray(existingSafe.roles), { roleId: approverRole.id, roleCode: approverRole.code }],
      iApprovalActor: { independent: true, normalMfa: true, exactMenus: ["A", "A2"], allDistinct: true },
      status: "READY",
    });
    completed = true;
  } catch (error) {
    await cleanupFailedProvision(page).catch(() => undefined);
    if (filesChanged) {
      writeRestrictedText(I_MANIFEST, originalIText);
      writeRestrictedText(SAFE_SUMMARY, originalSafeText);
    }
    throw error;
  } finally {
    if (!completed && filesChanged) {
      writeRestrictedText(I_MANIFEST, originalIText);
      writeRestrictedText(SAFE_SUMMARY, originalSafeText);
    }
    await reviewerContext.close();
  }
});

test("Final7 adds A2-A4 audit reader and leaves one E6 cross-domain A6 grant pending", async ({ page, browser }) => {
  expect(token, "controller-issued expanded-tail critical-section token is required").toBe(expectedExpandedTailToken);
  validateStaticScope();
  verifyCandidateAndListeners();
  restrictDirectoryAcl(outputDir);
  for (const file of [A_AUDIT_READER_MANIFEST, A_AUDIT_READER_SAFE_SUMMARY, E6_CROSS_PENDING_MANIFEST]) {
    if (existsSync(file)) throw new Error(`FINAL7_EXPANDED_TAIL_OUTPUT_ALREADY_EXISTS:${path.basename(file)}`);
  }
  const sourceA = readManifest(sourceAManifestPath);
  expect(sourceA.runId).toBe(runId);
  const fixtureAdmin = credential(sourceA.actors?.maker, "SOURCE_A_MAKER");
  const reviewer = credential(sourceA.actors?.checker, "SOURCE_A_REVIEWER");
  const reviewerContext = await browser.newContext({ baseURL: baseUrl });
  const reviewerPage = await reviewerContext.newPage();
  let pendingOperationId = "";
  let completed = false;
  try {
    await loginMfa(page, fixtureAdmin);
    await assertSourceAdmin(page, fixtureAdmin.username);
    await loginMfa(reviewerPage, reviewer);
    await assertSourceAdmin(reviewerPage, reviewer.username);

    const readerCreated = await createRoleVisible(page, A_AUDIT_READER_ROLE);
    const readerRole: RoleRuntime = { ...A_AUDIT_READER_ROLE, id: readerCreated.id, grantOperationId: "" };
    createdRoles.push(readerRole);
    readerRole.grantOperationId = await grantRoleVisible(page, readerCreated, readerRole.permissions, readerRole.menus);
    await approveVisibleA2(reviewerPage, readerRole.grantOperationId);
    await assertRoleGrantExact(page, readerRole);
    const auditReader = await provisionVisibleAccount(
      page, browser, "a24r", readerRole, A_AUDIT_READER_PERMISSIONS, A_AUDIT_READER_MENUS,
    );
    await verifyNormalActor(
      browser, auditReader, "/api/admin/platform/audit/overview", "/api/admin/users/overview", "A2-A4 audit reader",
    );
    const auditContext = await browser.newContext({ baseURL: baseUrl });
    try {
      const auditPage = await auditContext.newPage();
      await loginMfa(auditPage, auditReader);
      expect((await auditPage.request.get("/api/admin/platform/events/overview")).status(), "A4 audit read").toBe(200);
      expect((await auditPage.request.post("/api/admin/auth/logout")).status()).toBe(200);
      expect((await auditPage.request.get("/api/admin/auth/session")).status()).toBe(401);
    } finally {
      await auditContext.close();
    }

    const pendingCreated = await createRoleVisible(page, E6_CROSS_PENDING_ROLE);
    const pendingRole: RoleRuntime = { ...E6_CROSS_PENDING_ROLE, id: pendingCreated.id, grantOperationId: "" };
    createdRoles.push(pendingRole);
    pendingOperationId = await grantRoleVisible(page, pendingCreated, pendingRole.permissions, pendingRole.menus);
    pendingRole.grantOperationId = pendingOperationId;
    await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
    await page.reload({ waitUntil: "domcontentloaded" });
    const pendingRow = page.locator("tbody tr").filter({ hasText: pendingOperationId }).first();
    await expect(pendingRow, `pending probe ${pendingOperationId} must be visible`).toBeVisible({ timeout: 30_000 });
    await expect(pendingRow.getByRole("button", { name: "执行", exact: true })).toBeVisible();
    await expect(pendingRow.getByRole("button", { name: "取消", exact: true })).toBeVisible();

    const generatedAt = new Date().toISOString();
    const candidate = candidateBinding();
    writeRestrictedJson(A_AUDIT_READER_MANIFEST, {
      sensitive: true,
      doNotUpload: true,
      runId,
      generatedAt,
      candidate,
      source: "Final7 visible A1/A6/A2 independent normal-MFA A2/A4 read-only audit actor",
      actors: { auditReader },
      roles: [publicRole(readerRole)],
      cleanup: cleanupPlan([auditReader], [readerRole]),
    });
    writeRestrictedJson(A_AUDIT_READER_SAFE_SUMMARY, {
      runId,
      generatedAt,
      candidate,
      manifest: { file: path.basename(A_AUDIT_READER_MANIFEST), sha256: fileSha256(A_AUDIT_READER_MANIFEST) },
      actor: { accountId: auditReader.accountId, username: auditReader.username, manifestField: "actors.auditReader" },
      role: { roleId: readerRole.id, roleCode: readerRole.code },
      exactPermissions: [...A_AUDIT_READER_PERMISSIONS],
      exactMenus: [...A_AUDIT_READER_MENUS],
      normalMfa: true,
      businessWriteAuthorities: 0,
      status: "READY",
    });
    writeRestrictedJson(E6_CROSS_PENDING_MANIFEST, {
      sensitive: true,
      doNotUpload: true,
      runId,
      generatedAt,
      candidate,
      purpose: "E6 checker cross-domain A6 approval must fail 403 before independent A reviewer rejection",
      pendingOperation: {
        operationId: pendingOperationId,
        expectedInitialStatus: "pending",
        expectedECheckerApproveStatus: 403,
        businessDomain: "A6",
        roleId: pendingRole.id,
        roleCode: pendingRole.code,
      },
      pendingRole: publicRole(pendingRole),
      cleanup: { required: true, order: ["E checker 403 probe", "visible A2 reject by independent A reviewer", "confirm object lock zero", "exact disposable role delete"] },
      status: "PENDING_E_CHECKER_NEGATIVE_PROBE",
    });
    completed = true;
  } catch (error) {
    if (pendingOperationId) await rejectVisibleA2(reviewerPage, pendingOperationId).catch(() => undefined);
    await cleanupFailedProvision(page).catch(() => undefined);
    for (const file of [A_AUDIT_READER_MANIFEST, A_AUDIT_READER_SAFE_SUMMARY, E6_CROSS_PENDING_MANIFEST]) {
      if (existsSync(file)) unlinkSync(file);
    }
    throw error;
  } finally {
    if (!completed) {
      for (const file of [A_AUDIT_READER_MANIFEST, A_AUDIT_READER_SAFE_SUMMARY, E6_CROSS_PENDING_MANIFEST]) {
        if (existsSync(file)) unlinkSync(file);
      }
    }
    await reviewerContext.close();
  }
});

test("Final7 visibly rejects E6 probe and two pre-existing A tickets after E checker 403", async ({ page }) => {
  expect(token, "controller-issued expanded cleanup token is required").toBe(expectedExpandedCleanupToken);
  validateStaticScope();
  verifyCandidateAndListeners();
  restrictDirectoryAcl(outputDir);
  if (!existsSync(E6_CROSS_PENDING_MANIFEST)) throw new Error("FINAL7_E6_CROSS_PENDING_MANIFEST_MISSING");
  const manifest = JSON.parse(readFileSync(E6_CROSS_PENDING_MANIFEST, "utf8")) as Record<string, unknown>;
  expect(manifest.runId).toBe(runId);
  expect(manifest.status).toBe("PENDING_E_CHECKER_NEGATIVE_PROBE");
  const pendingOperation = objectRecord(manifest.pendingOperation, "E6_PENDING_OPERATION");
  const probeOperationId = String(pendingOperation.operationId ?? "");
  expect(probeOperationId).toMatch(/^WO-[0-9-]+$/);
  const pendingRoleId = Number(pendingOperation.roleId);
  const pendingRoleCode = String(pendingOperation.roleCode ?? "");
  expect(pendingRoleId).toBeGreaterThan(0);
  validateIdentifier(pendingRoleCode, "pending role code");

  const sourceA = readManifest(sourceAManifestPath);
  expect(sourceA.runId).toBe(runId);
  const reviewer = credential(sourceA.actors?.checker, "SOURCE_A_REVIEWER");
  await loginMfa(page, reviewer);
  await assertSourceAdmin(page, reviewer.username);

  const preexistingPollution = [
    { operationId: "WO-260724122231653-700", target: "role:3461" },
    { operationId: "WO-260730000609294-300", target: "account:99743" },
  ];
  const rejected: Array<Record<string, unknown>> = [];
  for (const item of [{ operationId: probeOperationId, target: `role:${pendingRoleId}` }, ...preexistingPollution]) {
    expect(ticketStatus(item.operationId), `${item.operationId} must start pending`).toBe("pending");
    await rejectVisibleA2(page, item.operationId);
    expect(ticketStatus(item.operationId), `${item.operationId} rejected`).toBe("rejected");
    expect(activeTicketLocks(item.operationId), `${item.operationId} lock released`).toBe(0);
    rejected.push({ ...item, finalStatus: "rejected", activeLocks: 0, visibleA2: true });
  }

  deleteDatabaseRoleByIdAndCode(pendingRoleId, pendingRoleCode);
  expect(databaseRoleResidualByCode(pendingRoleCode), "E6 disposable pending role residual").toBe(0);
  const generatedAt = new Date().toISOString();
  writeRestrictedJson(E6_CROSS_PENDING_MANIFEST, {
    ...manifest,
    generatedAt,
    eCheckerNegativeEvidence: {
      file: "E/final7-owner/xdom-api-negative/safe-summary.json",
      approveAttempts: 1,
      httpStatus: 403,
      code: 403,
      ticketStayedPending: true,
      grantStayedEmpty: true,
    },
    rejected,
    preexistingPollution: {
      classification: "SNAPSHOT_PRECONDITION_POLLUTION",
      tickets: preexistingPollution,
      productDefectsCreatedByThisWave: 0,
    },
    cleanup: {
      required: false,
      completed: true,
      visibleA2Rejected: rejected.map((item) => item.operationId),
      disposableRoleDeleted: { roleId: pendingRoleId, roleCode: pendingRoleCode, residual: 0 },
      activeLocksForRejectedTickets: 0,
    },
    status: "REJECTED_AND_CLEANED",
  });
});

test("Final10 global fixture batch creates only new B/F/H/M actors through visible A1/A6/A2", async ({ page, browser }) => {
  expect(token, "controller-issued GLOBAL_FIXTURE_BATCH_LOCK token is required").toBe(expectedGlobalFixtureBatchToken);
  expect(process.env.GLOBAL_FIXTURE_BATCH_FINAL10_LOCK).toBe("GRANTED-20260801-1906");
  validateStaticScope();
  verifyFinal10RuntimeLock();
  for (const source of [globalFixtureSourcePath, globalBSourcePath, globalHSourcePath]) assertRestrictedSource(source);
  mkdirSync(outputDir, { recursive: true });
  restrictDirectoryAcl(outputDir);
  for (const file of GLOBAL_FINAL9_OUTPUTS) if (existsSync(file)) throw new Error(`FINAL9_OUTPUT_ALREADY_EXISTS:${path.basename(file)}`);

  const sourceGlobalText = readFileSync(globalFixtureSourcePath, "utf8");
  const sourceBText = readFileSync(globalBSourcePath, "utf8");
  const sourceHText = readFileSync(globalHSourcePath, "utf8");
  const sourceGlobal = JSON.parse(sourceGlobalText) as SourceManifest & {
    bootstrapCleanup?: Partial<Credential>;
    finalAccounts?: { a6_reviewer?: Partial<Credential> };
  };
  const sourceB = JSON.parse(sourceBText) as SourceManifest;
  const sourceH = JSON.parse(sourceHText) as SourceManifest;
  expect(sourceGlobal.runId).toBe(runId);
  expect(sourceB.runId).toBe(runId);
  expect(sourceH.runId).toBe(runId);
  const maker = credential(sourceGlobal.bootstrapCleanup, "FINAL9_GLOBAL_MAKER");
  const reviewer = credential(sourceGlobal.finalAccounts?.a6_reviewer, "FINAL9_GLOBAL_REVIEWER");
  expect(maker.username).not.toBe(reviewer.username);
  const oldHashes = {
    global: createHash("sha256").update(sourceGlobalText).digest("hex").toUpperCase(),
    B: createHash("sha256").update(sourceBText).digest("hex").toUpperCase(),
    H: createHash("sha256").update(sourceHText).digest("hex").toUpperCase(),
  };
  const reviewerContext = await browser.newContext({ baseURL: baseUrl });
  const reviewerPage = await reviewerContext.newPage();
  const pending = new Set<string>();
  let completed = false;
  try {
    await loginMfa(page, maker);
    await assertFinal9ProvisioningMaker(page, maker.username);
    await loginMfa(reviewerPage, reviewer);
    await assertFinal9ProvisioningReviewer(reviewerPage, reviewer.username);

    const specs = [
      B_FINAL9_MAKER_ROLE, B_FINAL9_SECOND_ROLE, F1_FINAL9_CHECKER_ROLE,
      F25_FINAL9_CHECKER_ROLE, H3_FINAL9_SECOND_ROLE, H8_FINAL9_CHECKER_ROLE,
    ] as const;
    const roles = new Map<string, RoleRuntime>();
    for (const spec of specs) {
      const created = await createRoleVisible(page, spec);
      const runtime: RoleRuntime = { ...spec, id: created.id, grantOperationId: "" };
      createdRoles.push(runtime);
      const operationId = await grantRoleVisible(page, created, spec.permissions, spec.menus);
      pending.add(operationId);
      await assertSelfApprovalDeniedFinal9(page, operationId);
      await approveVisibleA2(reviewerPage, operationId);
      pending.delete(operationId);
      runtime.grantOperationId = operationId;
      await assertRoleGrantExact(page, runtime);
      expect(ticketStatus(operationId)).toBe("approved");
      expect(activeTicketLocks(operationId)).toBe(0);
      roles.set(spec.code, runtime);
    }

    const bMaker = await provisionFinal9Account(page, browser, "bmaker", roles.get(B_FINAL9_MAKER_ROLE.code)!, B_FINAL9_MAKER_PERMISSIONS, B_FINAL9_MAKER_MENUS);
    const bSecondWriter = await provisionFinal9Account(page, browser, "b23w2", roles.get(B_FINAL9_SECOND_ROLE.code)!, B_FINAL9_SECOND_PERMISSIONS, B_FINAL9_SECOND_MENUS);
    const f1Checker = await provisionFinal9Account(page, browser, "f1ck", roles.get(F1_FINAL9_CHECKER_ROLE.code)!, F1_FINAL9_CHECKER_PERMISSIONS, F1_FINAL9_CHECKER_MENUS);
    const f25Checker = await provisionFinal9Account(page, browser, "f25ck", roles.get(F25_FINAL9_CHECKER_ROLE.code)!, F25_FINAL9_CHECKER_PERMISSIONS, F25_FINAL9_CHECKER_MENUS);
    const h3SecondWriter = await provisionFinal9Account(page, browser, "h3w2", roles.get(H3_FINAL9_SECOND_ROLE.code)!, H3_FINAL9_SECOND_PERMISSIONS, H3_FINAL9_SECOND_MENUS);
    const h8Checker = await provisionFinal9Account(page, browser, "h8ck", roles.get(H8_FINAL9_CHECKER_ROLE.code)!, H8_FINAL9_CHECKER_PERMISSIONS, H8_FINAL9_CHECKER_MENUS);
    const mSupportSupervisor = await provisionFinal9SupportAccount(page, browser);
    const supportProfile = await assignFinal9SupportSupervisorVisible(page, mSupportSupervisor.accountId);

    const verification = {
      bMaker: await verifyFinal9Actor(browser, bMaker, "/api/admin/treasury/b-domain", "/api/admin/emergency/kill-switches"),
      bSecondWriter: await verifyFinal9Actor(browser, bSecondWriter, "/api/admin/treasury/forecast-config", "/api/admin/emergency/kill-switches"),
      f1Checker: await verifyFinal9Actor(browser, f1Checker, "/api/admin/teams/ranks", "/api/admin/devices/overview"),
      f25Checker: await verifyFinal9Actor(browser, f25Checker, "/api/admin/teams/rates", "/api/admin/devices/overview"),
      h3SecondWriter: await verifyFinal9Actor(browser, h3SecondWriter, "/api/admin/growth/quest-events/tasks", "/api/admin/devices/overview"),
      h8Checker: await verifyFinal9Actor(browser, h8Checker, "/api/admin/growth/referral-rewards", "/api/admin/devices/overview"),
      mSupportSupervisor: await verifyFinal9Actor(browser, mSupportSupervisor, "/api/admin/content/support-agents", "/api/admin/platform/roles/overview"),
    };
    const candidate = candidateBinding();
    const generatedAt = new Date().toISOString();
    const oldBAccounts = objectRecord(sourceB.accounts, "FINAL9_SOURCE_B_ACCOUNTS");
    const oldHAccounts = objectRecord(sourceH.accounts, "FINAL9_SOURCE_H_ACCOUNTS");
    const reviewerSession = await currentSessionAfterLogin(browser, reviewer);
    const reviewerBinding = { ...reviewer, roleCode: reviewerSession.roleCode };

    writeRestrictedJson(B_FINAL9_MANIFEST, {
      ...sourceB, sensitive: true, doNotUpload: true, runId, generatedAt, candidate,
      source: "Final10 visible A1/A6/A2 new B maker and B2/B3 second writer; old actors unchanged",
      accounts: { ...oldBAccounts, maker: bMaker, secondWriter: bSecondWriter },
      roles: [publicRole(roles.get(B_FINAL9_MAKER_ROLE.code)!), publicRole(roles.get(B_FINAL9_SECOND_ROLE.code)!)],
      verification: { maker: verification.bMaker, secondWriter: verification.bSecondWriter },
      cleanup: cleanupPlan([bMaker, bSecondWriter], [roles.get(B_FINAL9_MAKER_ROLE.code)!, roles.get(B_FINAL9_SECOND_ROLE.code)!]),
    });
    writeRestrictedJson(F_FINAL9_MANIFEST, {
      sensitive: true, doNotUpload: true, runId, generatedAt, candidate,
      source: "Final10 visible A1/A6/A2 new independent F1 and F2-F5 checkers",
      finalAccounts: { a6_reviewer: reviewerBinding, f1_checker: f1Checker, f25_checker: f25Checker },
      roles: { f1_checker: publicRole(roles.get(F1_FINAL9_CHECKER_ROLE.code)!), f25_checker: publicRole(roles.get(F25_FINAL9_CHECKER_ROLE.code)!) },
      permissionReasons: {
        f1_checker: "network_f1_write is required by delegated F1 A2 execution; no F2-F5 authority",
        f25_checker: "module-specific F2-F5 decision authorities are required by delegated A2 execution; no F1 authority",
      },
      verification: { f1_checker: verification.f1Checker, f25_checker: verification.f25Checker },
      cleanup: cleanupPlan([f1Checker, f25Checker], [roles.get(F1_FINAL9_CHECKER_ROLE.code)!, roles.get(F25_FINAL9_CHECKER_ROLE.code)!]),
    });
    writeRestrictedJson(H_FINAL9_MANIFEST, {
      ...sourceH, sensitive: true, doNotUpload: true, runId, generatedAt, candidate,
      source: "Final10 visible A1/A6/A2 new H3 second writer and H8 checker; old actors unchanged",
      accounts: { ...oldHAccounts, secondWriter: h3SecondWriter }, checker: h8Checker,
      roles: [publicRole(roles.get(H3_FINAL9_SECOND_ROLE.code)!), publicRole(roles.get(H8_FINAL9_CHECKER_ROLE.code)!)],
      permissionReasons: { h8_checker: "growth_h8_settle is required by delegated H8 A2 execution; no other H mutation authority" },
      verification: { secondWriter: verification.h3SecondWriter, checker: verification.h8Checker },
      cleanup: cleanupPlan([h3SecondWriter, h8Checker], [roles.get(H3_FINAL9_SECOND_ROLE.code)!, roles.get(H8_FINAL9_CHECKER_ROLE.code)!]),
    });
    writeRestrictedJson(M_FINAL9_MANIFEST, {
      sensitive: true, doNotUpload: true, runId, createdForRun: true, generatedAt, candidate,
      source: "Final10 visible A1 account plus visible M1 profile; existing SUPPORT role is unchanged",
      supportSupervisor: { ...mSupportSupervisor, role: "SUPPORT", createdForRun: true },
      account: { ...mSupportSupervisor, role: "SUPPORT", createdForRun: true }, profile: supportProfile,
      verification: verification.mSupportSupervisor,
      cleanup: { ...cleanupPlan([mSupportSupervisor], []), profile: { adminId: supportProfile.adminId, profileId: supportProfile.id, expectedBefore: "automatic-general-seat", order: ["exact new profile delete"] } },
    });
    expect(fileSha256(globalFixtureSourcePath)).toBe(oldHashes.global);
    expect(fileSha256(globalBSourcePath)).toBe(oldHashes.B);
    expect(fileSha256(globalHSourcePath)).toBe(oldHashes.H);
    const grantOperationIds = [...roles.values()].map((runtime) => runtime.grantOperationId);
    expect(grantOperationIds.every((id) => ticketStatus(id) === "approved")).toBe(true);
    expect(grantOperationIds.reduce((sum, id) => sum + activeTicketLocks(id), 0)).toBe(0);
    writeRestrictedJson(GLOBAL_FINAL9_SAFE_SUMMARY, {
      runId, generatedAt, candidate, status: "READY", lock: "GLOBAL_FIXTURE_BATCH_FINAL10_LOCK",
      writes: { rolesCreated: 6, accountsCreated: 7, supportProfilesCreated: 1, oldObjectsModified: 0, globalConfigWrites: 0 },
      a2: { pending: 0, activeLocks: 0, approvedGrantOperations: grantOperationIds.length, makerSelfApprovalDenied: grantOperationIds.length },
      sessions: { activeForNewActors: 0, normalMfaActors: 7 },
      manifests: GLOBAL_FINAL9_OUTPUTS.slice(0, 4).map((file) => ({ file: path.basename(file), sha256: fileSha256(file) })),
      oldSourceHashesUnchanged: oldHashes, acl: { inherited: false, allowlistOnly: true },
    });
    completed = true;
  } finally {
    if (!completed) {
      for (const operationId of pending) await rejectVisibleA2(reviewerPage, operationId).catch(() => undefined);
      for (const file of GLOBAL_FINAL9_OUTPUTS) if (existsSync(file)) unlinkSync(file);
    }
    await reviewerContext.close();
  }
});

test("Final10 global fixture batch restricted trace replay", async ({ browser }) => {
  test.skip(process.env.FINAL10_TRACE_VERIFY !== "1", "Final10 restricted trace replay is explicitly gated");
  expect(token).toBe(expectedGlobalFixtureBatchToken);
  expect(process.env.GLOBAL_FIXTURE_BATCH_FINAL10_LOCK).toBe("GRANTED-20260801-1906");
  validateStaticScope();
  verifyFinal10RuntimeLock();

  const b = readManifest(B_FINAL9_MANIFEST) as SourceManifest & { accounts?: Record<string, unknown> };
  const f = readManifest(F_FINAL9_MANIFEST) as SourceManifest & { finalAccounts?: Record<string, unknown> };
  const h = readManifest(H_FINAL9_MANIFEST) as SourceManifest & { accounts?: Record<string, unknown>; checker?: unknown };
  const m = readManifest(M_FINAL9_MANIFEST) as SourceManifest & { account?: unknown };
  const replay = [
    [final10ManifestActor(b.accounts?.maker, "B_MAKER"), "/api/admin/treasury/b-domain", "/api/admin/emergency/kill-switches"],
    [final10ManifestActor(b.accounts?.secondWriter, "B_SECOND_WRITER"), "/api/admin/treasury/forecast-config", "/api/admin/emergency/kill-switches"],
    [final10ManifestActor(f.finalAccounts?.f1_checker, "F1_CHECKER"), "/api/admin/teams/ranks", "/api/admin/devices/overview"],
    [final10ManifestActor(f.finalAccounts?.f25_checker, "F25_CHECKER"), "/api/admin/teams/rates", "/api/admin/devices/overview"],
    [final10ManifestActor(h.accounts?.secondWriter, "H3_SECOND_WRITER"), "/api/admin/growth/quest-events/tasks", "/api/admin/devices/overview"],
    [final10ManifestActor(h.checker, "H8_CHECKER"), "/api/admin/growth/referral-rewards", "/api/admin/devices/overview"],
    [final10ManifestActor(m.account, "M_SUPPORT_SUPERVISOR"), "/api/admin/content/support-agents", "/api/admin/platform/roles/overview"],
  ] as const;
  for (const [actor, readPath, crossReadPath] of replay) {
    const result = await verifyFinal9Actor(browser, actor, readPath, crossReadPath);
    expect(result).toMatchObject({ readHttp: 200, crossReadHttp: 403, directWriteHttp: 403, refreshStable: true, reloginStable: true, finalSessionHttp: 401 });
  }
});

function role(tag: string, name: string, permissions: readonly string[], menus: readonly string[]): RoleSpec {
  return { code: `ACC_F7_${tag}_${nonce.toUpperCase()}`, name: `${name} ${nonce.slice(0, 6)}`, permissions, menus };
}

function final9Role(tag: string, name: string, permissions: readonly string[], menus: readonly string[]): RoleSpec {
  return { code: `ACC_F10_${tag}_${nonce.toUpperCase()}`, name: `${name} ${nonce.slice(0, 6)}`, permissions, menus };
}

function assertRestrictedSource(file: string) {
  const base = realpathSync("D:/workspace/bug-pic/.restricted");
  const source = realpathSync(file);
  const relative = path.relative(base, source);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("FINAL9_SOURCE_MANIFEST_OUT_OF_SCOPE");
}

function final10ManifestActor(value: unknown, label: string): Provisioned {
  const row = objectRecord(value, `FINAL10_${label}`) as Record<string, unknown>;
  const base = credential(row as Partial<Credential>, `FINAL10_${label}`);
  const authorities = Array.isArray(row.authorities) ? row.authorities.map(String) : [];
  const effectiveMenus = Array.isArray(row.effectiveMenus) ? row.effectiveMenus.map(String) : [];
  const roleCode = String(row.roleCode ?? row.role ?? "");
  expect(roleCode, `${label} role code`).not.toBe("");
  expect(authorities.length, `${label} authorities`).toBeGreaterThan(0);
  expect(effectiveMenus.length, `${label} menus`).toBeGreaterThan(0);
  return { ...base, roleCode, authorities, effectiveMenus, normalMfa: true };
}

async function assertFinal9ProvisioningMaker(page: Page, username: string) {
  const session = await currentSession(page);
  expect(session.username).toBe(username);
  expect(session.roleCode).toBe("SUPER_ADMIN");
  for (const permission of ["platform_a1_write", "platform_a6_write", "platform_a6_role_grants_update"]) {
    expect(session.authorities).toContain(permission);
  }
}

async function assertFinal9ProvisioningReviewer(page: Page, username: string) {
  const session = await currentSession(page);
  expect(session.username).toBe(username);
  expect(session.roleCode).not.toBe("SUPER_ADMIN");
  for (const permission of ["platform_a2_read", "platform_a2_operation_approve", "platform_a6_role_grants_update"]) {
    expect(session.authorities).toContain(permission);
  }
}

async function assertSelfApprovalDeniedFinal9(page: Page, operationId: string) {
  await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operationId }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const response = await confirmAndWait(page, (candidate) =>
    candidate.request().method() === "POST"
      && pathOf(candidate.url()) === `/api/admin/platform/audit/operations/${operationId}/approve`);
  expect(response.status()).toBe(403);
  const body = await response.json() as { message?: string };
  expect(body.message).toBe("A2_MAKER_CHECKER_REQUIRED");
  const dialog = page.getByRole("dialog").last();
  const close = dialog.getByRole("button", { name: "关闭", exact: true });
  if (await close.isVisible().catch(() => false)) await close.click();
}

async function provisionFinal9Account(
  adminPage: Page,
  browser: Browser,
  tag: string,
  runtime: RoleRuntime,
  authorities: readonly string[],
  menus: readonly string[],
): Promise<Provisioned> {
  const username = `ffix.${tag}.final10.${nonce}`;
  plannedUsernames.add(username);
  const created = await createAccountVisible(adminPage, username, `Final10 ${tag}`, runtime.name);
  const tracked: Credential = { accountId: created.accountId, username, password: "", totpSecret: "" };
  createdAccounts.push(tracked);
  const context = await browser.newContext({ baseURL: baseUrl });
  try {
    const actorPage = await context.newPage();
    const password = `Nx!F9${randomBytes(18).toString("base64url")}Aa9`;
    const totpSecret = await activateAccount(actorPage, username, created.temporaryPassword, password);
    const actor: Provisioned = {
      accountId: created.accountId, username, password, totpSecret, roleCode: runtime.code,
      authorities: [...authorities], effectiveMenus: [...menus], normalMfa: true,
    };
    Object.assign(tracked, actor);
    await assertOnlyDomainScope(actorPage, actor);
    expect((await actorPage.request.post("/api/admin/auth/logout")).status()).toBe(200);
    return actor;
  } finally {
    await context.close();
  }
}

async function provisionFinal9SupportAccount(adminPage: Page, browser: Browser): Promise<Provisioned> {
  const username = `ffix.msup.final10.${nonce}`;
  plannedUsernames.add(username);
  const created = await createAccountVisible(adminPage, username, "Final10 M support supervisor", "客服");
  const tracked: Credential = { accountId: created.accountId, username, password: "", totpSecret: "" };
  createdAccounts.push(tracked);
  const context = await browser.newContext({ baseURL: baseUrl });
  try {
    const actorPage = await context.newPage();
    const password = `Nx!F9${randomBytes(18).toString("base64url")}Aa9`;
    const totpSecret = await activateAccount(actorPage, username, created.temporaryPassword, password);
    const session = await currentSession(actorPage);
    expect(session.roleCode).toBe("SUPPORT");
    for (const permission of ["service_m1_read", "service_m1_write", "service_m5_read", "service_m5_write"]) {
      expect(session.authorities).toContain(permission);
    }
    const actor: Provisioned = {
      accountId: created.accountId, username, password, totpSecret, roleCode: session.roleCode,
      authorities: session.authorities, effectiveMenus: session.menus, normalMfa: true,
    };
    Object.assign(tracked, actor);
    expect((await actorPage.request.post("/api/admin/auth/logout")).status()).toBe(200);
    return actor;
  } finally {
    await context.close();
  }
}

async function assignFinal9SupportSupervisorVisible(page: Page, accountId: string) {
  const before = await apiSuccess<{ agents?: Array<Record<string, unknown>> }>(
    await page.request.get("/api/admin/content/support-agents"), "M support agents before",
  );
  const beforeProfile = (before.agents ?? []).find((agent) => String(agent.adminId) === accountId);
  expect(beforeProfile, "new SUPPORT account must expose its automatic reversible M profile").toBeTruthy();
  expect(String(beforeProfile!.position ?? ""), "new SUPPORT default seat").toBe("通用客服");
  expect([...(beforeProfile!.serviceTypes as string[] ?? [])].sort(), "new SUPPORT default service types").toEqual(["support"]);
  expect(beforeProfile!.enabled, "new SUPPORT default enabled state").toBe(true);
  expect(beforeProfile!.transferable, "new SUPPORT default transfer state").toBe(true);
  const sidebar = page.locator("aside");
  const link = sidebar.locator('a[href="/service/overview"]');
  if (!await link.isVisible().catch(() => false)) await sidebar.getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).click();
  await link.click();
  await expect(page).toHaveURL(/\/service\/overview$/);
  await page.getByRole("button", { name: "分配坐席", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "分配客服坐席" });
  await dialog.getByLabel("搜索客服管理员").fill(accountId);
  const candidate = dialog.locator('[data-proof="m1-seat-admin-option"]').first();
  await expect(candidate).toBeVisible({ timeout: 30_000 });
  await candidate.click();
  const supervisorSeat = dialog.getByText("客服主管", { exact: true }).first();
  await expect(supervisorSeat).toBeVisible();
  await supervisorSeat.click();
  await dialog.getByLabel(/分配理由/).fill(reason);
  const response = page.waitForResponse((candidateResponse) =>
    candidateResponse.request().method() === "PATCH"
      && pathOf(candidateResponse.url()) === `/api/admin/content/support-agents/${accountId}/seat-assignment`);
  await dialog.locator('[data-proof="m1-seat-role-save"]').click();
  await apiSuccess(await response, "assign new Final10 support supervisor profile");
  await expect(dialog).toBeHidden();
  const after = await apiSuccess<{ agents?: Array<Record<string, unknown>> }>(
    await page.request.get("/api/admin/content/support-agents"), "M support agents after",
  );
  const profile = (after.agents ?? []).find((agent) => String(agent.adminId) === accountId);
  expect(profile).toBeTruthy();
  expect(String(profile!.adminRole ?? "").toUpperCase()).toBe("SUPPORT");
  expect(profile!.enabled).toBe(true);
  expect(profile!.transferable).toBe(true);
  expect([...(profile!.serviceTypes as string[] ?? [])].sort()).toEqual(["support"]);
  expect(String(profile!.position ?? "")).toBe("客服主管");
  return {
    id: String(profile!.id ?? ""), adminId: Number(profile!.adminId), position: String(profile!.position),
    enabled: true, transferable: true, serviceTypes: ["support"], adminRole: "SUPPORT",
    beforeAbsent: false, beforePosition: "通用客服",
  };
}

async function verifyFinal9Actor(browser: Browser, actor: Provisioned, readPath: string, crossReadPath: string) {
  const context = await browser.newContext({ baseURL: baseUrl });
  try {
    const actorPage = await context.newPage();
    await loginMfa(actorPage, actor);
    await assertOnlyDomainScope(actorPage, actor);
    const initial = await currentSession(actorPage);
    const initialHash = sessionHash(initial);
    expect((await actorPage.request.get(readPath)).status()).toBe(200);
    expect((await actorPage.request.get(crossReadPath)).status()).toBe(403);
    const directWrite = await actorPage.request.patch("/api/admin/devices/e3/config", {
      headers: { "Idempotency-Key": `${runId}:final10:${actor.accountId}:xwrite` }, data: {},
    });
    expect(directWrite.status(), "out-of-scope direct write must fail before validation").toBe(403);
    await actorPage.reload({ waitUntil: "domcontentloaded" });
    expect(sessionHash(await currentSession(actorPage))).toBe(initialHash);
    await logoutVisibleFinal9(actorPage);
    expect((await actorPage.request.get("/api/admin/auth/session")).status()).toBe(401);
    await loginMfa(actorPage, actor);
    expect(sessionHash(await currentSession(actorPage))).toBe(initialHash);
    await logoutVisibleFinal9(actorPage);
    expect((await actorPage.request.get("/api/admin/auth/session")).status()).toBe(401);
    return { accountId: actor.accountId, roleCode: actor.roleCode, normalMfa: true, readHttp: 200, crossReadHttp: 403, directWriteHttp: 403, refreshStable: true, reloginStable: true, sessionHash: initialHash, finalSessionHttp: 401 };
  } finally {
    await context.close();
  }
}

async function currentSessionAfterLogin(browser: Browser, actor: Credential) {
  const context = await browser.newContext({ baseURL: baseUrl });
  try {
    const page = await context.newPage();
    await loginMfa(page, actor);
    const session = await currentSession(page);
    await logoutVisibleFinal9(page);
    return session;
  } finally {
    await context.close();
  }
}

async function logoutVisibleFinal9(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').first();
  await account.click();
  const logout = page.getByRole("button", { name: "退出登录", exact: true }).last();
  await expect(logout).toBeVisible();
  await logout.click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

function sessionHash(session: Session) {
  return createHash("sha256").update(JSON.stringify({ roleCode: session.roleCode, authorities: [...session.authorities].sort(), menus: [...session.menus].sort() })).digest("hex").toUpperCase();
}

async function createRoleVisible(page: Page, spec: RoleSpec) {
  await nav(page, "角色管理 A6", /\/platform\/roles$/);
  expect(await page.getByText(spec.code, { exact: true }).count(), "fresh role code must be absent").toBe(0);
  await page.getByRole("button", { name: "+ 新建角色", exact: true }).click();
  await page.getByPlaceholder("如 CONTENT_EDITOR").fill(spec.code);
  await page.getByPlaceholder("如 内容编辑员").fill(spec.name);
  await page.getByPlaceholder("职责说明").fill(`${runId} disposable least-privilege fixture role`);
  await page.getByRole("button", { name: "提交（需确认）", exact: true }).click();
  const response = await confirmAndWait(page, (candidate) =>
    candidate.request().method() === "POST" && pathOf(candidate.url()) === "/api/admin/platform/roles");
  const data = await apiSuccess<Record<string, unknown>>(response, `create ${spec.code}`);
  expect(Number(data.id)).toBeGreaterThan(0);
  return { id: Number(data.id), roleCode: spec.code };
}

async function grantRoleVisible(
  page: Page,
  roleRow: { id: number; roleCode: string },
  permissions: readonly string[],
  menus: readonly string[],
) {
  await nav(page, "角色管理 A6", /\/platform\/roles$/);
  await page.getByText(roleRow.roleCode, { exact: true }).first().click();
  const editButton = page.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true });
  await expect(editButton, `visible A6 detail ${roleRow.roleCode}`).toBeEnabled({ timeout: 20_000 });
  const visibleDetail = await apiSuccess<{ id?: number; roleCode?: string }>(
    await page.request.get(`/api/admin/platform/roles/${roleRow.id}`), `visible A6 detail readback ${roleRow.roleCode}`,
  );
  expect(Number(visibleDetail.id)).toBe(roleRow.id);
  expect(visibleDetail.roleCode).toBe(roleRow.roleCode);
  await editButton.click();
  const drawer = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "保存授权（需确认）", exact: true }) });
  const search = drawer.getByLabel("权限搜索");
  for (const permission of permissions) {
    await search.fill(permission);
    const checkbox = drawer.locator(`label[title="${permission}"] input[type="checkbox"]`);
    await expect(checkbox, `A8 permission ${permission} must exist`).toHaveCount(1);
    await checkbox.check();
  }
  await search.fill("");
  await setMenusExact(drawer, menus);
  await drawer.getByRole("button", { name: "保存授权（需确认）", exact: true }).click();
  const response = await confirmAndWait(page, (candidate) =>
    candidate.request().method() === "PUT" && pathOf(candidate.url()) === `/api/admin/platform/roles/${roleRow.id}/grants`);
  const data = await apiSuccess<Record<string, unknown>>(response, `grant ${roleRow.roleCode}`);
  const operationId = String(data.operationId ?? data.id ?? "");
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  return operationId;
}

async function setMenusExact(drawer: ReturnType<Page["getByRole"]>, desiredValues: readonly string[]) {
  const desired = new Set(desiredValues);
  const panel = drawer.getByText("菜单授权（可见性）", { exact: false }).locator("xpath=parent::div");
  for (const parentCode of [...desired].filter((code) => code.length === 1)) {
    await menuCheckbox(panel, parentCode).check();
  }
  const rows = panel.locator(".row");
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    if (await row.locator("span.mono").count() === 0) continue;
    const code = (await row.locator("span.mono").last().textContent())?.trim() ?? "";
    if (!code || code.length === 1) continue;
    const checkbox = row.locator('input[type="checkbox"]');
    if (desired.has(code)) await checkbox.check();
    else if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  for (const code of [...desired].filter((value) => value.length > 1)) await menuCheckbox(panel, code).check();
}

function menuCheckbox(panel: ReturnType<Page["locator"]>, code: string) {
  return panel.getByText(code, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'row')][1]")
    .locator('input[type="checkbox"]');
}

async function approveVisibleA2(page: Page, operationId: string) {
  await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const pageSize = page.locator("select.pager-size").first();
  if (await pageSize.isVisible().catch(() => false)) await pageSize.selectOption("50");
  const row = page.locator("tbody tr").filter({ hasText: operationId }).first();
  await expect(row, `A2 operation ${operationId} must be visible`).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const response = await confirmAndWait(page, (candidate) =>
    candidate.request().method() === "POST"
      && pathOf(candidate.url()) === `/api/admin/platform/audit/operations/${operationId}/approve`);
  await apiSuccess(response, `approve ${operationId}`);
}

async function rejectVisibleA2(page: Page, operationId: string) {
  await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const pageSize = page.locator("select.pager-size").first();
  if (await pageSize.isVisible().catch(() => false)) await pageSize.selectOption("50");
  const row = page.locator("tbody tr").filter({ hasText: operationId }).first();
  await expect(row, `A2 operation ${operationId} must be visible for rejection`).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "取消", exact: true }).click();
  const response = await confirmAndWait(page, (candidate) =>
    candidate.request().method() === "POST"
      && pathOf(candidate.url()) === `/api/admin/platform/audit/operations/${operationId}/reject`);
  await apiSuccess(response, `reject ${operationId}`);
}

async function assertRoleGrantExact(page: Page, runtime: RoleRuntime) {
  const detail = await apiSuccess<{ permissionCodes?: string[]; menuIds?: number[] }>(
    await page.request.get(`/api/admin/platform/roles/${runtime.id}`), `role detail ${runtime.code}`,
  );
  expect(sameSet(detail.permissionCodes ?? [], runtime.permissions)).toBe(true);
  const menuCodes = await menuCodesByIds(page, detail.menuIds ?? []);
  expect([...menuCodes].sort(), `${runtime.code} exact menu grants`).toEqual([...runtime.menus].sort());
}

async function provisionVisibleAccount(
  adminPage: Page,
  browser: Browser,
  tag: string,
  runtime: RoleRuntime | undefined,
  authorities: readonly string[],
  menus: readonly string[],
): Promise<Provisioned> {
  const username = `ffix.${tag}.final7.${nonce}`;
  plannedUsernames.add(username);
  const created = await createAccountVisible(adminPage, username, `Final7 ${tag}`, runtime?.name);
  const tracked: Credential = { accountId: created.accountId, username, password: "", totpSecret: "" };
  createdAccounts.push(tracked);
  const context = await browser.newContext({ baseURL: baseUrl });
  try {
    const page = await context.newPage();
    const password = `Nx!F7${randomBytes(18).toString("base64url")}Aa9`;
    const totpSecret = await activateAccount(page, username, created.temporaryPassword, password);
    const actor: Provisioned = {
      accountId: created.accountId,
      username,
      password,
      totpSecret,
      roleCode: runtime?.code ?? "unassigned",
      authorities: [...authorities],
      effectiveMenus: [...menus],
      normalMfa: true,
    };
    Object.assign(tracked, actor);
    await assertOnlyDomainScope(page, actor);
    await page.request.post("/api/admin/auth/logout");
    return actor;
  } finally {
    await context.close();
  }
}

async function createAccountVisible(page: Page, username: string, displayName: string, roleName?: string) {
  await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
  await page.getByRole("button", { name: "+ 新建账号", exact: true }).click();
  const drawer = page.getByRole("dialog").last();
  await drawer.getByRole("textbox", { name: "登录名 *", exact: true }).fill(username);
  await drawer.getByPlaceholder("姓名,如:张三").fill(displayName);
  if (roleName) await drawer.getByText(roleName, { exact: true }).click();
  else await drawer.getByText("暂不分配", { exact: true }).click();
  await drawer.getByLabel(/操作理由/).fill(reason);
  const pending = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && pathOf(candidate.url()) === "/api/admin/platform/accounts");
  await drawer.getByRole("button", { name: "确认创建账号", exact: true }).click();
  const confirm = page.getByRole("dialog")
    .filter({ has: page.getByRole("button", { name: "确认提交", exact: true }) })
    .last();
  await confirm.getByLabel(/操作理由/).last().fill(reason);
  await confirm.getByRole("button", { name: "确认提交", exact: true }).click();
  const data = await apiSuccess<Record<string, unknown>>(await pending, `create ${username}`);
  const accountId = String(data.id ?? "");
  expect(accountId).toMatch(/^\d+$/);
  const credentialDialog = page.getByRole("dialog").last();
  await expect(credentialDialog.getByText("临时密码", { exact: true })).toBeVisible();
  const temporaryPassword = (await credentialDialog.locator(".mono").last().textContent())?.trim() ?? "";
  expect(temporaryPassword).not.toBe("");
  await credentialDialog.getByText("关闭", { exact: true }).click();
  return { accountId, temporaryPassword };
}

async function activateAccount(page: Page, username: string, temporaryPassword: string, finalPassword: string) {
  await gotoLogin(page);
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  const loginPending = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && pathOf(candidate.url()) === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const login = await loginPending;
  const loginBody = await login.json().catch(() => null) as { message?: string } | null;
  expect(login.status(), `first password gate ${username}: ${loginBody?.message ?? ""}`).toBe(200);
  let secret = "";
  let passwordChanged = false;
  for (let attempt = 0; attempt < 140; attempt += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) break;
    const otp = page.getByLabel("一次性验证码");
    if (await otp.isVisible().catch(() => false)) {
      secret = secret || ((await page.locator("code").first().textContent().catch(() => "")) ?? "").trim();
      expect(secret, "first login must expose a real enrollment secret").not.toBe("");
      await otp.fill(await freshTotp(secret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
    if (!passwordChanged && await page.getByRole("heading", { name: "首次登录修改密码" }).isVisible().catch(() => false)) {
      await page.getByLabel("新密码", { exact: true }).fill(finalPassword);
      await page.getByLabel("确认新密码", { exact: true }).fill(finalPassword);
      await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
      passwordChanged = true;
    }
    await page.waitForTimeout(200);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  expect(passwordChanged).toBe(true);
  return secret;
}

async function verifyNormalActor(browser: Browser, actor: Provisioned, readPath: string, crossPath: string, domain: string) {
  const context = await browser.newContext({ baseURL: baseUrl });
  try {
    const page = await context.newPage();
    await loginMfa(page, actor);
    await assertOnlyDomainScope(page, actor);
    const read = await page.request.get(readPath);
    if (actor.authorities.some((code) => code.endsWith("_read"))) expect(read.status(), `${domain} scoped read`).toBe(200);
    else expect(read.status(), `${domain} no-menu read`).toBe(403);
    expect((await page.request.get(crossPath)).status(), `${domain} cross-domain read`).toBe(403);
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertOnlyDomainScope(page, actor);
    expect((await page.request.post("/api/admin/auth/logout")).status()).toBe(200);
    expect((await page.request.get("/api/admin/auth/session")).status()).toBe(401);
  } finally {
    await context.close();
  }
}

async function diagnoseNormalMfaSession(browser: Browser, actor: Credential, attempt: number, actorLabel = "I nowrite") {
  const context = await browser.newContext({ baseURL: baseUrl });
  try {
    const page = await context.newPage();
    await gotoLogin(page);
    await page.locator('input[autocomplete="username"]').fill(actor.username);
    await page.locator('input[autocomplete="current-password"]').fill(actor.password);
    const loginPending = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST" && pathOf(candidate.url()) === "/api/admin/auth/login");
    await page.getByRole("button", { name: /登录|继续/ }).click();
    const loginResponse = await loginPending;
    const loginEnvelope = safeAuthEnvelope(await loginResponse.json().catch(() => null));
    const otp = page.getByLabel("一次性验证码");
    await expect(otp, `${actorLabel} attempt ${attempt} MFA gate`).toBeVisible({ timeout: 20_000 });
    const code = await freshTotp(actor.totpSecret);
    const totpStep = Math.floor(Date.now() / 30_000);
    const verifyPending = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST" && pathOf(candidate.url()) === "/api/admin/auth/mfa/verify");
    await otp.fill(code);
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const verifyResponse = await verifyPending;
    const verifyEnvelope = safeAuthEnvelope(await verifyResponse.json().catch(() => null));
    const shellVisible = await page.locator("aside").isVisible({ timeout: 20_000 }).catch(() => false);
    const cookiesBeforeSession = await context.cookies();
    const cookieMetadata = cookiesBeforeSession.map(({ name, domain, path: cookiePath, expires, httpOnly, secure, sameSite }) => ({
      name, domain, path: cookiePath, expires, httpOnly, secure, sameSite,
    }));
    const sessionResponse = await page.request.get("/api/admin/auth/session");
    const sessionPayload = await sessionResponse.json().catch(() => null) as { code?: number; message?: string; data?: Partial<Session> } | null;
    const sessionSummary = sessionResponse.status() === 200 && sessionPayload?.data
      ? {
          usernameMatches: sessionPayload.data.username === actor.username,
          roleCode: sessionPayload.data.roleCode,
          authorityCount: sessionPayload.data.authorities?.length ?? 0,
          menuCount: sessionPayload.data.menus?.length ?? 0,
        }
      : undefined;
    const logoutResponse = sessionResponse.status() === 200
      ? await page.request.post("/api/admin/auth/logout")
      : undefined;
    const afterLogoutSession = await page.request.get("/api/admin/auth/session");
    const cookiesAfterLogout = await context.cookies();
    return {
      attempt,
      totpStep,
      loginStatus: loginResponse.status(),
      loginEnvelope,
      mfaVerifyStatus: verifyResponse.status(),
      mfaVerifyEnvelope: verifyEnvelope,
      shellVisible,
      cookieMetadata,
      sessionStatus: sessionResponse.status(),
      sessionEnvelope: safeAuthEnvelope(sessionPayload),
      sessionSummary,
      logoutStatus: logoutResponse?.status() ?? null,
      afterLogoutSessionStatus: afterLogoutSession.status(),
      cookieNamesAfterLogout: cookiesAfterLogout.map(({ name }) => name),
    };
  } finally {
    await context.close();
  }
}

function safeAuthEnvelope(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { code: null, message: "INVALID_ENVELOPE" };
  const envelope = value as { code?: unknown; message?: unknown };
  return {
    code: typeof envelope.code === "number" ? envelope.code : null,
    message: typeof envelope.message === "string" ? envelope.message : null,
  };
}

async function assertOnlyDomainScope(page: Page, actor: Provisioned) {
  const session = await currentSession(page);
  expect(session.username).toBe(actor.username);
  expect(session.roleCode).not.toBe("SUPER_ADMIN");
  expect(sameSet(session.authorities, actor.authorities), `${actor.username} authorities`).toBe(true);
  expect(sameSet(session.menus, actor.effectiveMenus), `${actor.username} menus`).toBe(true);
}

async function loginMfa(page: Page, actor: Pick<Credential, "username" | "password" | "totpSecret">) {
  await gotoLogin(page);
  await page.waitForLoadState("load");
  const username = page.locator('input[autocomplete="username"]');
  const password = page.locator('input[autocomplete="current-password"]');
  await username.click();
  await username.fill("");
  await username.pressSequentially(actor.username, { delay: 10 });
  await password.click();
  await password.fill("");
  await password.pressSequentially(actor.password, { delay: 5 });
  // Real key events after page load keep the production controlled form and DOM in sync.
  await expect(username).toHaveValue(actor.username);
  await expect(password).toHaveValue(actor.password);
  const otp = page.getByLabel("一次性验证码");
  const shell = page.locator("aside");
  const loginSignal = Promise.race([
    page.waitForResponse((candidate) =>
      candidate.request().method() === "POST" && pathOf(candidate.url()) === "/api/admin/auth/login", { timeout: 20_000 })
      .then((response) => ({ kind: "response" as const, response })),
    otp.waitFor({ state: "visible", timeout: 20_000 }).then(() => ({ kind: "mfa" as const })),
    shell.waitFor({ state: "visible", timeout: 20_000 }).then(() => ({ kind: "shell" as const })),
  ]);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const signal = await loginSignal;
  if (signal.kind === "response") expect(signal.response.status(), `password gate ${actor.username}`).toBe(200);
  if (await shell.isVisible().catch(() => false)) {
    expect((await currentSession(page)).username, `direct shell identity ${actor.username}`).toBe(actor.username);
    return;
  }
  await expect(otp, `MFA gate ${actor.username}`).toBeVisible({ timeout: 20_000 });
  await otp.fill(await freshTotp(actor.totpSecret));
  const verifyPending = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && pathOf(candidate.url()) === "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  expect((await verifyPending).status(), `MFA verify ${actor.username}`).toBe(200);
  await expect(shell).toBeVisible({ timeout: 30_000 });
}

async function assertSourceAdmin(page: Page, username: string) {
  const session = await currentSession(page);
  expect(session.username).toBe(username);
  expect(session.roleCode).toBe("SUPER_ADMIN");
  for (const permission of ["platform_a1_write", "platform_a2_operation_approve", "platform_a6_role_grants_update"]) {
    expect(session.authorities).toContain(permission);
  }
}

async function currentSession(page: Page): Promise<Session> {
  const data = await apiSuccess<{ session?: { username?: string; roleCode?: string; authorities?: string[]; menuCodes?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> } }>(
    await page.request.get("/api/admin/auth/session"), "auth session",
  );
  const session = data.session ?? {};
  return {
    username: String(session.username ?? ""),
    roleCode: String(session.roleCode ?? ""),
    authorities: [...(session.authorities ?? [])],
    menus: [...new Set((session.menuCodes ?? session.effectiveMenus ?? []).map((value) =>
      typeof value === "string" ? value : value.menuCode ?? "").filter(Boolean))],
  };
}

async function menuCodesByIds(page: Page, ids: number[]) {
  const data = await apiSuccess<{ tree?: unknown[]; menus?: unknown[] }>(
    await page.request.get("/api/admin/platform/menus/overview"), "A7 menu tree",
  );
  const rows = flattenMenus(data.tree ?? data.menus ?? data);
  const byId = new Map(rows.map((row) => [Number(row.id), String(row.menuCode ?? "")]));
  return ids.map((id) => byId.get(Number(id)) ?? "").filter(Boolean);
}

async function permissionIdByCode(page: Page, permissionCode: string) {
  const data = await apiSuccess<Record<string, unknown>>(
    await page.request.get(`/api/admin/platform/permissions/${encodeURIComponent(permissionCode)}`), "A8 permission detail",
  );
  expect(data.permissionCode).toBe(permissionCode);
  validateIdentifier(permissionCode, "permission code");
  const id = Number(mysql(`SELECT id FROM nx_admin_permission WHERE permission_code='${permissionCode}' AND is_deleted=0 LIMIT 1;`));
  expect(id, `${permissionCode} permission id`).toBeGreaterThan(0);
  return id;
}

async function cleanupFailedProvision(page: Page) {
  for (const actor of [...createdAccounts].reverse()) {
    await bestEffortProductRetire(page, actor).catch(() => undefined);
    deleteExactDatabaseAccount(actor);
  }
  for (const roleRow of [...createdRoles].reverse()) deleteExactDatabaseRole(roleRow);
  for (const username of plannedUsernames) deleteDatabaseAccountByUsername(username);
  for (const spec of ALL_ROLE_SPECS) deleteDatabaseRoleByCode(spec.code);
  for (const actor of createdAccounts) expect(databaseAccountResidual(actor)).toBe(0);
  for (const roleRow of createdRoles) expect(databaseRoleResidual(roleRow)).toBe(0);
  for (const username of plannedUsernames) expect(databaseAccountResidualByUsername(username)).toBe(0);
  for (const spec of ALL_ROLE_SPECS) expect(databaseRoleResidualByCode(spec.code)).toBe(0);
}

async function bestEffortProductRetire(page: Page, actor: Credential) {
  const overview = await apiSuccess<{ operators?: Array<Record<string, unknown>> }>(
    await page.request.get("/api/admin/platform/accounts/overview"), "cleanup account overview",
  );
  let row = (overview.operators ?? []).find((candidate) => String(candidate.id) === actor.accountId);
  if (!row) return;
  for (const [method, suffix, data] of [
    ["POST", "sessions/revoke", {}],
    ["POST", "reset-2fa", {}],
    ["PATCH", "role", { role: "unassigned" }],
    ["PATCH", "status", { status: "disabled" }],
  ] as const) {
    const response = await page.request.fetch(`/api/admin/platform/accounts/${actor.accountId}/${suffix}`, {
      method,
      headers: { "Idempotency-Key": `${runId}:failed-cleanup:${actor.accountId}:${suffix}:${Date.now()}` },
      data: { ...data, operator: "final7-fixture-cleanup", reason, expectedVersion: String(row.version) },
    });
    if (response.status() >= 400) continue;
    const next = await apiSuccess<{ operators?: Array<Record<string, unknown>> }>(
      await page.request.get("/api/admin/platform/accounts/overview"), "cleanup account refresh",
    );
    row = (next.operators ?? []).find((candidate) => String(candidate.id) === actor.accountId) ?? row;
  }
}

function deleteExactDatabaseAccount(actor: Credential) {
  validateUsername(actor.username);
  const id = exactId(actor.accountId);
  mysql(`DELETE FROM nx_admin_role_relation WHERE admin_id=${id}; DELETE FROM nx_admin_account_state WHERE admin_id=${id}; DELETE FROM nx_admin WHERE id=${id} AND username='${actor.username}';`);
}

function deleteExactDatabaseRole(roleRow: RoleRuntime) {
  validateIdentifier(roleRow.code, "role code");
  mysql(`DELETE FROM nx_admin_role_relation WHERE role_id=${roleRow.id}; DELETE FROM nx_admin_role_menu WHERE role_id=${roleRow.id}; DELETE FROM nx_admin_role_permission WHERE role_id=${roleRow.id}; DELETE FROM nx_admin_role WHERE id=${roleRow.id} AND role_code='${roleRow.code}';`);
}

function deleteDatabaseAccountByUsername(username: string) {
  validateUsername(username);
  mysql(`DELETE rr FROM nx_admin_role_relation rr JOIN nx_admin a ON a.id=rr.admin_id WHERE a.username='${username}'; DELETE s FROM nx_admin_account_state s JOIN nx_admin a ON a.id=s.admin_id WHERE a.username='${username}'; DELETE FROM nx_admin WHERE username='${username}';`);
}

function deleteDatabaseRoleByCode(roleCode: string) {
  validateIdentifier(roleCode, "role code");
  mysql(`DELETE rr FROM nx_admin_role_relation rr JOIN nx_admin_role r ON r.id=rr.role_id WHERE r.role_code='${roleCode}'; DELETE rm FROM nx_admin_role_menu rm JOIN nx_admin_role r ON r.id=rm.role_id WHERE r.role_code='${roleCode}'; DELETE rp FROM nx_admin_role_permission rp JOIN nx_admin_role r ON r.id=rp.role_id WHERE r.role_code='${roleCode}'; DELETE FROM nx_admin_role WHERE role_code='${roleCode}';`);
}

function deleteDatabaseRoleByIdAndCode(roleId: number, roleCode: string) {
  const id = exactId(roleId);
  validateIdentifier(roleCode, "role code");
  mysql(`DELETE FROM nx_admin_role_relation WHERE role_id=${id}; DELETE FROM nx_admin_role_menu WHERE role_id=${id}; DELETE FROM nx_admin_role_permission WHERE role_id=${id}; DELETE FROM nx_admin_role WHERE id=${id} AND role_code='${roleCode}';`);
}

function ticketStatus(operationId: string) {
  if (!/^WO-[0-9-]+$/.test(operationId)) throw new Error("OPERATION_ID_INVALID");
  return mysql(`SELECT LOWER(status) FROM nx_audit_operation_ticket WHERE operation_id='${operationId}' AND is_deleted=0 LIMIT 1;`);
}

function activeTicketLocks(operationId: string) {
  if (!/^WO-[0-9-]+$/.test(operationId)) throw new Error("OPERATION_ID_INVALID");
  return Number(mysql(`SELECT COUNT(*) FROM nx_audit_object_lock WHERE ticket_id='${operationId}' AND is_deleted=0;`));
}

function databaseAccountResidual(actor: Credential) {
  const id = exactId(actor.accountId);
  validateUsername(actor.username);
  return Number(mysql(`SELECT (SELECT COUNT(*) FROM nx_admin WHERE id=${id} OR username='${actor.username}') + (SELECT COUNT(*) FROM nx_admin_account_state WHERE admin_id=${id}) + (SELECT COUNT(*) FROM nx_admin_role_relation WHERE admin_id=${id});`));
}

function databaseRoleResidual(roleRow: RoleRuntime) {
  return Number(mysql(`SELECT (SELECT COUNT(*) FROM nx_admin_role WHERE id=${roleRow.id}) + (SELECT COUNT(*) FROM nx_admin_role_relation WHERE role_id=${roleRow.id}) + (SELECT COUNT(*) FROM nx_admin_role_menu WHERE role_id=${roleRow.id}) + (SELECT COUNT(*) FROM nx_admin_role_permission WHERE role_id=${roleRow.id});`));
}

function databaseAccountResidualByUsername(username: string) {
  validateUsername(username);
  return Number(mysql(`SELECT (SELECT COUNT(*) FROM nx_admin WHERE username='${username}') + (SELECT COUNT(*) FROM nx_admin_account_state s JOIN nx_admin a ON a.id=s.admin_id WHERE a.username='${username}') + (SELECT COUNT(*) FROM nx_admin_role_relation rr JOIN nx_admin a ON a.id=rr.admin_id WHERE a.username='${username}');`));
}

function databaseRoleResidualByCode(roleCode: string) {
  validateIdentifier(roleCode, "role code");
  return Number(mysql(`SELECT (SELECT COUNT(*) FROM nx_admin_role WHERE role_code='${roleCode}') + (SELECT COUNT(*) FROM nx_admin_role_relation rr JOIN nx_admin_role r ON r.id=rr.role_id WHERE r.role_code='${roleCode}') + (SELECT COUNT(*) FROM nx_admin_role_menu rm JOIN nx_admin_role r ON r.id=rm.role_id WHERE r.role_code='${roleCode}') + (SELECT COUNT(*) FROM nx_admin_role_permission rp JOIN nx_admin_role r ON r.id=rp.role_id WHERE r.role_code='${roleCode}');`));
}

function mysql(statement: string) {
  return execFileSync(mysqlBin, ["-h", "127.0.0.1", "-N", "-B", "-uroot", dbName, "-e", statement], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, MYSQL_PWD: dbPassword },
  }).trim();
}

function domainManifest(domain: string, accounts: Record<string, Provisioned>, roles: RoleRuntime[], candidate: Record<string, unknown>, generatedAt: string) {
  return {
    sensitive: true,
    doNotUpload: true,
    runId,
    generatedAt,
    candidate,
    source: `Final7 visible A1/A6/A2 ${domain} permission refresh; zero ${domain} business writes`,
    accounts,
    roles: roles.map(publicRole),
    cleanup: cleanupPlan(Object.values(accounts), roles),
  };
}

function publicRole(roleRow: RoleRuntime) {
  return { roleId: roleRow.id, roleCode: roleRow.code, roleName: roleRow.name, permissionCodes: roleRow.permissions, menuCodes: roleRow.menus, grantOperationId: roleRow.grantOperationId };
}

function cleanupPlan(accounts: Credential[], roles: RoleRuntime[]) {
  return {
    required: true,
    accounts: accounts.map((account) => ({
      accountId: account.accountId,
      username: account.username,
      order: ["sessions/revoke", "reset-2fa", "role=unassigned", "status=disabled", "exact database delete"],
    })),
    roles: roles.map((roleRow) => ({ roleId: roleRow.id, roleCode: roleRow.code, order: ["remove account relations", "remove menu grants", "remove permission grants", "exact role delete"] })),
  };
}

function candidateBinding() {
  return {
    buildId: expectedBuildId,
    backendJarSha256: expectedJarSha256,
    pc: { pid: expectedPcPid, port: 3002 },
    backend: { pid: expectedBackendPid, port: 8110 },
    mfaBypass: false,
  };
}

function verifyCandidateAndListeners() {
  expect(readFileSync(".next/BUILD_ID", "utf8").trim()).toBe(expectedBuildId);
  expect(fileSha256(candidateJar)).toBe(expectedJarSha256);
  expect(listenerPid(3002)).toBe(expectedPcPid);
  expect(listenerPid(8110)).toBe(expectedBackendPid);
}

function verifyFinal10RuntimeLock() {
  assertRestrictedSource(final10RuntimeLockPath);
  const lock = JSON.parse(readFileSync(final10RuntimeLockPath, "utf8")) as Record<string, unknown>;
  const main = objectRecord(lock.main, "FINAL10_RUNTIME_LOCK_MAIN");
  const health = objectRecord(lock.health, "FINAL10_RUNTIME_LOCK_HEALTH");

  expect(lock.runId, "Final10 runtime lock Run ID").toBe(runId);
  expect(lock.candidate, "Final10 runtime lock candidate").toBe("Final10");
  expect(String(lock.pcBuildId ?? ""), "Final10 runtime lock PC build").toBe(expectedBuildId);
  expect(String(lock.jarSha256 ?? "").toUpperCase(), "Final10 runtime lock backend JAR").toBe(expectedJarSha256);
  expect(Number(main.pcPid), "Final10 runtime lock PC PID").toBe(expectedPcPid);
  expect(Number(main.pcPort), "Final10 runtime lock PC port").toBe(3002);
  expect(Number(main.backendPid), "Final10 runtime lock backend PID").toBe(expectedBackendPid);
  expect(Number(main.backendPort), "Final10 runtime lock backend port").toBe(8110);
  expect(main.database, "Final10 runtime lock database").toBe(dbName);
  expect(main.mfaBypass, "Final10 runtime lock normal MFA binding").toBe(false);
  expect(Number(health.mainBackendAuthMe), "Final10 runtime lock backend health").toBe(401);
  expect(Number(health.mainPcRoot), "Final10 runtime lock PC health").toBe(200);

  const runtimeRoot = path.dirname(final10RuntimeLockPath);
  const runtimeBuildId = path.join(runtimeRoot, "runtime", "main", `pc-${expectedBuildId}`, ".next", "BUILD_ID");
  expect(readFileSync(runtimeBuildId, "utf8").trim(), "Final10 immutable runtime PC build").toBe(expectedBuildId);
  expect(fileSha256(candidateJar), "Final10 immutable runtime backend JAR").toBe(expectedJarSha256);
  expect(listenerPid(3002), "Final10 live PC listener").toBe(expectedPcPid);
  expect(listenerPid(8110), "Final10 live backend listener").toBe(expectedBackendPid);
}

function listenerPid(port: number) {
  const pids = new Set<number>();
  const output = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)$/i);
    if (match && match[1].endsWith(`:${port}`)) pids.add(Number(match[2]));
  }
  if (pids.size !== 1) throw new Error(`FINAL7_LISTENER_PID_AMBIGUOUS:${port}`);
  return [...pids][0];
}

function validateStaticScope() {
  expect(new URL(baseUrl).hostname).toMatch(/^(?:127\.0\.0\.1|localhost|::1)$/);
  expect(new URL(baseUrl).port).toBe("3002");
  const base = realpathSync("D:/workspace/bug-pic/.restricted");
  const resolved = path.resolve(outputDir);
  const relative = path.relative(base, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("FINAL7_OUTPUT_DIR_OUT_OF_SCOPE");
  for (const file of [sourceAManifestPath, sourceIManifestPath, sourceHManifestPath]) {
    const source = realpathSync(file);
    const sourceRelative = path.relative(base, source);
    if (sourceRelative.startsWith("..") || path.isAbsolute(sourceRelative)) throw new Error("FINAL7_SOURCE_MANIFEST_OUT_OF_SCOPE");
  }
  validateWindowsPrincipal(restrictedOwner);
  validateIdentifier(dbName, "database");
}

async function nav(page: Page, name: string, url: RegExp) {
  const link = page.locator("aside").getByRole("link", { name, exact: true });
  if (!await link.isVisible().catch(() => false)) {
    await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click();
  }
  await link.click();
  await expect(page).toHaveURL(url);
}

async function confirmAndWait(page: Page, predicate: (response: Response) => boolean) {
  const pending = page.waitForResponse(predicate);
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) }).last();
  await dialog.getByLabel(/操作理由/).fill(reason);
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  return await pending;
}

async function apiSuccess<T>(response: { status(): number; json(): Promise<unknown> }, label: string) {
  const body = await response.json().catch(() => null) as { code?: number; message?: string; data?: T } | null;
  expect(response.status(), `${label}: HTTP ${response.status()} ${body?.message ?? ""}`).toBeLessThan(400);
  expect(body?.code ?? 0, `${label}: ${body?.message ?? "invalid envelope"}`).toBe(0);
  return body?.data as T;
}

async function gotoLogin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" }).catch((error: unknown) => {
    if (!(error instanceof Error) || !error.message.includes("is interrupted by another navigation")) throw error;
  });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function freshTotp(secret: string) {
  const key = createHash("sha256").update(secret).digest("hex");
  let step = Math.floor(Date.now() / 30_000);
  const remaining = 30_000 - Date.now() % 30_000;
  if (step <= (usedTotpSteps.get(key) ?? -1) || remaining < 4_000) {
    await expect.poll(() => Math.floor(Date.now() / 30_000), { timeout: 35_000 }).toBeGreaterThan(step);
    step = Math.floor(Date.now() / 30_000);
  }
  usedTotpSteps.set(key, step);
  return currentTotp(secret);
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("TOTP_SECRET_ENCODING_INVALID");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
    Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function credential(value: Partial<Credential> | undefined, label: string): Credential {
  if (!value?.accountId || !value.username || !value.password || !value.totpSecret) throw new Error(`${label}_INCOMPLETE`);
  return { accountId: exactId(value.accountId), username: validatedUsername(value.username), password: value.password, totpSecret: value.totpSecret };
}

function readManifest(file: string) {
  return JSON.parse(readFileSync(file, "utf8")) as SourceManifest;
}

function writeRestrictedJson(file: string, value: unknown) {
  writeRestrictedText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeRestrictedText(file: string, contents: string) {
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600 });
    restrictFileAcl(temporary);
    renameSync(temporary, file);
    restrictFileAcl(file);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function restrictDirectoryAcl(directory: string) {
  if (process.platform !== "win32") throw new Error("WINDOWS_ACL_REQUIRED");
  const currentPrincipal = execFileSync("whoami.exe", [], { encoding: "utf8", windowsHide: true }).trim();
  validateWindowsPrincipal(currentPrincipal);
  const principals = [...new Set([restrictedOwner, currentPrincipal])];
  execFileSync("icacls.exe", [
    directory, "/inheritance:r", "/grant:r",
    ...principals.map((principal) => `${principal}:(OI)(CI)(F)`),
    "*S-1-5-18:(OI)(CI)(F)", "*S-1-5-32-544:(OI)(CI)(F)",
  ], { encoding: "utf8", windowsHide: true });
  assertAclRestricted(directory, principals);
}

function restrictFileAcl(file: string) {
  const currentPrincipal = execFileSync("whoami.exe", [], { encoding: "utf8", windowsHide: true }).trim();
  validateWindowsPrincipal(currentPrincipal);
  const principals = [...new Set([restrictedOwner, currentPrincipal])];
  execFileSync("icacls.exe", [
    file, "/inheritance:r", "/grant:r",
    ...principals.map((principal) => `${principal}:(F)`),
    "*S-1-5-18:(F)", "*S-1-5-32-544:(F)",
  ], { encoding: "utf8", windowsHide: true });
  assertAclRestricted(file, principals);
}

function assertAclRestricted(target: string, principals: string[]) {
  const acl = execFileSync("icacls.exe", [target], { encoding: "utf8", windowsHide: true });
  const expected = new Set([...principals, "BUILTIN\\Administrators", "NT AUTHORITY\\SYSTEM"].map((value) => value.toLowerCase()));
  const actual = acl.split(/\r?\n/).flatMap((line) => {
    if (!line.includes(":(")) return [];
    const normalized = line.startsWith(target) ? line.slice(target.length).trim() : line.trim();
    const separator = normalized.indexOf(":(");
    return separator < 1 ? [] : [normalized.slice(0, separator).trim().toLowerCase()];
  });
  if (actual.length !== expected.size || actual.some((principal) => !expected.has(principal))) throw new Error("ACL_PRINCIPAL_OUTSIDE_ALLOWLIST");
  if ([...expected].some((principal) => !actual.includes(principal))) throw new Error("ACL_REQUIRED_PRINCIPAL_MISSING");
}

function flattenMenus(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const wrapper = entry as Record<string, unknown>;
    const row = wrapper.node && typeof wrapper.node === "object" && !Array.isArray(wrapper.node)
      ? wrapper.node as Record<string, unknown> : wrapper;
    return [row, ...flattenMenus(wrapper.children ?? row.children)];
  });
}

function collectObjects(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(collectObjects);
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  return [row, ...Object.values(row).flatMap(collectObjects)];
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`FINAL7_${label}_INVALID`);
  return value as Record<string, unknown>;
}

function objectArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sameSet(left: readonly string[], right: readonly string[]) {
  const l = [...left].sort();
  const r = [...right].sort();
  return l.length === r.length && l.every((value, index) => value === r[index]);
}

function fileSha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
}

function exactId(value: unknown) {
  const normalized = String(value ?? "");
  if (!/^\d+$/.test(normalized)) throw new Error("FIXTURE_ACCOUNT_ID_INVALID");
  return normalized;
}

function validatedUsername(value: string) {
  validateUsername(value);
  return value;
}

function validateUsername(value: string) {
  if (!/^[a-z0-9_.-]{3,32}$/.test(value)) throw new Error("FIXTURE_USERNAME_INVALID");
}

function validateIdentifier(value: string, label: string) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`FIXTURE_${label.replace(/\W/g, "_").toUpperCase()}_INVALID`);
}

function validateWindowsPrincipal(value: string) {
  if (!/^[A-Za-z0-9_.\\-]{1,128}$/.test(value) || !value.includes("\\")) throw new Error("RESTRICTED_OWNER_INVALID");
  if (/^(?:everyone|authenticated users|users|codexsandboxusers|s-1-1-0)$/i.test(value.split("\\").at(-1) ?? value)) throw new Error("RESTRICTED_OWNER_UNSAFE");
}

function positiveInteger(value: string, label: string) {
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error(`FINAL7_${label}_INVALID`);
  return Number(value);
}

function pathOf(value: string) {
  return new URL(value).pathname;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
