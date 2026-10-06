import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const view = read("../app/components/domain-views/f-view.tsx");
const types = read("../app/components/domain-views/f-tabs/types.ts");
const f1 = read("../app/components/domain-views/f-tabs/f1-vrank.tsx");
const f2 = read("../app/components/domain-views/f-tabs/f2-rates.tsx") + read("../app/components/domain-views/f-tabs/f2-direct-policy.tsx");
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

test("F2 七层购买参数恢复既有 A2 命令分发且不放开未接入参数", () => {
  const source = ts.createSourceFile("f-view.tsx", view, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = source.statements.filter((statement) =>
    (ts.isFunctionDeclaration(statement) && statement.name?.text === "resolveFOp")
    || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => declaration.name.getText(source) === "F_ACTIVE_KEYS")));
  assert.equal(selected.length, 2);
  const body = ts.transpileModule(selected.map((statement) => statement.getText(source)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const resolve = new Function(body + "\nreturn resolveFOp;")();
  for (let layer = 1; layer <= 7; layer++) {
    assert.equal(resolve(`F.unilevel.L${layer}`), "f_unilevel_rule");
    assert.equal(resolve(`F.unilevel.nex.L${layer}`), "f_unilevel_rule");
    assert.equal(resolve(`F.unilevel.L${layer}.paused`), "f_ui_config");
  }
  for (const key of ["F.unilevel.depthGate", "F.unilevel.depthGateRank", "F.unilevel.mergeExitMaxPct", "F.influence.clampMin", "F.influence.clampMax", "F.promo.weekMultiplier", "F.cooldown", "F.partner.tiers"]) {
    assert.equal(resolve(key), "f_ui_config", key);
  }
  for (const key of ["F.unilevel.depth", "F.unilevel.nexCap", "F.unilevel.backfill", "F.unilevel.L8", "F.unilevel.L1junk", "F.unilevel.nex.L1.paused"]) {
    assert.throws(() => resolve(key), /未接入结算/, key);
  }
});

test("F4 池、常规配置、大使与榜单权限互不替代", () => {
  for (const authority of [
    "network_f4_write",
    "network_f4_pool_fund",
    "network_f4_ambassador_approve",
    "network_f4_leaderboard_control",
  ]) assert.match(f4, new RegExp(authority));
  assert.match(f4, /\{canFund && <button/);
  assert.match(f4, /\{canWrite && <button/);
  assert.match(f4, /\{canApproveAmbassador && application\.status\.toUpperCase\(\) === "PENDING"/);
  assert.match(f4, /\{canControlLeaderboard && <button/);
  assert.match(f4, /onClick=\{canFund \?/);
});

test("F5 异常阈值、补发、冲正与暂停使用对应后端 authority", () => {
  assert.match(f5, /network_f5_write/);
  assert.match(f5, /network_f5_commission_dispose/);
  assert.match(f5, /network_f5_commission_reject/);
  assert.match(f5, /const reissueAvailable = canDispose && !ctx\.f5Error && !!data;/);
  assert.match(f5, /\{reissueAvailable && <button[^>]+onClick=\{reissue\}/);
  assert.match(f5, /canReject && !\["reversed", "withdrawn", "rejected", "recovery_pending"\]\.includes\(row\.status\)/);
  assert.match(f5, /\{canReject && <button[^>]+onClick=\{\(\) => suspend\(row\)\}/);
  assert.match(f5, /\{canWrite && <button[^>]+onClick=\{editThreshold\}/);
});

test("F5 单笔冻结/提前解锁/解冻按状态渲染且全部挂处置 authority(合并底账 §二#4 恢复)", () => {
  assert.match(f5, /\{canDispose && row\.status === "cooling" && <button[^>]+onClick=\{\(\) => dispose\("freeze", row\)\}/);
  assert.match(f5, /\{canDispose && row\.status === "cooling" && !directGroup\(row\) && <button[^>]+onClick=\{\(\) => dispose\("unlock", row\)\}/);
  assert.match(f5, /\{canDispose && row\.status === "frozen" && <button[^>]+onClick=\{\(\) => dispose\("unfreeze", row\)\}/);
});
