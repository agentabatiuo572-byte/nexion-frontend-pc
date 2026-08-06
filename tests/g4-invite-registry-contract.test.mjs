/**
 * G4 创世邀请码码表契约(规格 FEAT-GEN11)—— node --test 直跑,载真 client 跑真代码。
 *
 * 🔴 守的不变量(编号对应红测文档 docs/changes/2026-08-04-invite-registry-redtest.md):
 *   ① 批量发码互不重复、不与存量撞码,状态与发放人/时刻逐条留痕。
 *   ② 码值只能系统生成 —— 对外没有任何接受手输码值的入口。
 *   ③ 作废必填 8-200 字理由,越界拒绝且不写盘。
 *   ⑤ 🔴 已核销的码**没有作废路径**:client 拒绝 used→void,UI **不渲染**作废入口
 *      (不是渲染后禁用 —— 禁用态仍暗示「某些条件下可作废」)。
 *   ⑦ 接线门:创世域 G4 真的挂了这个区,理由上限真的透传到了确认弹窗
 *      (判定对不对 / 有没有被接上是两道门)。
 *   ⑧ 运营面禁裸枚举值:状态显示「未使用 / 已使用 / 已作废」。
 *
 * 结构断言一律跑在**剥注释后**的正主源码上(注释里出现判定式文本不得哄绿)。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  G4_INVITE_MAX_BATCH,
  G4_INVITE_NOTE_MAX,
  G4_INVITE_REASON_MAX,
  G4_INVITE_REASON_MIN,
  G4_INVITE_STATUS_LABEL,
  fetchG4InviteCodes,
  issueG4InviteCodes,
  voidG4InviteCode,
} from "../lib/admin/g4-invite-client.ts";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
/** 行首 // 与块注释一起剥 —— 只剥「整行就是注释」的,不碰 url 里的 //。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/**
 * 取两个稳定锚点之间的原文。任一锚点消失 = 实现被改名/删除,直接炸(不许静默放行)。
 * 不用花括号配对:这些函数的**返回类型里就有对象字面量**(`Promise<{ … }>`),
 * 配对会停在类型上,抠出来的只有签名 —— 判据于是永远扫的是空字符串(假绿)。
 */
function grabBetween(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `源码里找不到 \`${from}\`(实现被改名或删除?)`);
  const b = to === null ? src.length : src.indexOf(to, a + from.length);
  assert.ok(b > a, `源码里找不到 \`${from}\` 之后的 \`${to}\``);
  const body = src.slice(a, b);
  assert.ok(body.length > from.length + 100, `\`${from}\` 抠出来的实现只有 ${body.length} 字符,判据会空转`);
  return body;
}

const CODES_VIEW = "app/components/domain-views/g-tabs/g4-invite-codes.tsx";
const G4_VIEW = "app/components/domain-views/g-tabs/g4-genesis.tsx";
const G_VIEW = "app/components/domain-views/g-view.tsx";
const CLIENT = "lib/admin/g4-invite-client.ts";

const STORAGE_KEY = "nexion-admin-g4-invite-codes-v1";

/** 极简 localStorage 替身:与浏览器同语义(存的是字符串,读回要 JSON.parse)。 */
function installStorage() {
  const cells = new Map();
  const localStorage = {
    getItem: (key) => (cells.has(key) ? cells.get(key) : null),
    setItem: (key, value) => { cells.set(key, String(value)); },
    removeItem: (key) => { cells.delete(key); },
  };
  globalThis.window = { localStorage };
  return {
    raw: () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"),
    seed: (rows) => localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)),
    wrote: () => cells.has(STORAGE_KEY),
  };
}

const seedRow = (over) => ({
  code: "NEXGRID-OG-SEED", status: "unused", issuedBy: "ops-a", issuedAt: 1_754_000_000_000,
  note: "", redeemedBy: null, redeemedAt: null, voidedBy: null, voidedAt: null, voidReason: null,
  ...over,
});

// ------------------------------------------------------------------ ① 批量发码

test("① 批量发码:数量对、互不重复、状态未使用、发放人与时刻逐条留痕", async () => {
  const env = installStorage();
  const { issued, registry } = await issueG4InviteCodes(12, " 越南渠道首批 ", "ops-alice");

  assert.equal(issued.length, 12);
  assert.equal(new Set(issued.map((row) => row.code)).size, 12, "同一批里不许撞码");
  assert.ok(issued.every((row) => /^NEXGRID-OG-[A-HJ-NP-Z2-9]{4}$/.test(row.code)), "码形与前端校验同形,且不含形近字符 I/O/0/1");
  assert.ok(issued.every((row) => row.status === "unused" && row.issuedBy === "ops-alice" && row.issuedAt > 0));
  assert.ok(issued.every((row) => row.note === "越南渠道首批"), "备注去掉首尾空白后逐条随码留存");
  assert.ok(issued.every((row) => row.redeemedBy === null && row.voidedBy === null));
  assert.equal(registry.counts.all, 12);
  assert.equal(registry.counts.unused, 12);
  assert.equal(env.raw().length, 12, "必须真落盘,不是只改了内存");
});

