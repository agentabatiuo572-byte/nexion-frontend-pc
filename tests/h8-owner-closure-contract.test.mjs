import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const pc = "D:/workspace/nexion-ops-console";
const backend = "D:/workspace/nexion-backend";
const app = resolveNexionAppRoot({ adminRoot: pc });
const read = (root, file) => fs.readFileSync(path.join(root, file), "utf8");

const h8 = read(pc, "app/components/domain-views/h-tabs/h8-referral-rewards.tsx");
const client = read(pc, "lib/admin/h-client.ts");
const service = read(backend, "src/main/java/ffdd/opsconsole/growth/application/OpsReferralRewardService.java");
const mapper = read(backend, "src/main/java/ffdd/opsconsole/growth/mapper/ReferralRewardMapper.java");
const publicController = read(backend, "src/main/java/ffdd/opsconsole/growth/web/ReferralRewardPublicConfigController.java");
const security = read(backend, "src/main/java/ffdd/opsconsole/shared/security/SecurityConfig.java");
const appApi = read(app, "src/api/platform-config-api.ts");
const appStore = read(app, "src/store/config.ts");
const registry = read(pc, "lib/admin/high-ops-registry.ts");
const replay = read(backend, "src/main/java/ffdd/opsconsole/growth/application/OpsGrowthService.java");
const a2BusinessGuard = read(backend, "src/main/java/ffdd/opsconsole/platform/application/AuditReplayBusinessPermissionGuard.java");
const registration = read(backend, "src/main/java/ffdd/opsconsole/auth/application/AppUserRegistrationService.java");
const registrationMapper = read(backend, "src/main/java/ffdd/opsconsole/auth/mapper/AppUserRegistrationMapper.java");
const registrationPage = read(app, "src/pages/register/register.vue");
const authApi = read(app, "src/api/auth-api.ts");
const settlementCarrier = read(pc, "tests/e2e/h8-real-settlement-20260728.spec.ts");
const ownerWrapper = read(pc, "tests/e2e/h-final3-owner-all.ps1");
const appCarrier = read(pc, "tests/e2e/h8-app-referral-chain-final3.mjs");

