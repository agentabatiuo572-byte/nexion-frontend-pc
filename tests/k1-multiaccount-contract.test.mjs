import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../app/components/domain-views/k-tabs/k1-multiaccount.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/k-client.ts", import.meta.url), "utf8");
const kView = readFileSync(new URL("../app/components/domain-views/k-view.tsx", import.meta.url), "utf8");
const confirmModal = readFileSync(new URL("../app/components/domain-views/k-tabs/confirm-modal.tsx", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../app/api/admin/risk/[...path]/route.ts", import.meta.url), "utf8");
const platformProxy = readFileSync(new URL("../app/api/admin/platform/[...path]/route.ts", import.meta.url), "utf8");
const a2Client = readFileSync(new URL("../lib/admin/a2-client.ts", import.meta.url), "utf8");
const proposer = readFileSync(new URL("../lib/admin/propose-or-execute.ts", import.meta.url), "utf8");
const highOps = readFileSync(new URL("../lib/admin/high-ops-registry.ts", import.meta.url), "utf8");
const designKit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const errorMessages = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../lib/admin/registry/k.ts", import.meta.url), "utf8");
const backendMapper = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/risk/mapper/RiskOpsMapper.java", import.meta.url),
  "utf8",
);
const registrationService = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/auth/application/AppUserRegistrationService.java", import.meta.url),
  "utf8",
);
const referralMapper = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/growth/mapper/ReferralRewardMapper.java", import.meta.url),
  "utf8",
);
const riskService = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/risk/application/OpsRiskService.java", import.meta.url),
  "utf8",
);
const clusterBatch = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/risk/application/MultiAccountClusterBatchService.java", import.meta.url),
  "utf8",
);