test("① 二次发码不与存量撞码,计数按状态分别累计", async () => {
  const env = installStorage();
  env.seed([seedRow(), seedRow({ code: "NEXGRID-OG-USED", status: "used", redeemedBy: "u@x.io", redeemedAt: 1 }),
    seedRow({ code: "NEXGRID-OG-DEAD", status: "void", voidedBy: "ops-a", voidedAt: 2, voidReason: "渠道对接人变更收回" })]);
  const { registry } = await issueG4InviteCodes(40, "", "ops-bob");
  const all = registry.codes.map((row) => row.code);
  assert.equal(new Set(all).size, all.length, "新码不得与存量撞码");
  assert.deepEqual(registry.counts, { all: 43, unused: 41, used: 1, void: 1 });
});

test("① 数量必须是 1-100 的整数,越界一律拒绝且不写盘", async () => {
  const env = installStorage();
  for (const bad of [0, -1, 1.5, Number.NaN, G4_INVITE_MAX_BATCH + 1]) {
    await assert.rejects(() => issueG4InviteCodes(bad, "", "ops-a"), /1-100/, `count=${bad} 应被拒`);
  }
  assert.equal(env.wrote(), false, "被拒的发码一次都不许落盘");
  await assert.doesNotReject(() => issueG4InviteCodes(G4_INVITE_MAX_BATCH, "", "ops-a"), "上界本身合法");
});

test("① 备注超长拒绝(边界值本身合法)", async () => {
  installStorage();
  await assert.rejects(() => issueG4InviteCodes(1, "备".repeat(G4_INVITE_NOTE_MAX + 1), "ops-a"), /备注/);
  await assert.doesNotReject(() => issueG4InviteCodes(1, "备".repeat(G4_INVITE_NOTE_MAX), "ops-a"));
});

// ------------------------------------------------------------------ ② 只许系统出码

test("② 🔴 对外没有任何接受手输码值的入口(码只能系统生成)", () => {
  const client = strip(read(CLIENT));
  const exported = [...client.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(exported.sort(), ["fetchG4InviteCodes", "issueG4InviteCodes", "voidG4InviteCode"],
    "新增导出必须同步这条台账 —— 多一个写入口就多一条绕过系统出码的路");
  // issue 的入参只有 数量 / 备注 / 操作人,没有码值。
  assert.match(client, /export async function issueG4InviteCodes\(\s*count: number,\s*note: string,\s*operator: string,\s*\)/);
  const view = strip(read(CODES_VIEW));
  assert.ok(!/placeholder="[^"]*NEXGRID/i.test(view) && !/setIssueCode\b/.test(view),
    "发码区不得出现手输码值的输入框");
});

// ------------------------------------------------------------------ ③ 作废理由 8-200

test("③ 作废理由必须 8-200 字,越界拒绝且不改状态", async () => {
  const env = installStorage();
  env.seed([seedRow()]);
  for (const bad of ["", "太短", "七个字都不够啊", " ".repeat(20)]) {
    await assert.rejects(() => voidG4InviteCode("NEXGRID-OG-SEED", bad, "ops-a"), /8-200/);
  }
  await assert.rejects(() => voidG4InviteCode("NEXGRID-OG-SEED", "长".repeat(G4_INVITE_REASON_MAX + 1), "ops-a"), /8-200/);
  assert.equal(env.raw()[0].status, "unused", "被拒的作废不许改状态");

  const min = "长".repeat(G4_INVITE_REASON_MIN);
  const { code } = await voidG4InviteCode("NEXGRID-OG-SEED", min, "ops-a");
  assert.equal(code.status, "void");
  assert.equal(code.voidReason, min, "理由随码留痕(审计)");
  assert.equal(code.voidedBy, "ops-a");
  assert.ok(code.voidedAt > 0);
  assert.equal(env.raw()[0].status, "void", "真落盘");
});

test("③ 作废不存在的码报错,不凭空造行", async () => {
  const env = installStorage();
  env.seed([seedRow()]);
  await assert.rejects(() => voidG4InviteCode("NEXGRID-OG-NONE", "渠道对接人变更收回", "ops-a"), /不存在/);
  assert.equal(env.raw().length, 1);
});

// ------------------------------------------------------------------ ⑤ 已核销码无作废路径

test("⑤ 🔴 已核销的码不可作废(used 是终态)", async () => {
  const env = installStorage();
  const used = seedRow({ code: "NEXGRID-OG-USED", status: "used", redeemedBy: "holder@x.io", redeemedAt: 1_754_000_000_001 });
  env.seed([used]);
  await assert.rejects(
    () => voidG4InviteCode("NEXGRID-OG-USED", "发错人了需要收回额度", "ops-a"),
    /已核销的邀请码不可作废/,
  );
  assert.deepEqual(env.raw()[0], used, "被拒之后那一行逐字节没变");
});

