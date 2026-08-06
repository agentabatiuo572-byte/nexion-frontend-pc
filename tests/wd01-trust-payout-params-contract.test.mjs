// FEAT-WD01 提现信任通道 · D5 新增参数契约
// 守两件事:① 两个新参数在 D5 可配且值域/方向判定正确;② 服务端未下发时向后兼容不打挂整页。
// 红测方式见每条断言注释——去掉被断言的实现,对应 test 必须 FAIL。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const client = read("lib/admin/d-client.ts");
const page = read("app/components/domain-views/d-tabs/d5-params.tsx");

test("WD01 两个新参数进入 D5 类型与可写变更集", () => {
  // 红测:从 D5Params 删掉任一字段 → FAIL
  assert.match(client, /smallAmountThresholdUsd: number/);
  assert.match(client, /payoutSlaHours: number/);
  // 红测:从 D5OwnedChanges 删掉 → FAIL(参数将变成只读,运营改不了)
  assert.match(client, /D5OwnedChanges[\s\S]{0,320}smallAmountThresholdUsd/);
  assert.match(client, /D5OwnedChanges[\s\S]{0,320}payoutSlaHours/);
});

test("WD01 服务端未下发时按默认兜底,不把整页打挂", () => {
  // 前端可能先于后端部署。若改成必填解析,旧后端响应会抛 D5_RESPONSE_INVALID 导致整页不可用。
  // 红测:把 `=== undefined ? 默认` 改成直接 d5Number(...) → FAIL
  assert.match(client, /raw\.smallAmountThresholdUsd === undefined[\s\S]{0,120}D5_DEFAULT_SMALL_AMOUNT_THRESHOLD/);
  assert.match(client, /raw\.payoutSlaHours === undefined[\s\S]{0,120}D5_DEFAULT_PAYOUT_SLA_HOURS/);
  assert.match(client, /D5_DEFAULT_SMALL_AMOUNT_THRESHOLD = 50/);
  assert.match(client, /D5_DEFAULT_PAYOUT_SLA_HOURS = 24/);
});

test("WD01 值域校验对服务端值与兜底值一视同仁", () => {
  // 红测:删掉 business-range 里的两条 → FAIL(越界值会被当合法值渲染)
  assert.match(client, /result\.smallAmountThresholdUsd < 0 \|\| result\.smallAmountThresholdUsd > D5_SMALL_AMOUNT_THRESHOLD_MAX/);
  assert.match(client, /result\.payoutSlaHours < D5_PAYOUT_SLA_HOURS_MIN \|\| result\.payoutSlaHours > D5_PAYOUT_SLA_HOURS_MAX/);
  assert.match(client, /D5_SMALL_AMOUNT_THRESHOLD_MAX = 500/);
  assert.match(client, /D5_PAYOUT_SLA_HOURS_MIN = 1/);
  assert.match(client, /D5_PAYOUT_SLA_HOURS_MAX = 168/);
});

