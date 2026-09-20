import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("app/components/domain-views/a-tabs/a4-events.tsx");

/**
 * zentao #202:扩展工单列表出现「完全重复记录且无去重」。
 *
 * 事实核查:这些**不是**重复工单 —— 后端每条动态批次都有唯一 id(`manual-<recordId>`)。
 * 是**展示**让它们无法区分:动态批次的标题是常量「登记扩展工单」,列头写「新增 domain / 事件」
 * 却只渲染 domain,于是同一 domain 下登记多个事件时,多行在屏幕上逐字相同。
 * 事件名是唯一区分字段,必须出现在行上;工单号要能追溯回后端记录。
 *
 * 本用例钉住这两点,防止「看起来重复」再次把运营引向错误的去重判断。
 */

test("A4 扩展批次行渲染事件名,不再让同 domain 的多行看起来完全相同", () => {
  // 行内必须出现明细项(事件名)。后端 dynamicBatch 把事件名放在 details[0].item。
  assert.match(page, /b\.details\[0\]\.item/, "行内必须渲染首个明细项(事件名)");
  // 列头承诺的是「新增 domain / 事件」,所以事件必须真的渲染出来。
  assert.match(page, /新增 domain \/ 事件/);
  // 动态批次的标题是常量,单靠它无法区分行 —— 必须有标题以外的区分字段。
  assert.doesNotMatch(page, /b\.title[\s\S]{0,80}\{[^}]*b\.id[^}]*\}[\s\S]{0,40}newDomains/, "不得只靠常量标题 + domain 区分");
});

test("A4 行上给出工单号,可追溯到后端记录", () => {
  assert.match(page, /工单 \{b\.id\}/, "必须显示工单号");
});

test("A4 操作按钮的可访问名同时包含 domain 与事件名", () => {
  // batchActionTarget 的签名必须接受 details,并把事件名并进标签。
  assert.match(page, /details\?:\s*Array<\{\s*item\?:\s*string\s*\}>/, "batchActionTarget 必须接收 details");
  assert.match(page, /const event = \(batch\.details \?\? \[\]\)[\s\S]{0,120}find\(Boolean\)/,
    "必须从 details 里取事件名");
  assert.match(page, /\[title, first, event\]\.filter\(Boolean\)\.join\(" \/ "\)/,
    "可访问名必须拼上事件名");
});

test("A4 仍保证不产出空可访问名", () => {
  // 缺陷 100 的原判据不能因为加字段而失效。
  assert.match(page, /return label \|\| `第 \$\{\(index \?\? 0\) \+ 1\} 行`;/, "空标签必须回退到行序号");
});
