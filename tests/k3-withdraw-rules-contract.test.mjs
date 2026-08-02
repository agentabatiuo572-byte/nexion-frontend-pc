import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../app/components/domain-views/k-tabs/k3-rules.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/k-client.ts", import.meta.url), "utf8");
const kView = readFileSync(new URL("../app/components/domain-views/k-view.tsx", import.meta.url), "utf8");
const verify = readFileSync(new URL("../scripts/verify.mjs", import.meta.url), "utf8");
const errorMessages = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");
const liveAcceptance = readFileSync(new URL("./e2e/k3-final-acceptance-20260722.spec.ts", import.meta.url), "utf8");
const j1GateGuard = readFileSync(new URL("./e2e/k3-j1-gate-guard-20260728.spec.ts", import.meta.url), "utf8");
const final7UiGuard = readFileSync(new URL("./e2e/k3-final7-ui-gate-acceptance.spec.ts", import.meta.url), "utf8");

test("K3 reads only its own overview and fails closed instead of exposing stale rules", () => {
  assert.match(client, /export async function fetchK3WithdrawRuleOverview/);
  assert.match(client, /K3_RESPONSE_INVALID/);
  assert.match(client, /requiredK3Record/);
  assert.match(client, /requiredK3Array/);
  assert.match(client, /requiredK3RuleAction/);
  assert.match(client, /requiredK3RuleState/);
  assert.match(kView, /tab === "K3"[\s\S]*fetchK3WithdrawRuleOverview/);
  assert.match(component, /if \(ctx\.contentLoading\)/);
  assert.match(component, /if \(ctx\.contentError\)/);
  assert.match(component, /authorities\.includes\("risk_k3_write"\)\s*&&\s*!ctx\.contentLoading\s*&&\s*!ctx\.contentError/);
  assert.ok(component.indexOf("if (ctx.contentError)") < component.lastIndexOf("return <div>"));
  assert.match(component, /仅重试 K3/);
});

test("K3 executes direct business writes, awaits completion and refreshes authoritative data", () => {
  assert.doesNotMatch(component, /usePropose|findHighOp|void propose|void runAction/);
  assert.match(component, /await work\(commandKey\)/);
  assert.match(component, /ctx\.actions\.createK3Rule/);
  assert.match(component, /ctx\.actions\.updateK3RuleState/);
  assert.match(component, /ctx\.actions\.updateK3Rule/);
  assert.match(component, /ctx\.actions\.archiveK3Rule/);
  assert.match(component, /await ctx\.reloadKRisk/);
  assert.match(component, /K1OutcomeUncertainError/);
  assert.match(component, /commandAttempt/);
});

test("K3 safely parses legacy conditions and blocks unknown formats", () => {
  assert.match(component, /\(\?:单笔\|single\)\\s\*/i);
  assert.match(component, /conditionParseError/);
  assert.match(component, /当前条件格式无法安全编辑/);
  assert.doesNotMatch(component, /matched\?\.\[2\], "1000"/);
});

test("K3 carries priority, projection version and expectedVersion through every mutation", () => {
  assert.match(client, /export type K3Rule =[\s\S]*priority: number;[\s\S]*version: number;/);
  assert.match(client, /createK3Rule:[\s\S]*priority:[\s\S]*commandKey/);
  assert.match(client, /updateK3RuleState:[\s\S]*expectedVersion:[\s\S]*commandKey/);
  assert.match(client, /updateK3Rule:[\s\S]*conditionText:[\s\S]*action:[\s\S]*priority:[\s\S]*expectedVersion/);
  assert.match(client, /archiveK3Rule:[\s\S]*expectedVersion/);
  assert.match(component, /priority/);
});

test("K3 permission gates match the dedicated backend authorities", () => {
  assert.match(component, /useAdminAuth/);
  assert.match(component, /risk_k3_write/);
  assert.match(component, /risk_k3_rule_create/);
  assert.match(component, /risk_k3_rule_toggle/);
  assert.match(component, /risk_k3_rule_archive/);
  assert.match(component, /canDryRun/);
});

test("K3 structured create form reveals only the selected dimension and never configures pass", () => {
  assert.match(component, /visibleWhen: \{ key: "dimension", equals: "金额" \}/);
  assert.match(component, /visibleWhen: \{ key: "dimension", equals: "速度" \}/);
  assert.match(component, /visibleWhen: \{ key: "dimension", equals: "新账户" \}/);
  assert.match(component, /visibleWhen: \{ key: "dimension", equals: "地址信誉" \}/);
  assert.doesNotMatch(component, /ACTION_OPTIONS[^\n]*pass/);
  assert.match(component, /优先级/);
});

test("K3 exposes only the exact address source enum and the server-authoritative low threshold", () => {
  assert.match(component, /ADDRESS_SOURCE_OPTIONS\s*=\s*\["内部",\s*"第三方",\s*"组合"\]/);
  assert.match(component, /addressReputationSource=/);
  assert.match(component, /addressReputationLowThreshold=/);
  assert.match(component, /label:\s*"低信誉阈值"/);
  assert.match(component, /min:\s*0/);
  assert.match(component, /max:\s*1/);
  assert.match(component, /内部不调用外部服务/);
  assert.match(component, /第三方或组合使用真实链上信誉服务/);
});

