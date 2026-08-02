import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("L4 isolated fixture is explicitly non-product and writes only the approved 3/2/5/3 topology", async () => {
  const setup = await read("./e2e/l4-isolated-network-fixture-setup.ps1");

  assert.match(setup, /验收夹具、非产品路径/);
  assert.match(setup, /L4_FIXTURE_WRITE_TOKEN/);
  assert.match(setup, /bug-pic\\\.restricted/);
  assert.match(setup, /\$ExpectedUserCount = 3/);
  assert.match(setup, /\$ExpectedSponsorshipCount = 2/);
  assert.match(setup, /\$ExpectedTeamCount = 5/);
  assert.match(setup, /\$ExpectedKycCount = 3/);
  assert.equal((setup.match(/INSERT INTO nx_user\s/g) ?? []).length, 3);
  assert.equal((setup.match(/INSERT INTO nx_sponsorship\s/g) ?? []).length, 2);
  assert.equal((setup.match(/INSERT INTO nx_team_member\s/g) ?? []).length, 5);
  assert.match(setup, /A->B->C; level0 self loops plus level1 adjacency only; no level2 closure/);
  assert.doesNotMatch(setup, /'L4 Fixture C','V0',2,/);
  assert.match(setup, /required nx_user -> nx_kyc_profile trigger/);
  assert.match(setup, /setup-fallback-cleanup\.json/);
  assert.match(setup, /caller must invoke l4-isolated-network-fixture-cleanup\.ps1 from finally/);
});

