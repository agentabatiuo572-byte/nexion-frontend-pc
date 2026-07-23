import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../app/components/domain-views/k-tabs/k4-scoring.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/k-client.ts", import.meta.url), "utf8");
const kView = readFileSync(new URL("../app/components/domain-views/k-view.tsx", import.meta.url), "utf8");
const errors = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");
const verify = readFileSync(new URL("../scripts/verify.mjs", import.meta.url), "utf8");

test("K4 loads only its own overview and fails closed on loading errors", () => {
  assert.match(client, /export async function fetchK4ScoringOverview/);
  assert.match(kView, /tab === "K4"[\s\S]*fetchK4ScoringOverview/);
  assert.match(kView, /scoring: undefined/);
  assert.match(component, /if \(ctx\.contentLoading\)/);
  assert.match(component, /if \(ctx\.contentError\)/);
  assert.ok(component.indexOf("if (ctx.contentError)") < component.lastIndexOf("return ("));
  assert.match(component, /仅重试 K4/);
});

test("K4 rejects malformed authoritative payloads instead of inventing defaults", () => {
  assert.match(client, /function requiredK4Record/);
  assert.match(client, /function requiredK4Number/);
  assert.match(client, /function requiredK4String/);
  assert.match(client, /K4_DIMENSION_KEYS/);
  assert.match(client, /K4_RESPONSE_INVALID/);
  assert.doesNotMatch(client, /bandLowMax:\s*num\(config\.bandLowMax,\s*40\)/);
  assert.doesNotMatch(client, /effectiveScore:\s*num\(data\.effectiveScore,\s*num\(data\.modelScore\)\)/);
});

