import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pc = "D:/workspace/nexion-ops-console";
const backend = "D:/workspace/nexion-backend";
const app = "D:/workspace/NX1.0";
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
const registration = read(backend, "src/main/java/ffdd/opsconsole/auth/application/AppUserRegistrationService.java");
const registrationMapper = read(backend, "src/main/java/ffdd/opsconsole/auth/mapper/AppUserRegistrationMapper.java");
const registrationPage = read(app, "src/pages/register/register.vue");
const authApi = read(app, "src/api/auth-api.ts");

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
