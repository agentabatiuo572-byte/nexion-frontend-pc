import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSlotAttemptStore } from "../lib/admin/pending-mutation-store.ts";

/**
 * E 域 A2 提交稳定命令号契约(2026-08-06 任务 A:28 处 propose 的弹窗态半措施迁 SlotAttemptStore)。
 *
 * 原缺陷:commandKey 在弹窗打开时现铸存组件 useState —— 同弹窗重试稳定,但刷新即丢,重试铸新号。
 * 修法:propose 包装咽喉统一 resolve(槽位=动作名|目标对象),28 处调用点零改动。
 *
 * 静态半钉咽喉表达式级接线(e-view.tsx 是组件,node --test import 不了 —— 咽喉语义由
 * 运行时半用真 store 代码按 E 的槽位/指纹形态复演)。
 */

function stripComments(source) {
  return source
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
}

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// ---------- 静态半:propose 包装咽喉 ----------

test("E 域 propose 咽喉:槽位/指纹表达式级接线,弹窗态现铸不得复活", () => {
  const code = stripComments(read("app/components/domain-views/e-view.tsx"));

  assert.match(code, /from "@\/lib\/admin\/pending-mutation-store"/);
  assert.match(code, /createSlotAttemptStore\(\{ storageKey: "nexion-admin-e-domain-commands-v1" \}\)/);

  // 咽喉本体:槽位=动作|目标,指纹=终值+结构化命令+理由,命令号真经 resolve。
  assert.match(code, /const slot = `\$\{spec\.action\}\|\$\{spec\.obj\}`/);
  assert.match(code, /const fingerprint = JSON\.stringify\(\[spec\.after, spec\.command, spec\.reason\]\)/);
  assert.match(code, /const commandKey = commandAttempts\.resolve\(slot, fingerprint, \(\) => createA2CommandKey\("e-domain-action"\)\)/);
  assert.match(code, /rawPropose\(toast, \{ \.\.\.spec, commandKey \}\)/);
  // 成功 / 确定性失败收敛;A2 结果未知留号待原样重试。
  assert.match(code, /if \(!\(error instanceof A2OutcomeUncertainError\)\)\s*\{?\s*commandAttempts\.forget\(slot\)/);

  // rawPropose 直调恒 2 处:显式携号短路 + 咽喉本体。多一处 = 有提交绕过稳定命令号。
  const direct = code.match(/rawPropose\(toast/g) ?? [];
  assert.equal(direct.length, 2,
    `e-view.tsx 的 rawPropose(toast 应恒为 2 处(短路 + 咽喉),实际 ${direct.length} —— 新增 A2 提交必须走 propose 包装`);

  // 现铸只允许出现在 resolve 的 mint 回调里(1 处);弹窗打开时铸号的旧半措施不得回潮。
  const minted = code.match(/createA2CommandKey\(/g) ?? [];
  assert.equal(minted.length, 1,
    `e-view.tsx 的 createA2CommandKey( 应恒为 1 处(mint 回调),实际 ${minted.length}`);
});

test("McSpec 不再承载 commandKey:弹窗态命令号字段已随半措施删除", () => {
  const code = stripComments(read("app/components/domain-views/e-tabs/types.ts"));
  assert.equal((code.match(/commandKey/g) ?? []).length, 0,
    "McSpec.commandKey 复活意味着有人把命令号写回弹窗组件态 —— 刷新即丢的旧缺陷");
});

test("本契约仍挂在 verify 齿轮上;e-view 仍登记在哨兵 MIGRATED", () => {
  assert.match(read("scripts/verify.mjs"), /tests\/e-pending-store-contract\.test\.mjs/);
  assert.match(read("scripts/pending-idempotency-key-sentinel.mjs"), /"app\/components\/domain-views\/e-view\.tsx",/);
});

// ---------- 运行时半:E 槽位/指纹形态跑真 store ----------

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
    store: createSlotAttemptStore({ storageKey: "nexion-admin-e-domain-commands-v1" }),
    mint: () => `e-test-${++minted}`,
  };
}

const eFingerprint = (after, command, reason) => JSON.stringify([after, command, reason]);

test("A2 结果未知后刷新重开同弹窗同输入:复用同号;成功收敛后同输入换新号", () => {
  const { store, mint } = freshStore();
  const slot = "下架 SKU|SKU-RTX4090";
  const fp = eFingerprint("已移除", { op: "sku-delete", skuId: "SKU-RTX4090" }, "长期缺货清理");

  const first = store.resolve(slot, fp, mint);
  // 刷新 = 新 store 实例,内存清零只剩 sessionStorage。
  const afterReload = createSlotAttemptStore({ storageKey: "nexion-admin-e-domain-commands-v1" });
  assert.equal(afterReload.resolve(slot, fp, mint), first,
    "弹窗态半措施刷新即丢 —— 迁移后必须跨刷新复用同号,这正是本轮修的缺陷");

  afterReload.forget(slot);
  assert.notEqual(store.resolve(slot, fp, mint), first, "成功收敛后同输入是新意图,不得复用已消费的号");
});

test("同动作改参数(指纹变)必换新号;不同目标/不同动作互不撞号", () => {
  const { store, mint } = freshStore();
  const cmd = (value) => ({ op: "param-save", key: "E.device.dailyCap", value });

  const v1 = store.resolve("调整参数|E.device.dailyCap", eFingerprint("120", cmd("120"), "扩容"), mint);
  const v2 = store.resolve("调整参数|E.device.dailyCap", eFingerprint("150", cmd("150"), "扩容"), mint);
  assert.notEqual(v2, v1, "运营改了值:按旧号去重会把新值静默吞掉");

  assert.notEqual(
    store.resolve("下架 SKU|SKU-A", eFingerprint("已移除", { skuId: "SKU-A" }, "同理由"), mint),
    store.resolve("下架 SKU|SKU-B", eFingerprint("已移除", { skuId: "SKU-B" }, "同理由"), mint),
    "目标对象在槽位里,SKU-A 与 SKU-B 绝不共号");
  assert.notEqual(
    store.resolve("暂停数据中心|DC-HCM|", eFingerprint("暂停", { dc: "DC-HCM" }, "机房检修"), mint),
    store.resolve("恢复数据中心|DC-HCM|", eFingerprint("恢复", { dc: "DC-HCM" }, "检修完成"), mint),
    "动作名在槽位里,同目标的两个动作互不顶号");
});