test("WD01 放大方向判定:小额线调大放大、到账时效调小放大", () => {
  // 方向判错 → 放大流出的改动会绕过 B1 覆盖率红线与超管确认,是资金安全面。
  // 红测:把 smallAmt > params. 改成 < → FAIL
  assert.match(page, /submit\("小额免审线",[\s\S]{0,120}smallAmt > params\.smallAmountThresholdUsd/);
  // 到账时效调「小」= 钱更快出去 = 放大,与其它参数方向相反,最易写反
  assert.match(page, /submit\("到账时效",[\s\S]{0,120}slaHours < params\.payoutSlaHours/);
});

test("WD01 两个新参数在页面可见且带值域说明", () => {
  assert.match(page, /小额免审线/);
  assert.match(page, /到账时效/);
  // 运营必须看得到「风控仍生效」,否则会误以为小额完全不过风控。
  // (「两道闸全集」的更强断言在 WD01-T1fix,本条只守「风控仍裁决」这半句存在)
  assert.match(page, /风控闸[^。]{0,40}照常裁决/);
  // 表单校验存在(越界不可提交)
  assert.match(page, /const smallAmtValid = /);
  assert.match(page, /const slaValid = /);
});

// ── T2 参数改名:「提现冷却」→「到账审查窗口」 ──
// 守两面:① 运营真渲染面无旧名残留 ② 字段键未被一起改掉(改键会破坏后端契约与既有审计)
test("WD01-T2 运营渲染面不得残留「提现冷却」旧名", () => {
  // 只扫运营真看到的面(app/ + lib/)。docs/audit/ 是历史审计证据,按不变量禁止追溯改写,故豁免。
  const surfaces = [
    "app/components/domain-views/d-tabs/d5-params.tsx",
    "app/components/domain-views/h-tabs/h1-phase.tsx",
  ];
  for (const file of surfaces) {
    const text = read(file);
    // 红测:把任一处改回「提现冷却」→ FAIL
    // 三种注释都剥(JSX / 块 / 行),少剥一种就留假绿口子 —— 同 T1fix 那条的教训。
    const rendered = text
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(!/提现冷却/.test(rendered),
      `${file} 仍含旧名「提现冷却」(注释已剥离后仍命中)`);
    assert.match(text, /到账审查窗口/);
  }
});

test("WD01-T2 字段键 cooldownDays 未被改名(后端契约面)", () => {
  // 红测:把 withdrawCooldownDays / cooldownDays 改成新键 → FAIL
  assert.match(read("app/components/domain-views/h-tabs/h1-phase.tsx"), /"withdrawCooldownDays"/);
  assert.match(client, /cooldownDays: d5Integer\(raw\.cooldownDays/);
});

// ── T1 验收补修:两处必修项(独立验收员 2026-07-31 判 FAIL 后加) ──
// 教训:后台页面描述有**两个渲染源** —— registry summary(渲染在页顶)与页内卡片标题。
// 本轮只改了后者,导致同屏「四组 vs 六组」自相矛盾。哨兵焊死两源必须同步。
test("WD01-T1fix 页面描述两个渲染源同步(registry summary ↔ 页内卡片)", () => {
  const registry = read("lib/admin/registry/d.ts");
  // 红测:把 registry 改回「四组」而页内保持「六组」→ FAIL
  assert.match(registry, /D5 统一管理六组非 Phase 参数/);
  assert.match(page, /D5 自有六组参数/);
  // 两个新参数必须在 registry 描述里出现,否则页顶描述会漏掉运营能改的东西
  assert.match(registry, /小额免审线/);
  assert.match(registry, /到账时效/);
  // registry 里的旧名也要一起改掉(T2 改名的第三个渲染源)
  assert.ok(!/冷却时间|提现冷却/.test(registry), "registry summary 仍含旧名「冷却」口径");
});

test("WD01-T1fix 小额免审线必须披露「两道闸」全集,不能只说一道", () => {
  // 运营把线调到 500 时,同时关掉的是「首提人工初审」+「新绑地址 24h 延迟(防盗号)」两道。
  // 只披露一道 = 运营在不知情的情况下关掉了防盗号闸。注释里写不算,必须是渲染文案。
  // 剥注释,只留真渲染的串。三种都要剥,少剥一种就有假绿口子:
  //   {/* … */} JSX 注释 · /* … */ 块注释 · // … 行注释
  // (复验实测:早先只剥 /* */,把披露挪进 // 行注释时 9/9 假绿 —— 判据失效=空集全过)
  const rendered = page
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  // 红测:把「新绑地址 24 小时延迟」从渲染文案删掉 → FAIL
  assert.match(rendered, /新绑地址 24 小时延迟/);
  assert.match(rendered, /首次提现人工初审/);
  assert.match(rendered, /其余风控闸/);
});

// ── 审计后补:堵住三个被红测证实的假绿口子 ────────────────────
// 原断言只验「判据这行存在」,不验「判据被按钮消费」——审计实测:
//   · 删掉按钮 disabled 里的 !smallAmtValid / !slaValid(越界值可提交)→ 9/9 全绿
//   · 「小额免审线」写成 { payoutSlaHours: smallAmt }(改 A 存 B)→ 9/9 全绿
//   · 删掉 input 的 min / max 属性 → 9/9 全绿
// ⚠️ 这里仍是源码层断言(admin-ops 无法在 node 里直接 import Next 的 TS 模块做行为测试),
//    属代理判据;真正的行为门是 normalizeD5Params 已导出,待有测试运行时后改成行为测试。

test("WD01 值域判据必须被提交按钮真正消费(不是写了不用)", () => {
  // 红测:删掉 disabled 里的 !smallAmtValid → FAIL
  assert.match(page, /disabled=\{[^}]*!smallAmtValid/);
  assert.match(page, /disabled=\{[^}]*!slaValid/);
});

test("WD01 标签与写入字段必须配对(防「改 A 存 B」)", () => {
  // 红测:把 submit("小额免审线", { smallAmountThresholdUsd: … }) 的键换成别的 → FAIL
  assert.match(page, /submit\("小额免审线",\s*\{\s*smallAmountThresholdUsd:/);
  assert.match(page, /submit\("到账时效",\s*\{\s*payoutSlaHours:/);
});

test("WD01 输入框保留 min/max(前端第一道值域门)", () => {
  // 小额线下限是字面 0(没有 MIN 常量,0 = 关闭快车道,是有意的语义)
  assert.match(page, /aria-label="小额免审线目标值"[\s\S]{0,120}min="0"[\s\S]{0,60}max=\{D5_SMALL_AMOUNT_THRESHOLD_MAX\}/);
  assert.match(page, /aria-label="到账时效目标值"[\s\S]{0,120}min=\{D5_PAYOUT_SLA_HOURS_MIN\}[\s\S]{0,60}max=\{D5_PAYOUT_SLA_HOURS_MAX\}/);
});

test("WD01 向后兼容兜底必须同时认 null(后端下发 null 会冻结整页参数)", () => {
  // 红测:去掉 `|| raw.X === null` → FAIL。审计实证:后端返 null 时整页六个参数全部冻结。
  assert.match(client, /raw\.smallAmountThresholdUsd === undefined \|\| raw\.smallAmountThresholdUsd === null/);
  assert.match(client, /raw\.payoutSlaHours === undefined \|\| raw\.payoutSlaHours === null/);
});