test("K4 model changes honor A6 draft authority but keep publication superadmin-only", () => {
  assert.match(client, /export type K4ModelState = "draft" \| "active" \| "archived"/);
  assert.match(client, /model: K4Model/);
  assert.match(client, /draft: K4Model \| null/);
  assert.match(client, /saveK4ModelDraft:[\s\S]*expectedVersion:[\s\S]*commandKey/);
  assert.match(client, /publishK4ModelDraft:[\s\S]*expectedVersion:[\s\S]*commandKey/);
  assert.match(client, /\/scoring\/model\/draft/);
  assert.match(client, /\/scoring\/model\/publish/);
  assert.doesNotMatch(component, /updateK4Weights|updateK4Source|updateK4Band|updateK4Escalate/);
  assert.match(component, /保存模型草稿/);
  assert.match(component, /发布模型草稿/);
  assert.match(component, /expectedVersion/);
  assert.match(component, /modelDirty/);
  assert.match(component, /请先保存当前修改，再发布最新草稿/);
  assert.match(component, /disabled=\{modelDirty\}/);
  assert.match(component, /没有待保存的模型修改/);
  assert.match(component, /disabled=\{!modelValid \|\| !mappingsValid \|\| !modelDirty\}/);
  assert.match(component, /modelPublishDiff\(overview\.model, draft, overview\.dimensions\)/);
  assert.match(component, /发布即触发按 200 人分片的全量重算/);
  assert.match(component, /影响 D2 路由、B5 点亮与 C1 展示分/);
  assert.match(component, /子分映射版本快照/);
  assert.match(component, /scoreMappings/);
  assert.match(component, /模型版本历史/);
  assert.match(component, /restoreK4ModelDraft/);
  assert.match(component, /disabled=\{modelDirty\}/);
  assert.match(component, /完整覆盖当前待发布草稿/);
  assert.match(component, /全量重算回模型分/);
  assert.match(component, /recomputeK4Scores/);
  assert.match(component, /overview\.model\.version, reason, commandKey/);
  assert.match(client, /expectedModelVersion/);
  assert.match(client, /weights: Object\.fromEntries\(K4_DIMENSION_KEYS\.map\(\(key\) => \[key, input\.weights\[key\] \/ 100\]\)\)/);
  assert.match(component, /const canModelWrite = authorities\.includes\("risk_k4_write"\)/);
  assert.match(component, /const canPublish = isSuperAdmin && authorities\.includes\("risk_k4_write"\)/);
  assert.match(component, /\{canModelWrite && model\.state === "archived"/);
  assert.doesNotMatch(component, /K4 模型写入当前按服务端边界仅向超级管理员开放/);
});

test("K4 actions are permission-gated direct writes that return their promises", () => {
  assert.match(component, /useAdminAuth/);
  assert.match(component, /risk_k4_write/);
  assert.match(component, /risk_k4_user_override/);
  assert.match(component, /risk_k4_user_recompute/);
  assert.match(component, /const isSuperAdmin = session\?\.role === "superadmin"/);
  assert.match(component, /const canModelWrite = authorities\.includes\("risk_k4_write"\)/);
  assert.match(component, /const canOverride = authorities\.includes\("risk_k4_user_override"\)/);
  assert.doesNotMatch(component, /usePropose|findHighOp|void propose|void runAction/);
  assert.match(component, /ctx\.actions\.overrideK4Score/);
  assert.match(component, /ctx\.actions\.recomputeK4Score/);
  assert.match(component, /return runAction/);
  assert.match(component, /await loadUser/);
});

test("K4 preserves idempotency keys across uncertain retries", () => {
  assert.match(component, /K1OutcomeUncertainError/);
  assert.match(component, /commandAttempts/);
  assert.match(component, /commandKey/);
  assert.match(client, /overrideK4Score:[\s\S]*expectedVersion:[\s\S]*commandKey/);
  assert.match(client, /recomputeK4Score:[\s\S]*expectedVersion:[\s\S]*commandKey/);
});

test("K4 clears stale user details before lookup and exposes truthful empty states", () => {
  assert.match(component, /onChange=\{\(event\) => \{[\s\S]*setLookupUser\(null\)[\s\S]*setUserOptions\(\[\]\)[\s\S]*setUserSearch\(event\.target\.value\)/);
  assert.match(component, /lookupSequence/);
  assert.match(component, /if \(sequence !== lookupSequence\.current\) return null/);
  assert.match(component, /暂无风险评分用户/);
  assert.match(component, /暂无风险分布数据/);
  assert.match(component, /暂无人工覆盖记录/);
  assert.match(component, /type="number"/);
  assert.match(component, /min=\{0\}/);
  assert.match(component, /max=\{100\}/);
  assert.match(component, /评分历史回放/);
  assert.match(client, /scoreUser\.history/);
});

test("K4 score mappings fail closed on field bounds and severity order", () => {
  assert.match(client, /K4_SCORE_MAPPING_BOUNDS/);
  assert.match(client, /"arbitrage\.repeatMin": \[2, 100\]/);
  assert.match(client, /multiAccount\.mediumScore", "multiAccount\.highScore", "multiAccount\.fraudScore/);
  assert.match(client, /kyc\.reviewScore", "kyc\.pendingScore", "kyc\.rejectedScore", "kyc\.sanctionedScore/);
  assert.match(component, /orderedMappings/);
  assert.match(component, /JSON\.stringify\(sourceModel\.scoreMappings\)/);
  assert.match(errors, /K4_MODEL_MAPPINGS_INVALID/);
});

test("K4 large-scale recompute is observable and manual full-run fails closed above its transaction cap", () => {
  assert.match(client, /recomputePending/);
  assert.match(component, /模型重算队列/);
  assert.match(component, /后台按 200 人分片推进/);
  assert.match(component, /disabled=\{overview\.totalUsers > 1000\}/);
  assert.match(component, /超过 1000 人时请通过发布模型触发后台分片重算/);
  assert.match(component, /ctx\.refreshK4Scoring/);
  assert.match(component, /window\.setTimeout\(poll, 1500\)/);
  assert.match(component, /overview\?\.recomputePending/);
});

test("K4 score color follows the active model's configurable bands", () => {
  assert.match(component, /function scoreColor\(score: number, lowMax: number, highMin: number\)/);
  assert.match(component, /scoreColor\(shown, overview\.model\.bandLowMax, overview\.model\.bandHighMin\)/);
  assert.doesNotMatch(component, /score >= 70[^\n]*score >= 40/);
});

test("K4 withdrawal escalation alerts are durable, A6-permission scoped and human visible", () => {
  assert.match(client, /export async function fetchK4WithdrawalAlerts/);
  assert.match(client, /\/scoring\/withdrawal-alerts/);
  assert.match(client, /export async function markK4WithdrawalAlertRead/);
  assert.match(component, /const canReadWithdrawalAlerts = canOverride \|\| isSuperAdmin/);
  assert.match(component, /risk_k4_user_override \/ 超管/);
  assert.doesNotMatch(component, /RISK_LEAD/);
  assert.match(component, /K4 提现升级告警/);
  assert.match(component, /持久化逐人送达/);
  assert.match(component, /markK4WithdrawalAlertRead/);
});

test("K4 band editor describes the backend's exclusive low boundary", () => {
  assert.match(component, /中风险起始分/);
  assert.match(component, /低风险低于此分数/);
  assert.doesNotMatch(component, /低风险上限/);
  assert.doesNotMatch(component, /低风险分档的最大分数/);
});

test("K4 localizes business errors and participates in the verify gate", () => {
  for (const code of [
    "SCORE_WEIGHTS_MUST_SUM_100",
    "SCORE_SOURCE_INVALID",
    "SCORE_BAND_INVALID",
    "SCORE_ESCALATE_INVALID",
    "SCORE_OVERRIDE_INVALID",
    "SCORE_USER_NOT_FOUND",
    "K4_MODEL_VERSION_CONFLICT",
    "K4_SCORE_VERSION_CONFLICT",
    "K4_MODEL_MAPPINGS_INVALID",
    "K4_MODEL_HISTORY_NOT_FOUND",
    "K4_SCORE_BATCH_TOO_LARGE",
  ]) {
    assert.match(errors, new RegExp(code));
  }
  assert.match(verify, /K4 contract/);
});
