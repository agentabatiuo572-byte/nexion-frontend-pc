import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("../app/components/domain-views/e-view.tsx", import.meta.url), "utf8");
const e2 = readFileSync(new URL("../app/components/domain-views/e-tabs/e2-tasks.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/e2-client.ts", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../app/api/admin/config/[...path]/route.ts", import.meta.url), "utf8");

test("E2 reads the exact server-canonical task-pricing contract", () => {
  assert.match(client, /\/api\/admin\/config\/\$\{path\}/);
  assert.match(client, /fetchE2TaskPricing/);
  assert.match(proxy, /\/api\/admin\/config\/\$\{path\[0\]\}/);
  assert.match(view, /fetchE2TaskPricing\(\)/);
});

test("E2 renders all canonical task classes including Speech", () => {
  for (const taskClass of ["IG", "VG", "LL", "FT", "EM", "SP"]) {
    assert.match(e2, new RegExp(`${taskClass}:`));
  }
  assert.match(e2, /6 类 AI 任务定价/);
  assert.match(e2, /minReward/);
  assert.match(e2, /maxReward/);
  assert.match(e2, /minVRAM/);
});

test("E2 exposes saturation, five-tier teaser and kill or recovery", () => {
  assert.match(e2, /QUEUE_SATURATION/);
  assert.match(e2, /Locked teaser 预览/);
  assert.match(client, /cloud-share/);
  assert.match(e2, /daily potential/);
  assert.match(e2, /row\.enabled \? "Kill" : "恢复"/);
});

test("E2 hides all mutation entry points without write authority", () => {
  assert.match(view, /authorities\.includes\("device_e2_write"\)/);
  assert.match(view, /const canMutateE2 = canWriteE2 && !e2Loading && !e2Error && !!e2Pricing/);
  assert.match(view, /tab === "E2" \? \(canMutateE2 \?/);
  assert.match(e2, /ctx\.canWriteE2 &&/);
});

test("E2 confirmation enforces the PRD reason length", () => {
  assert.match(e2, /reasonMin=\{8\}/);
  assert.match(e2, /reasonMax=\{200\}/);
  assert.match(client, /updateE2TaskPricing/);
});

test("E2 scalar adjustments reject no-op submissions before creating approval noise", () => {
  assert.match(e2, /field: "minReward"[\s\S]*disallowCurrent: true/);
  assert.match(e2, /phoneField: "dailyUsdt"[\s\S]*disallowCurrent: true/);
  assert.match(e2, /phoneField: "dailyNex"[\s\S]*disallowCurrent: true/);
});

test("E2 scalar controls reject invalid negative values before submission", () => {
  assert.match(e2, /pricingAction\.field === "enabled"[\s\S]*kind: "number"[\s\S]*min: 0/);
  assert.match(e2, /phoneField: "dailyUsdt"[\s\S]*kind: "number"[\s\S]*min: 0\.00001/);
  assert.match(e2, /phoneField: "dailyNex"[\s\S]*kind: "number"[\s\S]*min: 0\.00001/);
});

test("E2 exposes read failures and a real retry action instead of showing false zeroes", () => {
  assert.match(e2, /ctx\.e2Error[\s\S]*E2 数据读取失败/);
  assert.match(e2, /onClick=\{\(\) => void ctx\.refreshE2\(\)\}[\s\S]*重试/);
});

test("E2 rejects malformed successful envelopes and closes every write entrance", () => {
  assert.match(client, /E2_TASK_PRICING_PROTOCOL_INVALID/);
  assert.match(client, /taskPricing protocol requires a data object/);
  assert.match(client, /queueSaturation must be between 0 and 1/);
  assert.match(client, /taskClasses row minReward and maxReward must be non-negative and ordered/);
  assert.match(client, /taskClasses row requires non-negative minVRAM, activeAssignments, avgSec, and dailyPotential/);
  assert.match(e2, /const canMutate = ctx\.canWriteE2 && !ctx\.e2Loading && !ctx\.e2Error && !!ctx\.e2Pricing/);
  assert.match(view, /const canMutateE2 = canWriteE2 && !e2Loading && !e2Error && !!e2Pricing/);
  assert.match(e2, /\{canMutate && <Btn variant="primary"/);
  assert.match(e2, /\{canMutate && <div className="row"/);
  assert.match(e2, /\{canMutate && <div className="acts"/);
  assert.match(e2, /useEffect\(\(\) => \{\s*if \(!canMutate\) setPricingAction\(null\);/);
  assert.match(e2, /if \(!canMutate\) \{\s*ctx\.toast\("E2 权威快照不可用，已取消本次配置提交"\);/);
  assert.match(view, /const rejectE2Mutation = \(\) => \{\s*setToast\("E2 权威快照不可用，已取消本次配置提交"\);/);
  assert.match(view, /disabled=\{!canMutateE2 \|\| !taskForm\.n\.trim\(\) \|\| !Number\(taskForm\.price\)\}/);
  assert.match(view, /if \(isE2Mutation\(mc\.op\) && !canMutateE2\) \{\s*setToast\("E2 权威快照不可用，已取消本次配置提交"\);[\s\S]*setActionConfirm\(null\);/);
  assert.match(view, /setActionConfirm\(\(current\) => current && isE2Mutation\(current\.op\) \? null : current\)/);
});

test("E2 preserves five-decimal micro-reward precision", () => {
  assert.match(e2, /toFixed\(5\)/);
});

test("E2 loads every server page instead of silently truncating the task catalog", () => {
  assert.match(client, /while \(records\.length < total\)/);
  assert.match(client, /pageNum=\$\{pageNum\}&pageSize=\$\{pageSize\}/);
  assert.doesNotMatch(client, /const page = await e2Request<PageResult<BackendTask>>\("\/tasks\?pageNum=1&pageSize=100"\)/);
});

test("E2 distinguishes six task classes from the number of catalog tasks", () => {
  assert.match(e2, /\$\{tasks\.length\} 个任务均价/);
  assert.doesNotMatch(e2, /\$\{tasks\.length\} 类任务均价/);
});

test("E2 shows the unknown-class filter only for real unknown backend data", () => {
  assert.match(e2, /KIND_ORDER\.filter\(\(k\) => k !== "unknown" \|\| kindCount\(k\) > 0\)/);
});

test("E2 operator copy explains task load in business language without API or field names", () => {
  assert.match(e2, /当前饱和度由任务运行情况汇总/);
  assert.doesNotMatch(e2, /\/api\/admin\/devices\/tasks/);
  assert.doesNotMatch(e2, /sat 字段/);
  assert.doesNotMatch(e2, /Server Canonical/);
});