test("H8 real settlement can only execute inside the A2 approved replay context", () => {
  assert.match(service, /if \(!A2ReplayContext\.isReplaying\(\)\)[\s\S]{0,180}"A2_CONFIRMATION_REQUIRED"/);
  assert.match(service, /@Transactional\(isolation = Isolation\.SERIALIZABLE\)/);
  assert.match(service, /requireRewardMutex\(\)/);
  assert.match(service, /requireHealthyCoverage\(\)[\s\S]*requireHealthyCoverage\(\)/);
  assert.match(service, /insertSettlement[\s\S]*creditWallet[\s\S]*post\(/);
  assert.match(service, /base\.multiply\(multiplier\)\.setScale\(6, RoundingMode\.HALF_UP\)/);
  assert.match(service, /MAX_EFFECTIVE_REWARD/);
  assert.match(service, /MAX_INVITER_BASE = new BigDecimal\("249999999\.750000"\)/);
  assert.match(service, /REFERRAL_REWARD_EFFECTIVE_AMOUNT_OVERFLOW/);
  assert.doesNotMatch(client, /\/referral-rewards\/settlements\/run/);
  assert.match(h8, /max: 249_999_999\.75/);
});

test("H8 A2 proposal freezes the exact H8 and H1 reward snapshot until replay", () => {
  assert.match(registry, /op: "h8_referral_settlement"[\s\S]*expectedH8Version[\s\S]*expectedRhythmMonth[\s\S]*rewardSnapshotHash/);
  assert.match(h8, /expectedH8Version: data\?\.version/);
  assert.match(h8, /expectedRhythmMonth: data\?\.rhythmMonth/);
  assert.match(h8, /rewardSnapshotHash: data\?\.rewardSnapshotHash/);
  assert.match(replay, /longVal\(p, "expectedH8Version"\)/);
  assert.match(service, /requireRewardMutex\(\);[\s\S]{0,160}requireApprovedSnapshot\(request, snapshot\)/);
  assert.match(service, /H8_REWARD_SNAPSHOT_CHANGED_REPROPOSE/);
});

test("H8 PC proposal and A2 guard share one canonical pending-settlement context", () => {
  assert.match(h8, /action: "执行邀请奖励真实结算"[\s\S]*?obj: "待结算邀请批次"[\s\S]*?sourceDomain: "H8"/);
  assert.match(registry, /op: "h8_referral_settlement"[\s\S]*?domain: "H"[\s\S]*?targetType: "referral_settlement_batch"[\s\S]*?id: "pending"/);
  assert.match(a2BusinessGuard, /delegatedHDescriptor\(operation, params\)/);
  assert.match(a2BusinessGuard, /"h8_referral_settlement"[\s\S]*?"执行邀请奖励真实结算"[\s\S]*?"待结算邀请批次"[\s\S]*?"H8"[\s\S]*?"fund"[\s\S]*?"referral_settlement_batch", "pending"/);
  assert.match(a2BusinessGuard, /growth_h8_settle/);
});

test("H8 blocked count excludes already settled and self-sponsor relationships", () => {
  const blocked = mapper.slice(mapper.indexOf("long totalBlockedByK2") - 7000, mapper.indexOf("long totalBlockedByK2") + 300);
  assert.match(blocked, /LEFT JOIN nx_referral_reward_settlement s/);
  assert.match(blocked, /s\.id IS NULL/);
  assert.match(blocked, /u\.sponsor_user_id <> u\.id/);
});

test("H8 App/H5 uses a public effective-reward projection and never remote mock values", () => {
  assert.match(publicController, /@GetMapping\("\/api\/config\/referral-rewards"\)/);
  assert.match(security, /HttpMethod\.GET, "\/api\/config\/referral-rewards"\)\.permitAll\(\)/);
  assert.match(service, /publicConfig\(\)[\s\S]*newcomerUsdt\(\)[\s\S]*newcomerNex\(\)[\s\S]*inviterNex\(\)/);
  assert.match(appApi, /path: "\/api\/config\/referral-rewards"/);
  assert.match(appApi, /parseReferralRewardConfig/);
  assert.match(appApi, /nx_user\.sponsor_user_id/);
  assert.match(appStore, /EMPTY_REMOTE_REWARDS/);
  assert.match(appStore, /rewards: \{[\s\S]*snapshot\.rewards\.welcomeGift[\s\S]*snapshot\.rewards\.inviterReward/);
});

test("H8 remote registration writes one immutable sponsor relation before issuing the server session", () => {
  assert.match(registration, /mapper\.consumeValidChallenge/);
  assert.match(registration, /countRecentClient/);
  assert.match(registration, /countDailyClient/);
  assert.match(registration, /user\.setSponsorUserId\(sponsor == null \? null : sponsor\.getId\(\)\)/);
  assert.match(registration, /userMapper\.insert\(user\)/);
  assert.match(registration, /userMapper\.ensureUserWallet\(user\.getId\(\)\)/);
  assert.match(registration, /authService\.issueRegisteredSession/);
  assert.match(registrationMapper, /UNIQUE KEY uk_user_registration_otp_no/);
  assert.match(registrationMapper, /findSponsorForUpdate/);
  assert.match(authApi, /path: "\/auth\/users\/register\/otp\/send"/);
  assert.match(authApi, /path: "\/auth\/users\/register"/);
  assert.match(registrationPage, /if \(remoteApiEnabled\)[\s\S]*authApi\.register/);
  assert.match(registrationPage, /sponsorCode: currentSponsorCode\(\)/);
  assert.match(registrationPage, /const recovered = await authApi\.login/);
});

test("H8 PC fails closed on malformed overview and provides downstream verification entries", () => {
  assert.match(client, /parseH8ReferralRewardOverview/);
  assert.match(client, /H8_RESPONSE_INVALID/);
  assert.match(client, /source !== "nx_user\.sponsor_user_id"/);
  assert.match(client, /settlementMode !== "REAL_WALLET_LEDGER"/);
  assert.match(h8, /A2 审批与审计/);
  assert.match(h8, /A4 事件/);
  assert.match(h8, /D4 钱包台账/);
  assert.match(h8, /row\.status === "SETTLED" \? "已结算"/);
});

test("H8 settlement carrier binds the target to the same App manifest and refuses unproved limit-one ordering", () => {
  assert.match(settlementCarrier, /H8_APP_MANIFEST_PATH/);
  assert.match(settlementCarrier, /H8_TARGET_ORDER_PROOF_PATH/);
  assert.doesNotMatch(settlementCarrier, /H8_INVITED_USER_ID/);
  assert.doesNotMatch(settlementCarrier, /H8_INVITER_USER_ID/);
  assert.match(settlementCarrier, /targetIsFirstEligible/);
  assert.match(settlementCarrier, /eligibleBeforeTarget/);
  assert.match(settlementCarrier, /nonTargetFingerprintBefore/);
  assert.match(settlementCarrier, /expect\(orderProof\.targetIsFirstEligible\)\.toBe\(true\)/);
  assert.match(settlementCarrier, /expect\(orderProof\.eligibleBeforeTarget\)\.toBe\(0\)/);
  assert.match(settlementCarrier, /expect\(orderProof\.invitedUserId\)\.toBe\(invitedUserId\)/);
  assert.match(settlementCarrier, /expect\(orderProof\.inviterUserId\)\.toBe\(inviterUserId\)/);
  assert.match(ownerWrapper, /H8_APP_MANIFEST_PATH\s*=\s*\(Join-Path \$appDir 'app-referral-chain\.json'\)/);
  assert.match(ownerWrapper, /H8_TARGET_ORDER_PROOF_PATH/);
  assert.doesNotMatch(ownerWrapper, /H8_INVITED_USER_ID\s*=/);
  assert.doesNotMatch(ownerWrapper, /H8_INVITER_USER_ID\s*=/);
  assert.match(ownerWrapper, /nexion_acceptance_.*_irreversible/);
  assert.match(ownerWrapper, /function New-H8TargetOrderProof/);
  assert.match(ownerWrapper, /targetIsFirstEligible = \$true/);
  assert.match(ownerWrapper, /eligibleBeforeTarget = 0/);
  assert.match(ownerWrapper, /directSettlementMutation = \$false/);
  assert.match(ownerWrapper, /function Get-NonTargetFingerprint/);
  assert.match(ownerWrapper, /nonTargetUnchanged = \$true/);
  assert.match(ownerWrapper, /B1_COVERAGE_SINGLETON\.lck/);
  assert.match(ownerWrapper, /\[IO\.FileMode\]::CreateNew/);
  assert.match(ownerWrapper, /function Exit-B1CoverageLock[\s\S]*?if \(-not \$script:B1CoverageLockOwned\)[\s\S]*?return/);
  assert.match(ownerWrapper, /minimumReserveCalculation = \$true/);
  assert.match(ownerWrapper, /function Get-B1Snapshot/);
  assert.doesNotMatch(ownerWrapper, /ReserveAmountUsd\s*=\s*10000000/);
  assert.match(ownerWrapper, /DELETE FROM nx_audit_object_lock[\s\S]*?DELETE FROM nx_audit_operation_ticket/);
});

test("H8 Murphy guards make the B1 lease global, fingerprint exact, and cleanup reversible", () => {
  assert.match(ownerWrapper, /Join-Path 'D:\\workspace\\bug-pic\\\.restricted' 'coordination\\locks'/);
  assert.match(ownerWrapper, /function Get-NonTargetFingerprint[\s\S]*?Get-Sha256Hex/);
  assert.doesNotMatch(ownerWrapper, /BIT_XOR\(CRC32/);
  assert.match(ownerWrapper, /NOT \(invited_user_id=\$InvitedUserId AND inviter_user_id=\$InviterUserId\)/);
  assert.match(ownerWrapper, /function Assert-B1Restored/);
  assert.match(ownerWrapper, /Assert-B1Restored[\s\S]*?Exit-B1CoverageLock/);
  assert.match(ownerWrapper, /function Restore-H8TargetOrderingFixture/);
  assert.match(ownerWrapper, /Restore-H8TargetOrderingFixture[\s\S]*?Remove-H8MutableData/);
  assert.match(ownerWrapper, /private\.runId/);
  assert.match(ownerWrapper, /private\.result[^\r\n]*PASS/);
  assert.match(ownerWrapper, /manifest\.accounts\.invitee\.userId[\s\S]*?private\.accounts\.invitee\.userId/);
  assert.match(appCarrier, /cleanup\.result = "PASS"[\s\S]*?writeFile\(privatePath/);
  assert.match(appCarrier, /cleanup\.result = "FAIL"/);
  assert.match(ownerWrapper, /\$script:H8WaveId = \$waveId[\s\S]*?& \$NodeExe 'tests\/e2e\/h8-app-referral-chain-final3\.mjs'/);
  assert.match(ownerWrapper, /reserveBaseUsd/);
  assert.match(ownerWrapper, /\$requiredReserve - \$pre\.reserveBaseUsd/);
});
