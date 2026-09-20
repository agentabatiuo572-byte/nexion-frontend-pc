import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const view = read("app/components/domain-views/e-view.tsx");
const ops = read("app/components/domain-views/e-tabs/e5-ops.tsx");
const types = read("app/components/domain-views/e-tabs/types.ts");

/**
 * zentao #44:E5 设备运维页在单面故障时整页失明。
 *
 * e-view 里三个服务面本来就是独立读取(Promise.allSettled),注释也写明「任一面失败只冻结
 * 它自己,不能把另外两面的真实数据一起清空」—— 但它们随后被 join 成**一个** e5Error,而设备表
 * 以那个字段为准。于是「设备概览」或「数据中心」5xx 会把**已经成功读到的设备**整表藏掉:
 * 工单截图正是页脚还写着「当前页命中 4 台 / 筛选后 4 条」,表体却只剩一行「设备库存读取异常」。
 *
 * 本用例钉住:失败态按面分开,设备表只被设备面自己的失败挡住,另外两面的故障单独可见。
 */

test("E5 三个服务面各留各的失败态,不再合并成一个", () => {
  assert.match(types, /e5DeviceError: string \| null;/, "设备面失败态必须独立");
  assert.match(types, /e5OverviewError: string \| null;/, "概览面失败态必须独立");
  assert.match(types, /e5DatacenterError: string \| null;/, "数据中心面失败态必须独立");
  // 合并成单一字段 = 缺陷本体。
  assert.doesNotMatch(types, /e5Error: string \| null;/, "不得再有合并的 e5Error 字段");
  // 只看 E5 的刷新函数:同文件其它域(E2 等)有自己的聚合写法,不在本用例范围。
  const refreshE5 = view.match(/const refreshE5 = useCallback\([\s\S]*?\n  \}, \[/)?.[0];
  assert.ok(refreshE5, "必须能取到 refreshE5 函数体");
  assert.doesNotMatch(refreshE5, /errors\.push\(/, "E5 不得再把三面的错误收进同一个数组");
  assert.doesNotMatch(refreshE5, /errors\.join\("；"\)/, "E5 不得再把三面的错误 join 成一个串");
  assert.match(refreshE5, /setE5DeviceError\(/, "设备面必须写自己的失败态");
  assert.match(refreshE5, /setE5OverviewError\(/, "概览面必须写自己的失败态");
  assert.match(refreshE5, /setE5DatacenterError\(/, "数据中心面必须写自己的失败态");
});

test("设备表只被设备面自己的失败挡住", () => {
  // 表体的三个分支都必须以 e5DeviceError 为准。
  const bodyGates = ops.match(/!ctx\.e5Loading && !?ctx\.e5DeviceError/g) ?? [];
  assert.ok(bodyGates.length >= 3, `表体应以 e5DeviceError 为判据(实际 ${bodyGates.length} 处)`);
  assert.doesNotMatch(ops, /!ctx\.e5Loading && ctx\.e5Error/, "表体不得再被合并失败态挡住");
  assert.doesNotMatch(ops, /!ctx\.e5Loading && !ctx\.e5Error/, "表体不得再被合并失败态挡住");
});

test("另外两面的失败单独可见,不被静默吞掉", () => {
  // 拆开失败态是为了不连坐,但不能让运维以为「都正常」。
  assert.match(ops, /ctx\.e5OverviewError && <span/, "概览面失败必须有可见出口");
  assert.match(ops, /ctx\.e5DatacenterError && <span/, "数据中心面失败必须有可见出口");
  assert.match(ops, /ctx\.e5DatacenterError && \(/, "数据中心分区也必须呈现自己的失败");
});

test("数据中心网格只被数据中心面自己的失败挡住", () => {
  assert.match(ops, /!ctx\.e5Loading && !ctx\.e5DatacenterError && dcRows\.length === 0/,
    "空态判据必须用数据中心面自己的失败态");
});
