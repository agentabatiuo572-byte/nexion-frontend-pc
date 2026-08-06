import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSlotAttemptStore } from "../lib/admin/pending-mutation-store.ts";

/**
 * H8 发奖参数/结算稳定命令号契约(2026-08-06 任务 A:editParam 弹窗打开时现铸的半措施迁
 * SlotAttemptStore;「执行真实结算」同病同修;h-client 补 H8 提交的「结果未知」分类)。
 *
 * H8 有 expectedVersion CAS:指纹必须织入 version —— 基于旧快照的同值重提是新意图,不是重试。
 */

function stripComments(source) {
  return source
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
}

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// ---------- 静态半:组件接线 ----------

test("H8 调参与结算的命令号都在 run 回调内经 resolve,弹窗打开时现铸不得回潮", () => {
  const code = stripComments(read("app/components/domain-views/h-tabs/h8-referral-rewards.tsx"));

  assert.match(code, /from "@\/lib\/admin\/pending-mutation-store"/);
  assert.match(code, /createSlotAttemptStore\(\{ storageKey: "nexion-admin-h8-commands-v1" \}\)/);

  // 调参:槽位=param|参数键,指纹带 storedValue + expectedVersion + reason(CAS 语义)。
  assert.match(code, /const slot = `param\|\$\{param\.key\}`/);
  assert.match(code, /JSON\.stringify\(\[storedValue, data\.version, reason\]\)/);
  // 结算:指纹带 limit + version + 倍率月 + 快照哈希 + reason —— 任一变即新意图。
  assert.match(code, /JSON\.stringify\(\[limit, data\?\.version, data\?\.rhythmMonth, data\?\.rewardSnapshotHash, reason\]\)/);

  // 现铸只允许出现在 resolve 的 mint 回调里:恒 2 处(调参 + 结算),且都是 `() => createH8CommandKey` 形态。
  const minted = code.match(/createH8CommandKey\(/g) ?? [];
  assert.equal(minted.length, 2, `createH8CommandKey( 应恒为 2 处(两个 mint 回调),实际 ${minted.length}`);
  assert.equal((code.match(/\(\) => createH8CommandKey\(/g) ?? []).length, 2,
    "现铸必须全部包在 resolve 的 mint 回调里 —— 出现裸调用即弹窗态半措施回潮");

  // resolve 必须发生在 run 回调内部(打开弹窗时 resolve 会把「查看」也当成「在途尝试」)。
  assert.match(code, /run: async \(reason, value\) => \{[\s\S]*?commandAttempts\.resolve\(/,
    "resolve 必须在 run(提交时)执行,不得回到 editParam 打开弹窗时");

  // 收敛语义:调参按 H8 分类留号,结算按 A2 分类留号。
  assert.match(code, /if \(!isH8OutcomeUncertainError\(error\)\)\s*\{?\s*commandAttempts\.forget\(slot\)/);
  assert.match(code, /if \(!\(error instanceof A2OutcomeUncertainError\)\)\s*\{?\s*commandAttempts\.forget\(slot\)/);
});

test("h-client:H8 提交「结果未知」分类真接在 update 函数上(网络断/响应不可读留号)", () => {
  const code = stripComments(read("lib/admin/h-client.ts"));
  assert.match(code, /class H8OutcomeUncertainError extends Error/);
  assert.match(code, /error instanceof TypeError \|\| error instanceof SyntaxError/,
    "growthRequest 形态:fetch 网络断抛 TypeError、response.json() 不可读抛 SyntaxError —— 两类都可能已生效");
  assert.match(code, /throw new H8OutcomeUncertainError\(error\.message \|\| "H8_REQUEST_OUTCOME_UNKNOWN", idempotencyKey\)/);
});

test("本契约仍挂在 verify 齿轮上;h8 组件仍登记在哨兵 MIGRATED", () => {
  assert.match(read("scripts/verify.mjs"), /tests\/h8-pending-store-contract\.test\.mjs/);
  assert.match(read("scripts/pending-idempotency-key-sentinel.mjs"), /"app\/components\/domain-views\/h-tabs\/h8-referral-rewards\.tsx",/);
});

// ---------- 运行时半:H8 槽位/指纹形态跑真 store ----------

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
    store: createSlotAttemptStore({ storageKey: "nexion-admin-h8-commands-v1" }),
    mint: () => `h8-test-${++minted}`,
  };
}

test("结果未知后刷新原样重试:同值同 version 同理由复用同号;收敛后同输入换新号", () => {
  const { store, mint } = freshStore();
  const fp = JSON.stringify(["3", 7, "新人礼上调"]);

  const first = store.resolve("param|newcomer.usdt", fp, mint);
  const reloaded = createSlotAttemptStore({ storageKey: "nexion-admin-h8-commands-v1" });
  assert.equal(reloaded.resolve("param|newcomer.usdt", fp, mint), first,
    "命令号必须落 sessionStorage:弹窗打开时现铸存组件态的旧半措施,刷新即丢");

  reloaded.forget("param|newcomer.usdt");
  assert.notEqual(store.resolve("param|newcomer.usdt", fp, mint), first);
});

test("指纹织入 expectedVersion:同值不同 version 是新意图必换号(CAS 不是幂等重试)", () => {
  const { store, mint } = freshStore();
  const v7 = store.resolve("param|inviter.nex", JSON.stringify(["120", 7, "调档"]), mint);
  const v8 = store.resolve("param|inviter.nex", JSON.stringify(["120", 8, "调档"]), mint);
  assert.notEqual(v8, v7,
    "version 变了 = 基于新快照的新提交;复用旧号会被后端当成旧版本的重试去重吞掉");
});

test("不同参数键互不撞号;结算与调参分槽", () => {
  const { store, mint } = freshStore();
  assert.notEqual(
    store.resolve("param|newcomer.usdt", JSON.stringify(["3", 7, "同理由"]), mint),
    store.resolve("param|newcomer.nex", JSON.stringify(["3", 7, "同理由"]), mint));
  assert.notEqual(
    store.resolve("param|newcomer.usdt", JSON.stringify(["3", 7, "x"]), mint),
    store.resolve("settle|batch", JSON.stringify([20, 7, 3, "hash", "x"]), mint));
});
