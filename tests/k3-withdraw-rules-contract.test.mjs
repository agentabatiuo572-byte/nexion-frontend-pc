import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../app/components/domain-views/k-tabs/k3-rules.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/k-client.ts", import.meta.url), "utf8");
const kView = readFileSync(new URL("../app/components/domain-views/k-view.tsx", import.meta.url), "utf8");
const verify = readFileSync(new URL("../scripts/verify.mjs", import.meta.url), "utf8");
const errorMessages = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");

test("K3 reads only its own overview and fails closed instead of exposing stale rules", () => {
  assert.match(client, /export async function fetchK3WithdrawRuleOverview/);
  assert.match(kView, /tab === "K3"[\s\S]*fetchK3WithdrawRuleOverview/);
  assert.match(component, /if \(ctx\.contentLoading\)/);
  assert.match(component, /if \(ctx\.contentError\)/);
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
});

test("K3 has truthful empty states, localized failures and a verify gate", () => {
  assert.match(component, /暂无提现风控规则/);
  assert.match(component, /暂无命中日志/);
  assert.match(component, /暂无路由结果数据/);
  assert.match(errorMessages, /K3_RULE_CONCURRENT_UPDATE/);
  assert.match(errorMessages, /RULE_CONDITION_INVALID/);
  assert.match(errorMessages, /K3_RULE_TRANSITION_INVALID/);
  assert.match(verify, /K3 contract/);
});
