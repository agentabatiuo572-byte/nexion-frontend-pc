/**
 * D7 法币提现参数契约(规格 FEAT-VND01b)—— node --test 直跑,与实现同一提交挂 GEARS。
 *
 * 行为级(真 import lib/admin/payout-vnd-local.ts 跑校验,非子串):
 *   ① 越界拒(异常1):不落库、不产生历史记录;
 *   ② 倒挂默认拒(异常2):sellRate ≥ buyRate 即拒;forceInverted 才放行且历史带 forced 标;
 *   ③ 费率×下限冲突拒(异常3):校验跑在合成后的 next 上 —— 改 feeMin 或改 minAmount 都拦;
 *   ④ 版本冲突拒(CAS 语义):旧 version 提交必拒;
 *   ⑤ 理由 8-200 兜底;无变化提交拒;
 *   ⑥ 派生不缓存:config 无 buyRate/sellRate 键;公式与 D6 同口径取整到十位;
 *   ⑦ 种子=规格 §③ 默认列(channelEnabled 首发必须 false)。
 *
 * 形态级(剥注释源码,守方案 B 的真/假边界):
 *   ⑧ d7 页面禁 import d-client(假面不碰真接口);
 *   ⑨ d6-fx / d5-params 禁 import payout-vnd-local(假数据不渗入真页面);
 *   ⑩ d7 写路径走 updatePayoutVndConfig + openActionConfirm(不裸写)。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PAYOUT_VND_DEFAULTS,
  PAYOUT_VND_FIELDS,
  PAYOUT_VND_INVERTED_MESSAGE,
  PAYOUT_VND_VERSION_CONFLICT_MESSAGE,
  deriveBuyRate,
  deriveSellRate,
  isInverted,
  loadPayoutVndConfig,
  togglePayoutVndChannel,
  updatePayoutVndConfig,
} from "../lib/admin/payout-vnd-local.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const OPERATOR = "contract-test";
const REASON = "契约测试变更理由满八字";

test("种子=规格默认列;通道首发默认关", async () => {
  const cfg = await loadPayoutVndConfig();
  assert.equal(cfg.baseRateVndPerUsdt, 26_000);
  assert.equal(cfg.buySpreadPct, 1.5);
  assert.equal(cfg.sellSpreadPct, 1.5);
  assert.equal(cfg.quoteTtlMinWithdraw, 10);
  assert.equal(cfg.requoteTolerancePct, 2);
  assert.equal(cfg.feeRatePct, 1.0);
  assert.equal(cfg.feeMinUsd, 1);
  assert.equal(cfg.feeMaxUsd, 25);
  assert.equal(cfg.minAmountUsd, 20);
  assert.equal(cfg.maxAmountUsd, 5_000);
  assert.equal(cfg.channelEnabled, false, "通道总开关首发必须默认关闭(规格 §③)");
  assert.equal(PAYOUT_VND_DEFAULTS.channelEnabled, false);
});

test("派生不缓存:config 无 buyRate/sellRate 键;公式与 D6 同口径取整十位", async () => {
  const cfg = await loadPayoutVndConfig();
  assert.ok(!("buyRate" in cfg) && !("sellRate" in cfg), "派生牌价禁止写回 config(派生不缓存)");
  assert.equal(deriveBuyRate({ baseRateVndPerUsdt: 26_000, buySpreadPct: 1.5 }), 26_390);
  assert.equal(deriveSellRate({ baseRateVndPerUsdt: 26_000, sellSpreadPct: 1.5 }), 25_610);
  assert.ok(!isInverted(cfg), "种子配置不得倒挂");
});

test("合法更新:version+1、历史追加 diff 行", async () => {
  const cfg = await loadPayoutVndConfig();
  const next = await updatePayoutVndConfig({ sellSpreadPct: 2 }, cfg.version, REASON, OPERATOR);
  assert.equal(next.sellSpreadPct, 2);
  assert.equal(next.version, cfg.version + 1);
  assert.equal(next.history.length, cfg.history.length + 1);
  const [entry] = next.history;
  assert.equal(entry.operator, OPERATOR);
  assert.equal(entry.reason, REASON);
  // 历史行带单位,与确认弹窗 diff 同口径(t4 走查发现的口径不一致已修)。
  assert.deepEqual(entry.changes, [{ field: "sellSpreadPct", label: "卖出点差", before: "1.5 %", after: "2 %" }]);
  assert.ok(!entry.forced, "非强制保存不得带 forced 标");
});

test("越界拒:不落库、不产生历史(异常1)", async () => {
  const cfg = await loadPayoutVndConfig();
  await assert.rejects(
    () => updatePayoutVndConfig({ sellSpreadPct: 3.5 }, cfg.version, REASON, OPERATOR),
    /卖出点差超出合法范围/,
  );
  const after = await loadPayoutVndConfig();
  assert.equal(after.version, cfg.version, "越界被拒后 version 不得推进");
  assert.equal(after.history.length, cfg.history.length, "越界被拒后不得产生历史记录");
  assert.equal(after.sellSpreadPct, cfg.sellSpreadPct);
});

test("倒挂默认拒;forceInverted 放行且历史带 forced 标(异常2)", async () => {
  let cfg = await loadPayoutVndConfig();
  // buy=0 + sell=0 → 两个派生价相等(26000 ≥ 26000)= 倒挂临界,默认必须拒。
  await assert.rejects(
    () => updatePayoutVndConfig({ buySpreadPct: 0, sellSpreadPct: 0 }, cfg.version, REASON, OPERATOR),
    new RegExp(PAYOUT_VND_INVERTED_MESSAGE.slice(0, 12)),
  );
  cfg = await loadPayoutVndConfig();
  const forcedNext = await updatePayoutVndConfig(
    { buySpreadPct: 0, sellSpreadPct: 0 },
    cfg.version,
    REASON,
    OPERATOR,
    { forceInverted: true },
  );
  assert.equal(forcedNext.history[0].forced, true, "强制保存历史必须带 forced 标");

  // 🔴 倒挂态下的「止血」动作必须放行(三方审计交叉发现的锁死缺陷,修复钉扎):
  // 已倒挂 ≠ 一切写入冻结——不碰点差的变更(费率收紧、通道启停)照常走,否则
  // 强制保存过一次倒挂后,最该按的应急开关反而被闸锁死。
  let live = forcedNext;
  live = await updatePayoutVndConfig({ feeRatePct: 3 }, live.version, REASON, OPERATOR);
  assert.equal(live.feeRatePct, 3, "倒挂态下费率调整必须放行");
  live = await updatePayoutVndConfig({ channelEnabled: true }, live.version, REASON, OPERATOR);
  assert.equal(live.channelEnabled, true, "倒挂态下通道开启必须放行");
  live = await updatePayoutVndConfig({ channelEnabled: false }, live.version, REASON, OPERATOR);
  assert.equal(live.channelEnabled, false, "倒挂态下通道停用(止血)必须放行");

  // 还原到非倒挂态 + 费率复位,后续用例在干净前提下跑(倒挂态改点差脱离倒挂 = 合法路径)。
  live = await updatePayoutVndConfig(
    { buySpreadPct: 1.5, sellSpreadPct: 1.5, feeRatePct: 1.0 },
    live.version,
    REASON,
    OPERATOR,
  );
  assert.ok(!isInverted(live));
});

test("changes 白名单:baseRate/version/history 越权写被静默过滤(单源保护是显式的)", async () => {
  const cfg = await loadPayoutVndConfig();
  // 只注入不可写键 → 过滤后 diff 为空 → 按「参数值未变化」拒,绝不落库。
  await assert.rejects(
    () => updatePayoutVndConfig({ baseRateVndPerUsdt: 30_000 }, cfg.version, REASON, OPERATOR),
    /参数值未变化/,
  );
  // 混合注入 → 合法键生效、不可写键被丢弃。
  const next = await updatePayoutVndConfig(
    { baseRateVndPerUsdt: 30_000, version: 999, requoteTolerancePct: 3 },
    cfg.version,
    REASON,
    OPERATOR,
  );
  assert.equal(next.baseRateVndPerUsdt, 26_000, "基准价永不被本面写入(单源在 D6)");
  assert.equal(next.version, cfg.version + 1, "version 只能由 CAS 链推进");
  assert.equal(next.requoteTolerancePct, 3);
  const restored = await updatePayoutVndConfig({ requoteTolerancePct: 2 }, next.version, REASON, OPERATOR);
  assert.equal(restored.requoteTolerancePct, 2);
});

test("空串/非数值草稿:报「请输入有效数值」而非越界文案;feeMin>feeMax 拒", async () => {
  const cfg = await loadPayoutVndConfig();
  await assert.rejects(
    () => updatePayoutVndConfig({ sellSpreadPct: Number.NaN }, cfg.version, REASON, OPERATOR),
    /卖出点差请输入有效数值/,
  );
  await assert.rejects(
    () => updatePayoutVndConfig({ feeMinUsd: 20, minAmountUsd: 30, feeMaxUsd: 10 }, cfg.version, REASON, OPERATOR),
    /最低收费不得高于单笔封顶/,
  );
});

test("费率×下限冲突拒:改 feeMin 或改 minAmount 都拦(异常3,校验在合成后 next 上)", async () => {
  const cfg = await loadPayoutVndConfig();
  await assert.rejects(
    () => updatePayoutVndConfig({ feeMinUsd: 25 }, cfg.version, REASON, OPERATOR),
    /最低收费不得大于等于单笔下限/,
  );
  await assert.rejects(
    () => updatePayoutVndConfig({ minAmountUsd: 1 }, cfg.version, REASON, OPERATOR),
    /最低收费不得大于等于单笔下限/,
  );
  // feeMin=0 不误伤(0 收费不可能到手为负),但 minAmount>maxAmount 仍拦。
  await assert.rejects(
    () => updatePayoutVndConfig({ minAmountUsd: 6000 }, cfg.version, REASON, OPERATOR),
    /单笔下限不得高于单笔上限/,
  );
});

test("版本冲突拒(CAS 语义)", async () => {
  const cfg = await loadPayoutVndConfig();
  const bumped = await updatePayoutVndConfig({ feeRatePct: 1.2 }, cfg.version, REASON, OPERATOR);
  await assert.rejects(
    () => updatePayoutVndConfig({ feeRatePct: 1.4 }, cfg.version, REASON, OPERATOR),
    new RegExp(PAYOUT_VND_VERSION_CONFLICT_MESSAGE.slice(0, 8)),
  );
  const latest = await loadPayoutVndConfig();
  assert.equal(latest.version, bumped.version, "旧 version 提交不得推进状态");
  assert.equal(latest.feeRatePct, 1.2);
});

test("理由兜底 + 无变化提交拒", async () => {
  const cfg = await loadPayoutVndConfig();
  await assert.rejects(
    () => updatePayoutVndConfig({ feeRatePct: 2 }, cfg.version, "太短", OPERATOR),
    /8-200 字/,
  );
  await assert.rejects(
    () => updatePayoutVndConfig({ feeRatePct: cfg.feeRatePct }, cfg.version, REASON, OPERATOR),
    /参数值未变化/,
  );
});

test("通道启停走独立锚 togglePayoutVndChannel + 同一 CAS 历史链", async () => {
  const cfg = await loadPayoutVndConfig();
  const on = await togglePayoutVndChannel(true, cfg.version, REASON, OPERATOR);
  assert.equal(on.channelEnabled, true);
  assert.deepEqual(on.history[0].changes, [{ field: "channelEnabled", label: "法币提现通道", before: "关闭", after: "开启" }]);
  const off = await togglePayoutVndChannel(false, on.version, REASON, OPERATOR);
  assert.equal(off.channelEnabled, false);
});

test("字段骨架单源:9 个数值字段全在 PAYOUT_VND_FIELDS(页面渲染与校验同一张表)", () => {
  assert.deepEqual(
    Object.keys(PAYOUT_VND_FIELDS).sort(),
    [
      "buySpreadPct",
      "feeMaxUsd",
      "feeMinUsd",
      "feeRatePct",
      "maxAmountUsd",
      "minAmountUsd",
      "quoteTtlMinWithdraw",
      "requoteTolerancePct",
      "sellSpreadPct",
    ],
  );
});

// ── 形态级:方案 B 真/假边界(剥注释后断言)──

const D7_VIEW = "app/components/domain-views/d-tabs/d7-payout-vnd.tsx";
const D7_LOCAL = "lib/admin/payout-vnd-local.ts";

test("D7 页面禁 import 真后端 d-client;写路径走确认弹窗 + 本地层", () => {
  const src = strip(read(D7_VIEW));
  // 正则含相对路径变体(../d-client 等),不只钉 @/ 别名精确串。
  assert.ok(!/from\s+["'][^"']*d-client["']/.test(src), "D7 是方案 B 假数据面,禁碰真后端 d-client");
  assert.ok(!/\bfetch\s*\(/.test(src), "D7 禁发任何网络请求(假数据层内闭环)");
  assert.ok(src.includes("updatePayoutVndConfig("), "D7 写路径必须走本地假数据层");
  assert.ok(src.includes("togglePayoutVndChannel("), "通道启停必须走独立锚(OPS-D-17)");
  assert.ok(src.includes("openActionConfirm("), "D7 写动作必须走操作确认弹窗(确认+理由+审计)");
  assert.ok(src.includes("openConfirm("), "倒挂强制保存必须有二次确认弹窗(规格 §⑥)");
  assert.ok(src.includes("isSuper") && src.includes("超级管理员"), "通道启停与倒挂强制必须收超管门(规格异常5/⑥)");
  assert.ok(src.includes('auditSink: "local-history"'), "D7 弹窗必须声明本地审计口径,禁 A2 假承诺");
});

test("假数据层本体零网络、零真后端引用(边界在定义侧也焊死)", () => {
  const src = strip(read(D7_LOCAL));
  assert.ok(!/\bfetch\s*\(/.test(src), "假数据层禁发网络请求");
  assert.ok(!/from\s+["'][^"']*d-client["']/.test(src), "假数据层禁引用真后端 client");
});

test("真页面 d1–d6 全部禁 import 假数据层(假值不渗入任何真后端页面)", () => {
  for (const rel of [
    "app/components/domain-views/d-tabs/d1-recon.tsx",
    "app/components/domain-views/d-tabs/d2-withdrawals.tsx",
    "app/components/domain-views/d-tabs/d3-treasury.tsx",
    "app/components/domain-views/d-tabs/d4-ledger.tsx",
    "app/components/domain-views/d-tabs/d5-params.tsx",
    "app/components/domain-views/d-tabs/d6-fx.tsx",
  ]) {
    const src = strip(read(rel));
    assert.ok(!src.includes("payout-vnd-local"), `${rel} 不得引用 D7 假数据层`);
  }
});

// ── 浏览器分支(localStorage 持久层):window stub + import query 分身,
//    钉住跨标签页 CAS / 脏持久数据 / persist 失败三类此前零覆盖的缺陷。──

function storageStub() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}
const STORAGE_KEY = "nexion-admin-payout-vnd-v1";

test("浏览器分支:跨实例(跨标签页)CAS 真拦——旧 version 提交被拒,先写方的改动与历史保留", async () => {
  const stub = storageStub();
  globalThis.window = { localStorage: stub };
  try {
    // 两个模块分身 = 两个标签页,各自模块内存,共享同一 localStorage。
    const tabA = await import("../lib/admin/payout-vnd-local.ts?tab=a");
    const tabB = await import("../lib/admin/payout-vnd-local.ts?tab=b");
    const a0 = await tabA.loadPayoutVndConfig();
    const b0 = await tabB.loadPayoutVndConfig();
    assert.equal(a0.version, b0.version, "两个标签页从同一持久层起步");
    const a1 = await tabA.updatePayoutVndConfig({ feeRatePct: 2 }, a0.version, REASON, "tab-a");
    await assert.rejects(
      () => tabB.updatePayoutVndConfig({ quoteTtlMinWithdraw: 30 }, b0.version, REASON, "tab-b"),
      new RegExp(PAYOUT_VND_VERSION_CONFLICT_MESSAGE.slice(0, 8)),
      "B 标签页用旧 version 提交必须被拒(不许静默抹掉 A 的改动)",
    );
    const b1 = await tabB.loadPayoutVndConfig();
    assert.equal(b1.feeRatePct, 2, "B 重新加载能看到 A 的写入");
    assert.equal(b1.version, a1.version);
    assert.equal(b1.history.length, a1.history.length, "A 的审计历史不许丢");
  } finally {
    delete globalThis.window;
  }
});

test("浏览器分支:脏持久数据——history 坏行过滤不炸;数值越界整体回种子", async () => {
  const stub = storageStub();
  globalThis.window = { localStorage: stub };
  try {
    const mod = await import("../lib/admin/payout-vnd-local.ts?dirty=1");
    // ① 合法配置 + 坏 history 行(null / {} / createdAt 非串):滤掉坏行,保留好行,不白屏。
    const goodEntry = { id: "h1", createdAt: "2026-08-06T00:00:00.000Z", operator: "op", reason: "八字以上的合法理由", changes: [{ field: "feeRatePct", label: "提现费率", before: "1 %", after: "2 %" }] };
    stub.setItem(STORAGE_KEY, JSON.stringify({ ...PAYOUT_VND_DEFAULTS, version: 7, history: [null, {}, { id: "x", createdAt: 1234, operator: "op", reason: "r", changes: "not-an-array" }, goodEntry] }));
    const cfg = await mod.loadPayoutVndConfig();
    assert.equal(cfg.version, 7, "配置层合法时不得整体回种子");
    assert.deepEqual(cfg.history, [goodEntry], "坏 history 行必须被过滤,好行保留");
    // ② 数值被篡改越界(sellSpreadPct=99):整体判脏回种子。
    stub.setItem(STORAGE_KEY, JSON.stringify({ ...PAYOUT_VND_DEFAULTS, sellSpreadPct: 99, version: 9, history: [] }));
    const reset = await mod.loadPayoutVndConfig();
    assert.equal(reset.sellSpreadPct, PAYOUT_VND_DEFAULTS.sellSpreadPct, "越界持久值必须回种子");
    assert.equal(reset.version, 1);
  } finally {
    delete globalThis.window;
  }
});

test("浏览器分支:persist 写失败 → 运营可读中文失败态,原值不变、禁假成功", async () => {
  const stub = storageStub();
  globalThis.window = { localStorage: stub };
  try {
    const mod = await import("../lib/admin/payout-vnd-local.ts?quota=1");
    const cfg = await mod.loadPayoutVndConfig();
    stub.setItem = () => { throw new Error("Failed to execute 'setItem' on 'Storage': quota exceeded"); };
    await assert.rejects(
      () => mod.updatePayoutVndConfig({ feeRatePct: 2 }, cfg.version, REASON, OPERATOR),
      /保存失败:本地存储不可用/,
      "persist 失败必须报中文失败态,不透浏览器原生英文",
    );
    stub.setItem = (k, v) => { stub._map.set(k, String(v)); };
    const after = await mod.loadPayoutVndConfig();
    assert.equal(after.feeRatePct, cfg.feeRatePct, "失败后原值必须保留");
    assert.equal(after.version, cfg.version, "失败后 version 不得推进");
  } finally {
    delete globalThis.window;
  }
});
