import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("../app/components/domain-views/e-view.tsx", import.meta.url), "utf8");
const tab = readFileSync(new URL("../app/components/domain-views/e-tabs/e6-compute-config.tsx", import.meta.url), "utf8");
const types = readFileSync(new URL("../app/components/domain-views/e-tabs/types.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/e6-client.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../lib/admin/high-ops-registry.ts", import.meta.url), "utf8");
const moduleRegistry = readFileSync(new URL("../lib/admin/registry/e.ts", import.meta.url), "utf8");
const errorMessages = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");
const deviceProxy = readFileSync(new URL("../app/api/admin/devices/[...path]/route.ts", import.meta.url), "utf8");

test("E6 uses an exact frontend key registry and one atomic A2 batch command", () => {
  assert.match(client, /E6_EXACT_PARAM_KEYS/);
  assert.match(client, /E6_GPU_TIER_IDS/);
  assert.match(client, /E6_EXACT_PARAM_KEYS\.has\(key\)/);
  assert.match(registry, /op: "e6_compute_config_batch"/);
  assert.match(registry, /params: \{ values: ctx\.values \}/);
  assert.match(shell, /findHighOp\([^\n]*"e6_compute_config_batch"/);
  assert.match(deviceProxy, /isComputeConfigParamsBatch/);
  assert.match(deviceProxy, /parts\[1\] === "params" && parts\.length === 2/);
  assert.doesNotMatch(shell, /mc\.op === "param-multi"[\s\S]{0,200}findHighOp\("e3_config_batch"\)!/);
  assert.doesNotMatch(client, /for \(const \[paramKey, value\][\s\S]{0,160}await updateE6Param/);
});

test("E6 permissions expose only the actions authorized for the current operator", () => {
  assert.match(shell, /canWriteE6[\s\S]{0,160}device_e6_write/);
  assert.match(shell, /hasToggleE6[\s\S]{0,160}device_e6_flag_toggle/);
  assert.match(shell, /canToggleE6\s*=\s*canWriteE6\s*\|\|\s*hasToggleE6/);
  assert.match(types, /canWriteE6: boolean/);
  assert.match(types, /canToggleE6: boolean/);
  assert.match(tab, /canToggleE6[\s\S]{0,600}e6-flag-toggle/);
  assert.match(tab, /canWriteE6[\s\S]{0,1800}编辑档位/);
});

test("E6 fails visibly, preserves keyword slots, and never invents yield values", () => {
  assert.match(tab, /e6Error/);
  assert.match(tab, /refreshE6/);
  assert.match(tab, /重新加载/);
  assert.match(client, /keywords: E6KeywordView\[\]/);
  assert.match(client, /slot: string/);
  assert.match(tab, /kw\.slot/);
  assert.match(tab, /firstFreeKeywordSlot/);
  assert.doesNotMatch(tab, /yieldValue\([^)]*fallback/);
  assert.doesNotMatch(tab, /166\.67|0\.06|topsBaseline", 28/);
});

test("E6 copy distinguishes saved server config from future carrier UI work", () => {
  assert.match(tab, /后续 SPEC/);
  assert.match(tab, /当前不会出现新入口/);
  assert.doesNotMatch(tab, /确认后客户端会按新状态显示或隐藏对应入口/);
  assert.doesNotMatch(tab, /客户端读取服务端配置后生效/);
  assert.doesNotMatch(moduleRegistry, /版本、强制升级开关/);
  assert.match(moduleRegistry, /下载地址与中英文标题、引导文案/);
  assert.match(errorMessages, /H5 基础托管系数须 >0 且 ≤1/);
});

test("E6 exposes version rollback, phase boundary, structural and B1 failure contracts", () => {
  assert.match(tab, /data-proof="e6-version-rollback"/);
  assert.match(tab, /A2 操作单 \+ A4 事件构成不可变版本链/);
  assert.match(tab, /回滚本身会生成新版本/);
  assert.match(tab, /\/platform\/audit\?domain=E&object=E\.compute/);
  assert.match(tab, /data-proof="e6-effective-boundary"/);
  assert.match(tab, /不等待 H1 的阶段\/月度切换/);
  assert.match(tab, /App\/H5 最迟在下一次 60 秒配置刷新后读取新值/);
  assert.match(tab, /B1 覆盖率低于红线时服务端失败关闭/);
  assert.match(errorMessages, /COMPUTE_GPU_TOPS_ORDER_INVALID/);
  assert.match(errorMessages, /COMPUTE_GPU_KEYWORD_DUPLICATE/);
  assert.match(errorMessages, /COVERAGE_BELOW_REDLINE/);
});