test("K3 dry-run returns an operator-visible batch result", () => {
  assert.match(client, /export type K3DryRunResult/);
  assert.match(client, /batchNo/);
  assert.match(client, /evaluatedWithdrawals/);
  assert.match(client, /hitCount/);
  assert.match(component, /模拟批次/);
  assert.match(component, /评估提现/);
  assert.match(component, /命中次数/);
  assert.match(component, /路由结果/);
  assert.match(component, /COMPLETED:\s*"已完成"/);
  assert.match(component, /dryRunStatusLabel\(dryRunResult\.status\)/);
  assert.doesNotMatch(component, /· \{dryRunResult\.status\}/);
  assert.match(client, /normalizeK3DryRunForWrite/);
  assert.match(client, /new K1OutcomeUncertainError/);
  assert.match(client, /const stableCommandKey = commandKey \?\? newK1CommandKey\(\)/);
  assert.match(client, /return normalizeK3DryRunForWrite\(value, stableCommandKey\)/);
  assert.match(component, /function isOutcomeUncertain/);
  assert.match(component, /commandAttempt\.current = null/);
  assert.match(component, /if \(!outcomeUncertain\) commandAttempt\.current = null/);
  assert.match(component, /setDryRunError\(message\)/);
  assert.match(component, /role="alert"/);
  assert.match(component, /结果暂不确定，请使用原操作重试/);
});

test("K3 has truthful empty states, localized failures and a verify gate", () => {
  assert.match(component, /暂无提现风控规则/);
  assert.match(component, /暂无命中日志/);
  assert.match(component, /暂无路由结果数据/);
  assert.match(errorMessages, /K3_RULE_CONCURRENT_UPDATE/);
  assert.match(errorMessages, /K3_RESPONSE_INVALID/);
  assert.match(errorMessages, /RULE_CONDITION_INVALID/);
  assert.match(errorMessages, /K3_RULE_TRANSITION_INVALID/);
  assert.match(verify, /K3 contract/);
});

test("K3 dimension cards keep unique React identity when multiple rules share one dimension", () => {
  assert.match(component, /key=\{`\$\{dimension\.ruleKey\}-\$\{dimension\.ruleId\}`\}/);
  assert.doesNotMatch(component, /key=\{dimension\.ruleKey\}/);
});

test("K3 isolated withdrawal fixture creates its own paired KYC profile", () => {
  assert.match(liveAcceptance, /INSERT INTO nx_kyc_profile/);
  assert.match(liveAcceptance, /ON DUPLICATE KEY UPDATE/);
  assert.doesNotMatch(liveAcceptance, /\n\s*UPDATE nx_kyc_profile\n/);
});

test("K3 isolated withdrawal fixture seeds and exactly cleans D4 authoritative opening balance", () => {
  assert.match(liveAcceptance, /K3_D4_OPENING_BIZ_NO/);
  assert.match(liveAcceptance, /K3_D4_NEX_OPENING_BIZ_NO/);
  assert.match(liveAcceptance, /INSERT INTO nx_wallet_ledger/);
  assert.match(liveAcceptance, /'K3_ACCEPTANCE_OPENING','USDT','IN',10000,10000,'POSTED'/);
  assert.match(liveAcceptance, /'K3_ACCEPTANCE_OPENING','NEX','IN',100,100,'POSTED'/);
  assert.match(liveAcceptance, /biz_no='\$\{K3_D4_OPENING_BIZ_NO\}'/);
  assert.match(liveAcceptance, /biz_no='\$\{K3_D4_NEX_OPENING_BIZ_NO\}'/);
});

