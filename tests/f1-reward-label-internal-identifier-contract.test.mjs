import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("app/components/domain-views/f-tabs/f1-vrank.tsx");

/**
 * zentao #30:权威等级奖励配置把后台测试标识与 `custom` 文案暴露到用户面前
 * (V1 显示「F1ENGINE custom reward」)。
 *
 * `nx_v_rank_reward_rule.custom_label` 是运营手填自由文本,没有发布审核,所以会存进
 * 测试工具名 —— PC 验收脚本写 `F-A1REVERIFY-<ts>-custom-reward`,F1 引擎自检写
 * `F1ENGINE …`。App 侧早有一道闸(src/lib/rank-entitlement-label.ts),但 PC 的 F1 阶梯
 * 是**另一条上屏路径**,此前没有闸,于是内部标识符照样上了等级奖励 chip。
 *
 * 本用例钉住 PC 侧也必须有同一判据,且两处上屏点(阶梯 chip 与派发台账)都过闸。
 */

test("F1 阶梯奖励 chip 过滤内部测试标识符", () => {
  assert.match(page, /const INTERNAL_LABEL_PATTERN = \/f1engine\|reverify\/i;/,
    "必须定义与 App 同判据的内部标识符模式");
  assert.match(page, /function safeCustomLabel\(/, "必须有归一函数");
  assert.match(page, /case "custom": return safeCustomLabel\(it\.custom\);/,
    "custom 类型奖励必须过闸");
  // 直接渲染原始 custom 字段 = 缺陷本体。
  assert.doesNotMatch(page, /case "custom": return it\.custom \?\?/, "不得直接渲染原始 custom 文案");
});

test("F1 派发台账同样过滤内部标识符", () => {
  assert.match(page, /safeCustomLabel\(record\.customLabel, record\.rewardType \|\| "—"\)/,
    "派发台账的 custom 文案也必须过闸");
  assert.doesNotMatch(page, /return record\.voucherId \|\| record\.skuId \|\| record\.customLabel \|\|/,
    "不得直接渲染台账原始 custom 文案");
});

test("归一函数对内部标识符与空值都退回占位,不产出空串", () => {
  const body = page.match(/function safeCustomLabel\([\s\S]*?\n\}/)?.[0];
  assert.ok(body, "必须能取到归一函数体");
  const constant = page.match(/const INTERNAL_LABEL_PATTERN = [^;]+;/)?.[0];
  assert.ok(constant, "必须能取到判据常量");
  // 用仓库既有的 TS 转译器剥注解,而不是手写正则 —— 源码是 CRLF,注解形态也会微调。
  const js = ts.transpileModule(`${constant}\n${body}\nexport { safeCustomLabel };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "require", js)(module.exports, () => { throw new Error("no imports expected"); });
  const fn = module.exports.safeCustomLabel;
  const pattern = /f1engine|reverify/i;
  // 判据与实现一致:内部标识符一律不上屏。
  for (const internal of ["F1ENGINE custom reward", "F1ENGINE V2 custom", "F-A1REVERIFY-20260721132132-custom-reward"]) {
    assert.equal(pattern.test(internal), true, `判据必须命中 ${internal}`);
    assert.equal(fn(internal), "自定义", `内部标识符必须被拦下: ${internal}`);
  }
  // 真实运营文案照常展示。
  assert.equal(fn("Priority support"), "Priority support");
  // 空值退回占位,绝不产出空标签。
  assert.equal(fn(""), "自定义");
  assert.equal(fn(undefined), "自定义");
  assert.equal(fn("   "), "自定义");
});