test("L4 cleanup uses manifest IDs plus full logical predicates and never deletes immutable A2/A4 evidence", async () => {
  const cleanup = await read("./e2e/l4-isolated-network-fixture-cleanup.ps1");

  assert.match(cleanup, /Assert-Count \$users 3/);
  assert.match(cleanup, /Assert-Count \$kycProfiles 3/);
  assert.match(cleanup, /Assert-Count \$sponsorships 2/);
  assert.match(cleanup, /Assert-Count \$teamRows 5/);
  assert.match(cleanup, /DELETE FROM nx_team_member/);
  assert.match(cleanup, /DELETE FROM nx_sponsorship/);
  assert.match(cleanup, /DELETE FROM nx_kyc_profile/);
  assert.match(cleanup, /DELETE FROM nx_user/);
  assert.match(cleanup, /member_no=/);
  assert.match(cleanup, /trigger_source='REGISTRATION'/);
  assert.match(cleanup, /nonFixtureTeamFingerprintRestored/);
  assert.match(cleanup, /immutableA2A4Retained = \$true/);
  assert.doesNotMatch(cleanup, /DELETE FROM nx_(audit_log|event_outbox)/);
  assert.doesNotMatch(cleanup, /LIKE\s+['"][^'"]*%/);
});

test("public registration cannot be claimed as the current L4 team producer", async () => {
  const registration = await read("../../nexion-backend/src/main/java/ffdd/opsconsole/auth/application/AppUserRegistrationService.java");
  const otp = await read("../../nexion-backend/src/main/java/ffdd/opsconsole/auth/application/UserOtpDeliveryService.java");
  const appConfig = await read("../../nexion-backend/src/main/resources/application.yml");

  assert.match(otp, /nexion\.auth\.user-otp\.delivery-url:/);
  assert.match(otp, /return StringUtils\.hasText\(deliveryUrl\)/);
  assert.doesNotMatch(appConfig, /user-otp:\s*[\r\n]+[\s\S]*delivery-url:/);
  assert.match(registration, /userMapper\.insert\(user\)/);
  assert.match(registration, /ensureUserWallet/);
  assert.match(registration, /"auth\.register_completed"/);
  assert.match(registration, /"referral\.bound"/);
  assert.doesNotMatch(registration, /nx_team_member|nx_sponsorship/);
});

test("F team truth is level-1 adjacency plus level-0 self loops, so the fixture must not invent a closure row", async () => {
  const teamMapper = await read("../../nexion-backend/src/main/java/ffdd/opsconsole/team/mapper/TeamCommissionMapper.java");

  assert.match(teamMapper, /WHERE member_user_id = #\{userId\}[\s\S]*AND level = 1/);
  assert.match(teamMapper, /JOIN nx_team_member u[\s\S]*u\.level = 1/);
  assert.match(teamMapper, /WHERE user_id = member_user_id[\s\S]*is_deleted = 0/);
});

test("L-007 is repaired: depth recursively follows level-1 adjacency, rejects cycles, de-duplicates paths and filters the final window", async () => {
  const ui = await read("../app/components/domain-views/l-tabs/l4-ops.tsx");
  const prd = await read("../docs/PRD/Nexion_运营控制后台PRD_v4.md");
  const productLog = await read("../docs/后台产品更新日志.md");
  const mapper = await read("../../nexion-backend/src/main/java/ffdd/opsconsole/bi/mapper/BiReportMapper.java");
  const queryStart = mapper.indexOf("List<Map<String, Object>> selectL4NetworkTreeRows");
  const queryBlock = mapper.slice(Math.max(0, queryStart - 3_500), queryStart + 300);

  assert.match(ui, /层级越深，导出范围越大/);
  assert.match(ui, /团队树层级/);
  assert.match(ui, /options: \["1", "2", "3"/);
  assert.match(prd, /导出范围\(周期 \+ 树深度选择\)/);
  assert.match(productLog, /团队树导出的日\/周\/月/);
  assert.match(queryBlock, /WITH RECURSIVE tree_edges/);
  assert.match(queryBlock, /m\.level = 1/);
  assert.match(queryBlock, /JOIN nx_team_member c/);
  assert.match(queryBlock, /t\.tree_depth < #\{depth\}/);
  assert.match(queryBlock, /LOCATE\(CONCAT\(',', CAST\(c\.member_user_id AS CHAR\), ','\), t\.visited_path\) = 0/);
  assert.match(queryBlock, /ROW_NUMBER\(\) OVER \([\s\S]*PARTITION BY root_user_id, member_user_id/);
  assert.match(queryBlock, /FROM ranked_edges[\s\S]*WHERE edge_rank = 1[\s\S]*joined_at >= CASE/);
  assert.doesNotMatch(queryBlock, /level BETWEEN 1 AND #\{depth\}/);
});

test("Final4 browser and DB proof carriers require A-to-C expansion plus cycle, multi-path, window, EXPLAIN and capacity evidence", async () => {
  const browser = await read("./e2e/l-domain-final-write-20260729.spec.ts");
  const makerChecker = await read("./e2e/l-domain-maker-checker-20260728.spec.ts");
  const dbProof = await read("./e2e/l4-final4-recursive-db-proof.ps1");

  assert.match(browser, /L_FINAL_EXPECTED_WRITE_TOKEN/);
  assert.match(browser, /L_FINAL_EXPECTED_WRITE_TOKEN is required/);
  assert.match(makerChecker, /L_FINAL_EXPECTED_WRITE_TOKEN/);
  assert.match(makerChecker, /L_FINAL_EXPECTED_WRITE_TOKEN is required/);
  assert.match(makerChecker, /collectCheckerLeafPaths/);
  assert.match(makerChecker, /for \(const groupName of \[\/平台基础\/, \/数据与分析 BI\/\]\)/);
  assert.match(makerChecker, /toHaveAttribute\("aria-expanded", "true"\)/);
  assert.match(browser, /depth=2 must add the derived A→C row/);
  assert.match(browser, /repairVerified: true/);
  assert.match(browser, /closedDefect: "L-007"/);
  assert.match(browser, /initialAuthShellAbortPaths = new Set/);
  assert.match(browser, /request\.failure\(\)\?\.errorText === "net::ERR_ABORTED"/);
  assert.match(browser, /initialAuthShellAbortPaths\.has\(pathname\)/);
  assert.match(browser, /expected initial auth navigation cancellation/);
  assert.match(dbProof, /read-only MySQL CTE, no product-table writes/);
  assert.match(dbProof, /C->A cycle/);
  assert.match(dbProof, /A->C direct alternate path/);
  assert.match(dbProof, /EXPLAIN FORMAT=JSON/);
  assert.match(dbProof, /EXPLAIN ANALYZE/);
  assert.match(dbProof, /fiveRunDurationMs/);
  assert.doesNotMatch(dbProof, /INSERT INTO nx_team_member|UPDATE nx_team_member|DELETE FROM nx_team_member/);
});

test("governed repository reports, including EXP and L4TREE, reconcile as L5-owned", async () => {
  const repository = await read("../../nexion-backend/src/main/java/ffdd/opsconsole/bi/infrastructure/MybatisBiReportRepository.java");
  const service = await read("../../nexion-backend/src/main/java/ffdd/opsconsole/bi/application/OpsBiService.java");
  const cleanup = await read("./e2e/l-domain-final-reconcile-cleanup.ps1");

  assert.match(repository, /new BiReportMapper\.ReportSeed\(\s*"L5"/);
  assert.match(service, /"L4TREE-"[\s\S]*reportRepository\.createReport/);
  assert.match(cleanup, /"EXP-\*"[\s\S]*"L4TREE-\*"/);
  assert.match(cleanup, /\$expectedModule[\s\S]*"L5"/);
});
