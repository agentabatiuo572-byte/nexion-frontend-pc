import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../app/components/domain-views/k-tabs/k5-kyc.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/k-client.ts", import.meta.url), "utf8");
const contract = readFileSync(new URL("../lib/admin/k5-contract.ts", import.meta.url), "utf8");
const kView = readFileSync(new URL("../app/components/domain-views/k-view.tsx", import.meta.url), "utf8");
const errors = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");
const verify = readFileSync(new URL("../scripts/verify.mjs", import.meta.url), "utf8");

test("K5 reads only its own overview and fails closed on load or payload errors", () => {
  assert.match(client, /export async function fetchK5KycReviewOverview/);
  assert.match(kView, /tab === "K5"[\s\S]*fetchK5KycReviewOverview/);
  assert.match(kView, /kycReview: undefined/);
  assert.match(component, /if \(ctx\.contentLoading\)/);
  assert.match(component, /if \(ctx\.contentError\)/);
  assert.ok(component.indexOf("if (ctx.contentError)") < component.lastIndexOf("return ("));
  assert.match(component, /仅重试 K5/);
  assert.match(client, /K5_RESPONSE_INVALID/);
  assert.match(client, /requiredK5String/);
  assert.match(client, /requiredK5Number/);
});

test("K5 direct writes are permission-gated, awaited and refresh authoritative state", () => {
  assert.match(component, /useAdminAuth/);
  for (const authority of [
    "risk_k5_write",
    "risk_k5_ticket_manual",
    "risk_k5_ticket_pass",
    "risk_k5_ticket_reject",
  ]) assert.match(component, new RegExp(authority));
  assert.doesNotMatch(component, /usePropose|findHighOp|void propose|void runAction/);
  assert.match(component, /ctx\.actions\.updateK5Param/);
  assert.match(component, /ctx\.actions\.decideK5Ticket/);
  assert.match(component, /ctx\.actions\.createK5ManualTicket/);
  assert.match(component, /ctx\.actions\.searchK5Users/);
  assert.match(component, /请先从真实用户候选中选择账户/);
  assert.match(component, /await ctx\.reloadKRisk/);
});