test("K3 repeated MFA logins wait for the next real TOTP window without a fixed sleep", () => {
  assert.match(liveAcceptance, /await expect\.poll\(\(\) => Math\.floor\(Date\.now\(\) \/ 30_000\)/);
  assert.match(liveAcceptance, /timeout: 35_000/);
  assert.doesNotMatch(liveAcceptance, /waitForTimeout\(30_000\)/);
});

test("K3 high-risk run is guarded by a real J1 API toggle and exact snapshot restoration", () => {
  assert.match(j1GateGuard, /K3_J1_ALLOW_PENDING_CAS/);
  assert.match(j1GateGuard, /auto-confirm\.pending/);
  assert.match(j1GateGuard, /\/api\/admin\/emergency\/kill-switches\/withdraw/);
  assert.match(j1GateGuard, /triggerBasis: "安全事件"/);
  assert.match(j1GateGuard, /restoreMutableRows\(before\)/);
  assert.match(j1GateGuard, /auto-confirm\.lastReminderAt/);
  assert.match(j1GateGuard, /nx_admin_idempotency_record/);
  assert.match(j1GateGuard, /nx_treasury_reserve_ledger/);
  assert.match(j1GateGuard, /COVERAGE_BELOW_REDLINE/);
  assert.match(j1GateGuard, /assertCoverageRestored/);
  assert.match(j1GateGuard, /k3-final-acceptance-20260722\.spec\.ts/);
});

test("K3 Final7 carrier binds the candidate and global lock while creating the B1/J1 precondition through visible UI", () => {
  assert.match(final7UiGuard, /K3_FINAL7_EXPECTED_BUILD_ID/);
  assert.match(final7UiGuard, /K3_FINAL7_EXPECTED_JAR_SHA256/);
  assert.match(final7UiGuard, /K3_FINAL7_GLOBAL_LOCK_TOKEN/);
  assert.match(final7UiGuard, /GLOBAL_J1\+B1/);
  assert.match(final7UiGuard, /MFA_BYPASS_MUST_BE_FALSE/);
  assert.match(final7UiGuard, /K3_FINAL7_MANIFEST_RUN_MISMATCH/);
  assert.match(final7UiGuard, /K3_FINAL7_MANIFEST_CANDIDATE_MISMATCH/);
  assert.match(final7UiGuard, /a\[href="\/overview\/dual-ledger"\]/);
  assert.doesNotMatch(final7UiGuard, /getByText\("双账本总览", \{ exact: true \}\)/);
  assert.match(final7UiGuard, /getByRole\("heading", \{ name: "双账本总览", exact: true \}\)/);
  assert.match(final7UiGuard, /getByRole\("button", \{ name: "登记储备注入" \}\)/);
  assert.match(final7UiGuard, /a\[href="\/emergency\/kill-switch"\]/);
  assert.match(final7UiGuard, /getByRole\("button", \{ name: "恢复", exact: true \}\)/);
  assert.match(final7UiGuard, /getByRole\("button", \{ name: "关停", exact: true \}\)/);
  assert.match(final7UiGuard, /getByRole\("button", \{ name: "恢复受阻", exact: true \}\)/);
  assert.match(final7UiGuard, /page\.request\.put\("\/api\/admin\/emergency\/kill-switches\/withdraw/);
  assert.doesNotMatch(final7UiGuard, /INSERT INTO nx_treasury_reserve_ledger/);
  assert.match(final7UiGuard, /COVERAGE_BELOW_REDLINE/);
  assert.match(final7UiGuard, /X-Nexion-Upstream-Outcome/);
  assert.match(final7UiGuard, /route\.fetch\(\)/);
  assert.match(final7UiGuard, /upstreamCommitted/);
  assert.match(final7UiGuard, /idempotency-key/i);
  assert.match(final7UiGuard, /casRejected/);
  assert.match(final7UiGuard, /nx_audit_log/);
  assert.match(final7UiGuard, /nx_event_outbox/);
  assert.match(final7UiGuard, /DELETE FROM nx_treasury_reserve_ledger/);
  assert.match(final7UiGuard, /k3-final-acceptance-20260722\.spec\.ts/);
  assert.match(final7UiGuard, /redactSensitive/);
});

test("K3 Final7 reserve fingerprint follows the deployed reserve ledger schema", () => {
  assert.doesNotMatch(final7UiGuard, /amount_usd,currency,voucher_no/);
  assert.doesNotMatch(final7UiGuard, /SEPARATOR\s+CHAR\s*\(/i);
  assert.match(final7UiGuard, /SEPARATOR\s+0x1E/i);
  for (const column of [
    "reserve_no", "voucher_no", "direction", "amount_usd", "reason",
    "operator", "idempotency_key", "status", "created_at", "updated_at", "is_deleted",
  ]) {
    assert.match(final7UiGuard, new RegExp(`\\b${column}\\b`));
  }
});

test("K3 Final7 unknown-result carrier waits for the routed response and cleans its exact voucher even on early failure", () => {
  const alertCheck = final7UiGuard.indexOf('await expect(injectionDialog.getByRole("alert"))');
  const upstreamCheck = final7UiGuard.indexOf("expect(injectionUpstreamStatus).toBe(200)");
  assert.ok(alertCheck >= 0 && upstreamCheck >= 0 && alertCheck < upstreamCheck);
  const resumeAlertCheck = final7UiGuard.indexOf('await expect(resumeDialog.getByRole("alert"))');
  const resumeUpstreamCheck = final7UiGuard.indexOf("expect(resumeUpstreamStatus).toBe(200)");
  assert.ok(resumeAlertCheck >= 0 && resumeUpstreamCheck >= 0 && resumeAlertCheck < resumeUpstreamCheck);
  assert.ok((final7UiGuard.match(/status:\s*503/g) ?? []).length >= 2);
  assert.ok((final7UiGuard.match(/X-Nexion-Upstream-Outcome":\s*"unknown"/g) ?? []).length >= 2);
  assert.match(final7UiGuard, /status of \(\?:401\|403\|409\|422\|502\|503\)/);
  assert.match(final7UiGuard, /DELETE FROM nx_treasury_reserve_ledger[\s\S]*voucher_no=\$\{sqlValue\(VOUCHER\)\}/);
});