test("K1 uses canonical parameters and structured numeric controls without automatic freeze", () => {
  assert.match(component, /maxSignupPerIp24h/);
  assert.match(component, /maxAccountsPerDevice/);
  assert.match(component, /maxAccountsPerPaymentInstrument/);
  assert.match(component, /clusterFreezeSuggestThreshold/);
  assert.match(component, /type="number"/);
  assert.match(component, /Number\.isInteger/);
  assert.doesNotMatch(component, /autoFreezeHighCluster/);
  assert.doesNotMatch(component, /edit:\s*\{\s*kind:\s*"text"/);
});

test("K1 uses the current backend freeze-suggestion threshold instead of a display constant", () => {
  assert.match(component, /params\.find\(\(param\) => param\.key === "clusterFreezeSuggestThreshold"\)/);
  assert.match(component, /const freezeSuggestThreshold/);
  assert.match(component, /c\.strength >= freezeSuggestThreshold/);
  assert.doesNotMatch(component, /c\.strength >= 0\.7/);
  assert.doesNotMatch(component, /(?:0\.7|70%)[^0-9]/);
  assert.match(component, /formatThreshold\(freezeSuggestThreshold\)/);
  assert.match(registry, /达到当前服务端冻结建议阈值时标红/);
  assert.doesNotMatch(registry, /(?:≥\s*0\.7|70%)/);
});

test("K1 renders write actions only when the authenticated session has the exact authority", () => {
  assert.match(component, /useAdminAuth/);
  assert.match(component, /risk_k1_write/);
  assert.match(component, /risk_k1_cluster_flag/);
  assert.match(component, /risk_k1_cluster_freeze/);
  assert.match(component, /risk_k1_cluster_release/);
  assert.match(component, /risk_k1_cluster_cleared/);
});

test("K1 exposes server-side status and sort controls with accessible selected state", () => {
  assert.match(client, /clusterStatus/);
  assert.match(client, /clusterSort/);
  assert.match(component, /aria-pressed=\{layer === v\}/);
  assert.match(component, /关联账户数/);
  assert.match(component, /关联强度/);
});

test("K1 whitelist collects CIDR, separate note, future expiry and reason", () => {
  assert.match(component, /type="date"/);
  assert.match(component, /白名单备注/);
  assert.match(component, /失效日期/);
  assert.match(component, /isValidCidr/);
  assert.doesNotMatch(client, /expireText = "2026-12-31"/);
});

test("K1 shows unknown gift metrics truthfully and provides a dedicated duplicate-detection view", () => {
  assert.match(component, /statKnown/);
  assert.match(component, /数据尚未接入/);
  assert.match(component, /新人礼重复发放检测/);
  assert.doesNotMatch(component, /Number\(stats\[key\] \?\? 0\)/);
});

test("K1 uses real backend edges instead of synthesizing a center-entity star", () => {
  assert.match(client, /edgesJson/);
  assert.match(component, /c\.edges/);
  assert.doesNotMatch(component, />同一<\/text>/);
});

test("K1 keeps confirmation forms open until async work succeeds", () => {
  assert.match(kView, /await mc\.run/);
  assert.match(confirmModal, /await req\.run/);
  assert.match(confirmModal, /catch \{[\s\S]*请求实现负责展示面向用户的错误/);
  assert.match(confirmModal, /submitting/);
  assert.match(component, /draftSubmitLock\.current/);
  assert.match(component, /busy=\{draftSubmitting === "param"\}/);
  assert.match(component, /busy=\{draftSubmitting === "weight"\}/);
  assert.match(component, /busy=\{draftSubmitting === "whitelist"\}/);
});

test("K1 preserves command keys for uncertain retries and proxy identifies unknown outcomes", () => {
  assert.match(client, /K1OutcomeUncertainError/);
  assert.match(client, /commandKey/);
  assert.match(proxy, /X-Nexion-Upstream-Outcome/);
  assert.match(component, /commandAttempt/);
  assert.match(a2Client, /A2OutcomeUncertainError/);
  assert.match(platformProxy, /X-Nexion-Upstream-Outcome/);
  assert.match(proposer, /throw error/);
  assert.match(proposer, /A2 提案结果未知/);
  assert.match(proposer, /使用同一请求重试/);
});

test("K1 distinguishes confirmed write failures from unknown outcomes", () => {
  assert.match(component, /K1 操作失败/);
  assert.match(component, /本次写入未生效/);
  assert.match(component, /服务端数据未变化/);
  assert.match(component, /当前输入已保留/);
  assert.match(component, /confirmedK1FailureText\(error\)/);
});

test("K1 hides stale business data and write controls when refresh fails", () => {
  assert.match(component, /if \(ctx\.contentError\)/);
  assert.ok(component.indexOf("if (ctx.contentError)") < component.indexOf("return ("));
});

test("K1 separates confirmed writes from refresh failures", () => {
  assert.match(component, /已写入，但最新数据回读失败/);
  assert.match(component, /最新数据回读失败/);
  assert.match(component, /setParamDraft\(null\);[\s\S]*await ctx\.reloadKRisk/);
});

test("K1 carries the viewed projection version through A2 and direct review writes", () => {
  assert.match(component, /expectedVersion: c\.version/);
  assert.match(highOps, /expectedVersion: Number\(ctx\.expectedVersion\)/);
  assert.match(client, /\{ status, expectedVersion \}/);
  assert.match(client, /\{ expectedVersion \}/);
});

test("K1 keeps unknown gift and account status visibly unknown", () => {
  assert.match(client, /gotWelcomeGift == null \? "—"/);
  assert.match(component, /未接入/);
  assert.match(component, /unknown \? "dim"/);
});

test("K1 fields have semantic labels and all reasons use the 8 to 200 boundary", () => {
  assert.match(component, /htmlFor=\{`\$\{formId\}-param-value`\}/);
  assert.match(component, /htmlFor=\{`\$\{formId\}-cidr`\}/);
  assert.match(component, /maxLength=\{200\}/);
  assert.match(confirmModal, /reasonLength >= reasonMin && reasonLength <= reasonMax/);
  assert.match(confirmModal, /htmlFor=\{`\$\{fieldId\}-reason`\}/);
  assert.match(component, /reasonMax: 200/);
  assert.match(kView, /reasonMax=\{mc\.reasonMax\}/);
  assert.match(designKit, /reasonMax: requestedReasonMax/);
  assert.match(designKit, /<label htmlFor=\{reasonFieldId\}>操作理由/);
});

test("K1 translates network failures and lets keyboard users open a cluster", () => {
  assert.match(component, /暂时无法连接风险服务/);
  assert.match(errorMessages, /RISK_BACKEND_UNAVAILABLE/);
  assert.match(errorMessages, /风险服务当前不可用/);
  assert.match(errorMessages, /旧数据与写操作已隐藏/);
  assert.match(component, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(component, /tabIndex=\{focusBlocksSelection \? undefined : 0\}/);
});

test("K1 consumes all three authoritative evidence layers and real account context", () => {
  assert.match(backendMapper, /'ip'\s+AS layer/);
  assert.match(backendMapper, /nx_user_registration_otp/);
  assert.match(backendMapper, /'device'\s+AS layer/);
  assert.match(backendMapper, /nx_risk_decision/);
  assert.match(backendMapper, /'payment'\s+AS layer/);
  assert.match(backendMapper, /nx_wallet_bank_card/);
  assert.match(backendMapper, /sponsor_user_id AS sponsorUserId/);
  assert.match(backendMapper, /nx_referral_reward_settlement/);
  assert.match(backendMapper, /nx_wallet_ledger/);
  assert.match(backendMapper, /nx_user_wallet/);
  assert.doesNotMatch(backendMapper, /COALESCE\(u\.status,'ACTIVE'\)/);
  assert.doesNotMatch(component, /各入口执行链在跨模块验收补齐/);
});

test("K1 registration and reward-money entries fail closed on current server facts", () => {
  assert.match(registrationService, /maxSignupPerIp24h/);
  assert.match(registrationService, /countRegisteredAccountsByClientIp24h/);
  assert.match(registrationService, /USER_REGISTRATION_K1_IP_LIMIT/);
  assert.match(referralMapper, /nx_admin_risk_multi_account_cluster/);
  assert.match(referralMapper, /status IN \('detected','flagged','frozen'\)/);
});

test("K1 actions keep A2, C2, K4, J3, H8 and A4 on server-authoritative contracts", () => {
  assert.match(riskService, /delegatedDirectExecutionGuard/);
  assert.match(riskService, /userAccountControlFacade\.freezeActiveUsersByUserNos/);
  assert.match(riskService, /userAccountControlFacade\.restoreUsersFrozenBySource/);
  assert.match(clusterBatch, /RISK_MULTI_ACCOUNT_FLAGGED/);
  assert.match(clusterBatch, /EVENT_TYPE/);
  assert.match(referralMapper, /risk_cluster/);
});
