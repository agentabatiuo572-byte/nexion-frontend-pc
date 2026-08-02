import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const view = read("../app/components/domain-views/f-view.tsx");
const types = read("../app/components/domain-views/f-tabs/types.ts");
const f1 = read("../app/components/domain-views/f-tabs/f1-vrank.tsx");
const f2 = read("../app/components/domain-views/f-tabs/f2-rates.tsx");
const f3 = read("../app/components/domain-views/f-tabs/f3-binary.tsx");
const f4 = read("../app/components/domain-views/f-tabs/f4-ops.tsx");
const f5 = read("../app/components/domain-views/f-tabs/f5-audit.tsx");

test("F 域上下文从真实登录会话统一提供 authority 判断", () => {
  assert.match(view, /useAdminAuth/);
  assert.match(types, /can:\s*\(authority:\s*string\)\s*=>\s*boolean/);
  assert.match(view, /role\s*===\s*"superadmin"/);
  assert.match(view, /authorities\s*\?\?\s*\[\]\)\.includes\(authority\)/);
});

test("F1 精确区分常规写、永久保护、人工晋升、重发与冲正", () => {
  for (const authority of [
    "network_f1_write",
    "network_f1_permanent_protection",
    "network_f1_promote_user",
    "network_f1_reward_reissue",
    "network_f1_reward_reverse",
  ]) assert.match(f1, new RegExp(authority));
  assert.match(f1, /\{canWrite && <button[^>]+className="rwd-add"/);
  assert.match(f1, /\{canProtect && <button/);
  assert.match(f1, /\{canPromote && <button/);
  assert.match(f1, /canReissuePayout && record\.status/);
  assert.match(f1, /canReversePayout && \["GRANTED"/);
});

test("F2 与 F3 按费率、政策、结算、配置和引擎暂停权限失败关闭", () => {
  assert.match(f2, /network_f2_royalty_rate/);
  assert.match(f2, /network_f2_policy_amplify/);
  assert.match(f2, /\{canPolicyAmplify && <button/);
  assert.match(f3, /network_f3_write/);
  assert.match(f3, /network_f3_match_rate/);
  assert.match(f3, /network_f3_engine_pause/);
  assert.match(f3, /\{canSettle && <button/);
  assert.match(f3, /\{canConfigure && <div className="cfg-foot"/);
  assert.match(f3, /\{canPause && <div className="cfg-foot"/);
});

test("F4 池、常规配置、大使与榜单权限互不替代", () => {
  for (const authority of [
    "network_f4_write",
    "network_f4_pool_fund",
    "network_f4_ambassador_approve",
    "network_f4_leaderboard_control",
  ]) assert.match(f4, new RegExp(authority));
  assert.match(f4, /\{canFund && <button/);
  assert.match(f4, /\{canWrite && <div className="sect-foot"/);
  assert.match(f4, /\{canApproveAmbassador && <div className="sect-foot"/);
  assert.match(f4, /\{canControlLeaderboard && <button/);
  assert.match(f4, /onClick=\{canFund \?/);
});

test("F5 异常阈值、补发、冲正与暂停使用对应后端 authority", () => {
  assert.match(f5, /network_f5_write/);
  assert.match(f5, /network_f5_commission_dispose/);
  assert.match(f5, /network_f5_commission_reject/);
  assert.match(f5, /const reissueAvailable = canDispose && !ctx\.f5Error && !!data;/);
  assert.match(f5, /\{reissueAvailable && <button[^>]+onClick=\{reissue\}/);
  assert.match(f5, /canReject && row\.status/);
  assert.match(f5, /\{canReject && <button[^>]+onClick=\{\(\) => suspend\(row\)\}/);
  assert.match(f5, /\{canWrite && <button[^>]+onClick=\{editThreshold\}/);
});
