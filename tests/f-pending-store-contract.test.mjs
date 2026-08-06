import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSlotAttemptStore } from "../lib/admin/pending-mutation-store.ts";

/**
 * F 域 A2 提交稳定命令号契约(restore-mid-tiers 审计「F 域 propose 无稳定命令号」记档项落地)。
 *
 * 两半合一才算「运行时证明对」:
 *   静态半 —— 钉 f-view 咽喉的**表达式级接线**(不是裸字面量:只钉字面量时,把真调用改走别的槽、
 *   原字面量挪进注释,门照样绿 —— 对抗审计 probe 实测过的假绿路径);
 *   运行时半 —— 用真 store 代码跑 F 的槽位/指纹形态,钉复用/换号/清槽语义。
 * 本文件只读本仓,任何机器真跑(与 f-domain-contract 的 FE-BE 缺仓用例刻意分家,好挂 verify 齿轮)。
 */

const VIEW_PATH = new URL("../app/components/domain-views/f-view.tsx", import.meta.url);

// ---------- 静态半:咽喉表达式接线 ----------

test("F-view 四个 A2 提交口全部经稳定命令号咽喉,接线钉到表达式级", () => {
  const view = readFileSync(VIEW_PATH, "utf8");
  // 结构判定一律在剥注释文本(行注释 + 块注释)上做,防字面量藏进注释骗过 / 污染判定。
  // 先归一 CRLF:JS 正则的 `.` 不匹配 \r,行尾 \r 会挡住 `//.*$`,让行注释剥除静默失效
  // (红测 PA2/PF 探针实测抓到的死剥除器)。
  const code = view
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");

  assert.match(code, /from "@\/lib\/admin\/pending-mutation-store"/);
  assert.match(code, /createSlotAttemptStore\(\{\s*storageKey: "nexion-admin-f-commands-v1"/);

  // 唯一 propose 直调点在咽喉内 —— 多一处 = 有提交绕过幂等复用
  const directCalls = code.match(/await propose\(/g) ?? [];
  assert.equal(directCalls.length, 1,
    `f-view.tsx 的 await propose( 直调应恒为 1 处(仅咽喉内),实际 ${directCalls.length} 处 —— 新增 A2 提交必须走 proposeStable`);

  // 命令号必须真经 resolve 接线(只查字面量会放过「现铸不复用」的整体回退)
  assert.match(code, /const commandKey = commandAttempts\.resolve\(slot, inputFingerprint,/);
  assert.match(code, /\{ \.\.\.spec, commandKey \}/);
  // 成功 / 确定性失败收敛 forget;结果未知保留待同号重试(鸭型守卫;容花括号 / 换行排版)
  assert.match(code, /if \(!isA2OutcomeUncertainError\(error\)\)\s*\{?\s*commandAttempts\.forget\(slot\)/);

  // 四族调用点钉「完整表达式 = 槽位 + 指纹构成」(对齐 B5 现行标准 pending-mutation-migration-contract)
  assert.match(code, /proposeStable\(`f-config:\$\{key\}`, JSON\.stringify\(\[value, reason\]\)/);
  assert.match(code, /proposeStable\(`f-vrank-override:\$\{userId\}`, JSON\.stringify\(\[targetV, direction, reason\]\)/);
  assert.match(code, /proposeStable\(`f-payout-action:\$\{payoutId\}`, JSON\.stringify\(\[action, reason\]\)/);
  // f4 结算指纹必须带日键:周期性意图,防上一周期已决议票被 24h 幂等回放吞掉新周期结算
  assert.match(code, /proposeStable\("f4-settle:current-week", JSON\.stringify\(\[reason, new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\]\)/);
});

// ---------- 运行时半:真 store 语义(F 槽位 / 指纹形态) ----------

/** 极简 sessionStorage 替身(与 pending-mutation-store-contract 同款)。 */
function freshStore() {
  const cells = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => (cells.has(key) ? cells.get(key) : null),
      setItem: (key, value) => { cells.set(key, String(value)); },
      removeItem: (key) => { cells.delete(key); },
    },
  };
  let minted = 0;
  return {
    store: createSlotAttemptStore({ storageKey: "nexion-admin-f-commands-v1" }),
    mint: () => `f-test-${++minted}`,
  };
}

test("outcome-uncertain 原样重试复用同一命令号;成功收敛清槽后同输入 = 新意图新号", () => {
  const { store, mint } = freshStore();
  const slot = "f-config:F.pool.ratio";
  const fp = JSON.stringify(["0.35", "例行调参"]);
  const first = store.resolve(slot, fp, mint);
  assert.equal(store.resolve(slot, fp, mint), first, "uncertain 后原样重试必须复用同号,否则后端无法去重");
  store.forget(slot);
  assert.notEqual(store.resolve(slot, fp, mint), first, "成功收敛后再提同输入是新意图,复用已消费的号会被后端幂等吞掉");
});

test("同一佣金事件先冻结后解冻 = 换输入换号并弃旧号(朴素按槽复用会把解冻吞成冻结的重复提交)", () => {
  const { store, mint } = freshStore();
  const slot = "f-config:F.commission.evt-1001.status";
  const freeze = store.resolve(slot, JSON.stringify(["frozen", "疑似刷单,先按住"]), mint);
  const unfreeze = store.resolve(slot, JSON.stringify(["unlocked", "复核为正常交易"]), mint);
  assert.notEqual(unfreeze, freeze);
  // 弃旧号:哪怕改回原输入,也不得复用可能已被后端消费的旧号
  assert.notEqual(store.resolve(slot, JSON.stringify(["frozen", "疑似刷单,先按住"]), mint), freeze);
});

test("不同佣金事件 / 不同派发单同值同理由互不撞号;f4 指纹日键让周期意图自动换号", () => {
  const { store, mint } = freshStore();
  assert.notEqual(
    store.resolve("f-config:F.commission.evt-A.status", JSON.stringify(["frozen", "同理由"]), mint),
    store.resolve("f-config:F.commission.evt-B.status", JSON.stringify(["frozen", "同理由"]), mint),
    "事件号在槽位里,跨流水绝不共号 —— 共号会把别人的操作误判成重复提交吞掉");
  assert.notEqual(
    store.resolve("f-payout-action:P-1", JSON.stringify(["reissue", "同理由"]), mint),
    store.resolve("f-payout-action:P-2", JSON.stringify(["reissue", "同理由"]), mint));
  const day1 = store.resolve("f4-settle:current-week", JSON.stringify(["周例行结算", "2026-08-02"]), mint);
  assert.equal(store.resolve("f4-settle:current-week", JSON.stringify(["周例行结算", "2026-08-02"]), mint), day1,
    "同日同理由 = 对在途结算的重试,必须同号");
  assert.notEqual(store.resolve("f4-settle:current-week", JSON.stringify(["周例行结算", "2026-08-09"]), mint), day1,
    "换日 = 新周期意图,复用旧号会让新结算被幂等回放吞掉");
});