test("K5 preserves command keys and versions across retries and rejects stale terminal writes", () => {
  assert.match(component, /K1OutcomeUncertainError/);
  assert.match(component, /commandAttempts/);
  assert.match(component, /commandKey/);
  assert.match(client, /updateK5Param:[\s\S]*expectedVersion:[\s\S]*commandKey/);
  assert.match(client, /decideK5Ticket:[\s\S]*expectedVersion:[\s\S]*reasonCode:[\s\S]*commandKey/);
  assert.match(client, /createK5ManualTicket:[\s\S]*commandKey/);
  assert.match(client, /normalizeK5ManualResultForWrite/);
  assert.match(client, /new K1OutcomeUncertainError\([\s\S]*commandKey/);
  assert.match(client, /createK5ManualTicket:[\s\S]*stableCommandKey[\s\S]*normalizeK5ManualResultForWrite/);
  assert.match(client, /version: number/);
});

test("K5 exposes only the four owned parameters and uses structured valid forms", () => {
  for (const key of [
    "largeWithdrawReviewUsdt",
    "cumulativeKycThresholdUsdt",
    "reviewSlaDays",
    "reviewTriggerScore",
  ]) assert.match(component, new RegExp(key));
  assert.doesNotMatch(component, /largeExchangeReviewUsdt/);
  assert.match(component, /p\.adjustable/);
  assert.match(component, /canWrite/);
  assert.doesNotMatch(component, /nx_admin_risk_param/);
  assert.match(client, /validateK5ParamValue/);
  assert.match(contract, /largeWithdrawReviewUsdt[\s\S]*100[\s\S]*50000/);
  assert.match(contract, /cumulativeKycThresholdUsdt[\s\S]*50[\s\S]*1000/);
  assert.match(contract, /reviewSlaDays[\s\S]*1[\s\S]*15/);
  assert.match(contract, /reviewTriggerScore[\s\S]*70[\s\S]*100/);
  assert.doesNotMatch(component, /\?\? defaultK5Line/);
});

test("K5 alert subscription is persisted with structured choices", () => {
  assert.match(client, /K5AlertSubscription/);
  assert.match(client, /updateK5AlertSubscription/);
  assert.match(component, /type="checkbox"/);
  assert.match(component, /alertTypes/);
  assert.match(component, /channels/);
  assert.match(component, /ctx\.actions\.updateK5AlertSubscription/);
  assert.doesNotMatch(component, /告警订阅已保存"\)/);
  assert.match(component, /暂无异常告警/);
  assert.match(client, /K5_ALERT_TYPES/);
  assert.match(client, /K5_ALERT_CHANNELS/);
  assert.match(client, /K5_ALERT_TONES/);
  assert.match(contract, /new Set\(values\)/);
  assert.match(component, /保存订阅/);
  assert.doesNotMatch(component, /action: "告警订阅配置"/);
  assert.match(component, /large-withdraw-burst/);
  assert.match(component, /短时大额集中/);
  assert.match(contract, /large-withdraw-burst/);
  assert.doesNotMatch(component, /工作邮箱/);
  assert.doesNotMatch(contract, /"email"/);
});

test("K5 decision UI explains impact and requires a rejection reason code", () => {
  assert.match(component, /reasonCode/);
  assert.match(component, /驳回原因/);
  assert.match(component, /回到 D2 人工审核队列/);
  assert.match(component, /C4/);
  assert.match(component, /D2/);
  assert.match(component, /G2/);
  assert.match(component, /SANCTIONS_LIST_MATCH/);
  assert.match(component, /制裁名单关联/);
  assert.match(component, /decisionEvidence/);
  assert.match(component, /完整复审历史/);
  assert.match(component, /关联 D2 提现单/);
  assert.ok((component.match(/reasonMax:\s*200/g) ?? []).length >= 2, "decision and parameter confirmations must enforce the backend 200-character reason limit");
  assert.doesNotMatch(component, /stopPropagation/);
  assert.doesNotMatch(component, /<th style=\{\{ textAlign: "right" \}\}>动作<\/th>/);
});

test("K5 direct low-risk actions do not pretend to require a high-risk confirmation", () => {
  assert.match(component, /directManualTrigger/);
  assert.doesNotMatch(component, /action: "手动补触发复审"/);
  assert.match(component, /触发与裁决均保留审计/);
  assert.match(component, /manualTriggering/);
  assert.match(component, /触发中…/);
  assert.match(component, /disabled=\{manualTriggering/);
  assert.match(client, /K5ManualResult/);
  assert.match(client, /manualResult/);
  assert.match(component, /lastManualResult/);
  assert.match(component, /已并入工单/);
  assert.match(component, /已新建工单/);
});

test("K5 executable response contract rejects malformed values and unknown enums", async () => {
  const module = await import(new URL("../lib/admin/k5-contract.ts", import.meta.url));
  assert.equal(module.validateK5ParamValue("largeWithdrawReviewUsdt", ">= $1,000"), true);
  assert.equal(module.validateK5ParamValue("largeWithdrawReviewUsdt", ">= $99"), false);
  assert.equal(module.validateK5ParamValue("largeWithdrawReviewUsdt", ">= $1,,000"), false);
  assert.equal(module.validateK5ParamValue("cumulativeKycThresholdUsdt", "$1,000"), true);
  assert.equal(module.validateK5ParamValue("cumulativeKycThresholdUsdt", "$1,001"), false);
  assert.equal(module.validateK5ParamValue("reviewSlaDays", "15"), true);
  assert.equal(module.validateK5ParamValue("reviewSlaDays", "16"), false);
  assert.equal(module.validateK5ParamValue("reviewTriggerScore", ">= 70"), true);
  assert.equal(module.validateK5ParamValue("reviewTriggerScore", ">= 101"), false);
  assert.equal(module.hasExactAllowedValues(["threshold-hit"], module.K5_ALERT_TYPES), true);
  assert.equal(module.hasExactAllowedValues(["threshold-hit", "threshold-hit"], module.K5_ALERT_TYPES), false);
  assert.equal(module.hasExactAllowedValues(["unknown"], module.K5_ALERT_TYPES), false);
  assert.equal(module.hasExactAllowedValues([], module.K5_ALERT_CHANNELS), false);
  assert.equal(module.validateK5Stats({ openTickets: 3, reviewOverdue: 2, reviewDecidedMonth: 4, reviewDecidedPass: 3, reviewFrozenUsd: 10 }), true);
  assert.equal(module.validateK5Stats({ openTickets: 1, reviewOverdue: 2, reviewDecidedMonth: 4, reviewDecidedPass: 3, reviewFrozenUsd: 10 }), false);
  assert.equal(module.validateK5Stats({ openTickets: 3, reviewOverdue: 2, reviewDecidedMonth: 2, reviewDecidedPass: 3, reviewFrozenUsd: 10 }), false);
  assert.deepEqual(module.K5_KYC_STATUSES, ["APPROVED", "PENDING", "NONE", "REJECTED", "USER_UNAVAILABLE"]);
  assert.deepEqual(module.K5_TICKET_TYPES, ["大额提现", "大额兑换", "累计过线", "手动触发", "风险分触发"]);
  assert.equal(module.hasAllowedK5AlertEventKey("threshold-hit:KR-1:1"), true);
  assert.equal(module.hasAllowedK5AlertEventKey("sla-breach:KR-1:1"), true);
  assert.equal(module.hasAllowedK5AlertEventKey("large-withdraw-burst:2026071705"), true);
  assert.equal(module.hasAllowedK5AlertEventKey("unknown:KR-1:1"), false);
});

test("K5 translates authoritative C4 KYC states for operators", () => {
  assert.match(component, /K5_KYC_LABELS/);
  assert.match(component, /APPROVED:\s*"已通过"/);
  assert.match(component, /PENDING:\s*"复审中"/);
  assert.match(component, /NONE:\s*"未认证"/);
  assert.match(component, /REJECTED:\s*"已拒绝"/);
  assert.match(component, /USER_UNAVAILABLE:\s*"用户不可用"/);
  assert.match(client, /K5_KYC_STATUSES/);
  assert.match(client, /K5_TICKET_TYPES/);
  assert.match(client, /hasAllowedK5AlertEventKey/);
  assert.match(client, /eventKey/);
  assert.match(component, /key=\{a\.eventKey\}/);
  assert.match(component, /sourceDomain:\s*"来源模块"/);
  assert.match(component, /sourceNo:\s*"来源单号"/);
  assert.match(component, /KYC_REVIEW_PASSED:\s*"复审通过"/);
  assert.match(component, /KYC_MATERIAL_INVALID:\s*"材料不符"/);
  assert.match(component, /displayK5Info/);
  assert.match(component, /displayK5History/);
  assert.doesNotMatch(component, /key=\{kv\[0\]\}/);
  assert.match(component, /\["手动触发", "手动触发"\]/);
  assert.match(component, /\["风险分触发", "风险分触发"\]/);
  assert.match(component, /已自动告警 · 待人工处置/);
  assert.doesNotMatch(component, /已自动告警 \+ 升级/);
});

test("K5 localized errors participate in the repository verify gate", () => {
  for (const code of [
    "K5_REVIEW_TICKET_CONCURRENT_UPDATE",
    "K5_REVIEW_TICKET_TERMINAL",
    "K5_REVIEW_USER_NOT_FOUND",
    "K5_REVIEW_DECISION_FORBIDDEN",
    "K5_ALERT_SUBSCRIPTION_INVALID",
    "K5_PARAM_CONCURRENT_UPDATE",
  ]) assert.match(errors, new RegExp(code));
  assert.match(verify, /K5 contract/);
});
