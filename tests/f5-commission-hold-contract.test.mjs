/**
 * F5 单笔佣金冻结/提前解锁/解冻 · 专属契约门(合并底账 ADMIN-MERGE-BASELINE-20260804 §二#4 恢复)。
 *
 * 为什么必须单独一道门:这组动作曾被静默削减成"只剩不可逆冲正",而动作台账 OPS-F-10 因为锚
 * (f_commission_status)在注册表里仍存在,一直显示 built——台账绿、页面上按钮却没了,属于
 * "锚在、入口无"的虚标形态,现有 ops-actions 门天然测不出。这道门直接钉行内按钮与 dispose
 * 管线的接线,再被削减时 verify 红。
 * 跨仓断言(后端 f_commission_status replay 分支)不在本文件,理由同 GEN10b parity 拆分。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const component = strip(read("../app/components/domain-views/f-tabs/f5-audit.tsx"));
const shell = strip(read("../app/components/domain-views/f-view.tsx"));
const registry = strip(read("../lib/admin/high-ops-registry.ts"));
const f1Client = strip(read("../lib/admin/f1-client.ts"));
const manifest = read("../docs/ops-actions.manifest.json");

function grabBetween(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `源码里找不到 \`${from}\`(实现被改名或删除?)`);
  const b = to === null ? src.length : src.indexOf(to, a + from.length);
  assert.ok(b > a, `源码里找不到 \`${from}\` 之后的 \`${to}\``);
  const body = src.slice(a, b);
  assert.ok(body.length > from.length + 40, `抠出的实现只有 ${body.length} 字符,判据会空转`);
  return body;
}

test("① 行内按钮按状态机渲染:cooling → 冻结+提前解锁,frozen → 解冻,全挂处置权限", () => {
  assert.match(component, /\{canDispose && row\.status === "cooling" && <button[^>]+onClick=\{\(\) => dispose\("freeze", row\)\}/, "cooling 行丢了「冻结」入口(底账 §二#4 同型退化)");
  assert.match(component, /\{canDispose && row\.status === "cooling" && <button[^>]+onClick=\{\(\) => dispose\("unlock", row\)\}/, "cooling 行丢了「提前解锁」入口");
  assert.match(component, /\{canDispose && row\.status === "frozen" && <button[^>]+onClick=\{\(\) => dispose\("unfreeze", row\)\}/, "frozen 行丢了「解冻」出口 —— 冻结将变成变相终态");
  // 三个调用点必须恰好收在上述两种状态条件下,不许出现无状态守卫的第四个入口。
  const disposeCalls = component.match(/dispose\("(?:freeze|unlock|unfreeze)", row\)/g) ?? [];
  assert.equal(disposeCalls.length, 3, `dispose 调用点应恰为 3 处(freeze/unlock/unfreeze 各一),实际 ${disposeCalls.length} 处`);
});

test("② dispose 规格:paramKey=auditKey · 目标值固定 · amplify 按资金方向", () => {
  const disposeBody = grabBetween(component, "const dispose = (", "const reverse = (");
  assert.match(disposeBody, /paramKey:\s*row\.auditKey/, "dispose 必须用行上服务端下发的 auditKey,不许前端手拼状态键");
  assert.match(disposeBody, /op:\s*"dispose"/, "必须走 shell 的 dispose 分支(A2 管线),不许改直连");
  const freezeSpec = grabBetween(disposeBody, "freeze: {", "unlock: {");
  assert.match(freezeSpec, /amplify:\s*false/, "冻结是收紧方向,弹窗不该标放大资金流出");
  assert.match(freezeSpec, /fixedVal:\s*"frozen"/, "冻结目标值漂移");
  const unlockSpec = grabBetween(disposeBody, "unlock: {", "unfreeze: {");
  assert.match(unlockSpec, /amplify:\s*true/, "提前解锁放大可提余额,弹窗必须标 amplify 触发 B1 护栏");
  assert.match(unlockSpec, /fixedVal:\s*"unlocked"/, "解锁目标值漂移");
  const unfreezeSpec = grabBetween(disposeBody, "unfreeze: {", "}[kind]");
  assert.match(unfreezeSpec, /amplify:\s*false/, "解冻只恢复冻结前的 cooling,不得误报为放大可提余额");
  assert.match(unfreezeSpec, /fixedVal:\s*"cooling"/, "解冻必须恢复 cooling,不得绕过剩余冷却期");
});

test("③ shell 管线:F5 dispose 路由到 updateF5Config → f_commission_status A2 票", () => {
  const disposeBranch = grabBetween(shell, 'mc.op === "dispose"', "F_CONFIRM_SHAPE_UNKNOWN");
  assert.match(disposeBranch, /tab === "F5"/, "shell dispose 分支丢了 F5 路由");
  assert.match(disposeBranch, /ctx\.updateF5Config\(mc\.paramKey, mc\.fixedVal, reason, mc\.expectedVersion\)/, "F5 dispose 必须携带 expectedVersion 经 updateF5Config(A2 propose),不许静默吞掉");
  // 处置完成提示必须如实:此刻只是入了 A2 待执行队列,冻结这种抢时间的动作被「已生效」
  // 误报会让运营提前撤场(skeptic P2-4)。
  assert.match(disposeBranch, /已提交/, "dispose 完成 toast 必须说「已提交」而非宣称已生效");
  assert.doesNotMatch(disposeBranch, /已生效/, "dispose 分支禁再出现「已生效」话术(propose 后未落库)");
  assert.match(shell, /startsWith\("F\.commission\."\) && key\.endsWith\("\.status"\)/, "resolveFOp 丢了佣金状态键映射,dispose 会落错 op");
  assert.match(registry, /op:\s*"f_commission_status"/, "高敏操作注册表丢了 f_commission_status,A2 票建不出来");
  assert.match(registry, /type:\s*"commission_event"/, "f_commission_status 的对象锁类型漂移");
});

test("④ 数据契约:F5 事件行必须带 auditKey(F.commission.{id}.status)", () => {
  assert.match(f1Client, /auditKey/, "F5CommissionEvent 丢了 auditKey 字段,行内处置无键可用");
  assert.match(f1Client, /F\.commission\./, "auditKey 的键形态漂移(resolveFOp 与 buildTarget 都按 F.commission.*.status 解析)");
});

test("④b D4 下钻必须同时具备真实账本号与 D4 读取权限", () => {
  assert.match(component, /const canReadD4 = ctx\.can\("finance_d4_read"\)/,
    "F5 未按 D4 后端读取权限控制下钻,最小权限运营员会点击后被路由弹回");
  assert.match(component, /canReadD4 && row\.ledgerBizNo/,
    "D4 链接必须同时满足权限与服务端真实 ledgerBizNo");
  assert.match(component, /D4 无权限/,
    "无 D4 权限时必须明确说明,不能保留一个会静默跳回的死链接");
});

test("⑤ 动作台账:OPS-F-10 行内三动作口径落台账,不再虚标", () => {
  const row = grabBetween(manifest, '"id": "OPS-F-10"', '"id": "OPS-G-01"');
  assert.match(row, /单笔冻结\/提前解锁\/解冻/, "OPS-F-10 动作口径没更新,台账仍是旧的模糊三词");
  assert.match(row, /"restAction": "f_commission_status"/, "OPS-F-10 锚漂移");
});