test("⑤ 已作废的码再作废也拒(void 是终态,不可复用)", async () => {
  const env = installStorage();
  const dead = seedRow({ code: "NEXGRID-OG-DEAD", status: "void", voidedBy: "ops-a", voidedAt: 9, voidReason: "渠道对接人变更收回" });
  env.seed([dead]);
  await assert.rejects(() => voidG4InviteCode("NEXGRID-OG-DEAD", "重复提交一次作废", "ops-b"), /已是已作废状态/);
  assert.deepEqual(env.raw()[0], dead);
});

test("⑤ 🔴 已核销 / 已作废的行**不渲染**作废入口(不是渲染后禁用)", () => {
  const view = strip(read(CODES_VIEW));
  assert.match(view, /row\.status === "unused"\s*\?\s*<button[\s\S]*?>作废<\/button>/,
    "作废按钮必须挂在 status === \"unused\" 的条件渲染上");
  assert.equal((view.match(/>作废</g) ?? []).length, 1, "作废入口只许有一处渲染点");
  // 禁用态是「渲染了但点不动」——它仍然告诉运营「某些条件下这个码可以作废」,规格 ⑤ 明令不许。
  assert.ok(!/disabled=\{[^}]*status[^}]*\}/.test(view),
    "不许出现「按状态禁用作废按钮」的写法(该不渲染的就别渲染)");
});

test("⑤ 客户端没有任何把 used/void 改回 unused 的路径", () => {
  const client = strip(read(CLIENT));
  const voidBody = grabBetween(client, "export async function voidG4InviteCode", null);
  assert.equal((voidBody.match(/status:\s*"void"/g) ?? []).length, 1, "作废里只有一处状态跃迁");
  assert.ok(!/status:\s*"(unused|used)"/.test(voidBody), "作废不许把状态写成 unused/used");
  const issueBody = grabBetween(client, "export async function issueG4InviteCodes", "export async function voidG4InviteCode");
  assert.ok(!/status:\s*"(used|void)"/.test(issueBody), "发码只产出 unused");
  assert.ok(!/status:\s*"used"/.test(client), "核销是用户侧动作,运营控制台不许写 used");
});

// ------------------------------------------------------------------ ⑦ 接线门

test("⑦ 接线:创世域 G4 真的挂了邀请码区", () => {
  const g4 = strip(read(G4_VIEW));
  assert.match(g4, /import G4InviteCodes from "\.\/g4-invite-codes"/);
  assert.match(g4, /<G4InviteCodes ctx=\{ctx\} \/>/);
});

test("⑦ 接线:作废走操作确认弹窗(理由 + 影响确认 + 审计),理由上限真的透传到弹窗", () => {
  const view = strip(read(CODES_VIEW));
  assert.match(view, /openActionConfirm\(\{[\s\S]*?reasonMax: G4_INVITE_REASON_MAX/, "作废弹窗必须声明理由上限");
  assert.match(view, /kind: "destructive-reason"/, "作废是破坏性动作,走既有 destructive-reason 业务表单");
  const gview = strip(read(G_VIEW));
  assert.match(gview, /reasonMax=\{mc\.reasonMax\}/, "G 域弹窗必须把 reasonMax 透传下去,否则上限声明了等于没声明");
});

test("⑦ 接线:发码与作废都从确认弹窗的 run 里发起(没有绕过确认的旁路)", () => {
  const view = strip(read(CODES_VIEW));
  for (const [fn, label] of [["issueG4InviteCodes", "发码"], ["voidG4InviteCode", "作废"]]) {
    const calls = (view.match(new RegExp(`${fn}\\(`, "g")) ?? []).length;
    assert.equal(calls, 1, `${label}只许有一个调用点(在 openActionConfirm 的 run 里)`);
    assert.match(view, new RegExp(`run: async \\(reason\\) => \\{[\\s\\S]*?${fn}\\(`), `${label}必须在确认弹窗的 run 内执行`);
  }
});

// ------------------------------------------------------------------ ⑧ 运营面可读中文

test("⑧ 状态显示运营可读中文,页面不出现裸枚举值", () => {
  assert.deepEqual(G4_INVITE_STATUS_LABEL, { unused: "未使用", used: "已使用", void: "已作废" });
  const view = strip(read(CODES_VIEW));
  assert.ok(!/>\s*(unused|used|void)\s*</.test(view), "表格里不许直接渲染枚举值");
  assert.match(view, /G4_INVITE_STATUS_LABEL\[row\.status\]/, "状态列必须走中文标签映射");
});

test("⑧ 列表默认排序 = 发放时间倒序,计数四档齐全", async () => {
  installStorage();
  await issueG4InviteCodes(2, "第一批", "ops-a");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const { issued } = await issueG4InviteCodes(2, "第二批", "ops-b");
  const registry = await fetchG4InviteCodes();
  assert.equal(registry.codes.length, 4);
  assert.ok(issued.map((row) => row.code).includes(registry.codes[0].code), "最新一批排在最前");
  assert.deepEqual(Object.keys(registry.counts).sort(), ["all", "unused", "used", "void"]);
});
