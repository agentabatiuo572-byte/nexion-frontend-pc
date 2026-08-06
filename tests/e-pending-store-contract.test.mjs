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

  // 咽喉本体:槽位=动作 op|目标,指纹=终值+去易变项的命令+目标锁,命令号真经 resolve。
  // 指纹必须覆盖整个提案信封:before/after/command/type/amplifies 全在 body 里,漏一项就会
  // 「指纹相同而 body 变了」→ 后端 payload-bound 幂等回 409,且因非全新尝试不弃号 = 24h 死锁。
  // before 尤其关键:它是变更前快照,刷新页面重开弹窗时会随最新数据变化。
  assert.match(code, /const fingerprint = JSON\.stringify\(\[\s*spec\.before, spec\.after, spec\.command, spec\.type, !!spec\.amplifies,\s*spec\.target \?\? spec\.targets \?\? null,\s*\]\)/);
  // 绕法防御:e-view 已 import a2-client,再顺手 import 提案创建函数直调,上面所有计数断言仍全绿。
  assert.doesNotMatch(code, /createA2OperationProposal/,
    "e-view 不得直调 A2 提案创建函数 —— 那是绕开咽喉的第二条入口,所有计数断言都看不见");
  assert.match(code, /const commandKey = commandAttempts\.resolve\(slot, fingerprint, \(\) => \{/);
  assert.match(code, /mintedFresh = true;/);
  assert.match(code, /rawPropose\(toast, \{ \.\.\.spec, commandKey \}\)/);
  // 成功路径必须清槽:不清则同一意图的下一次真实提交会复用已被后端消费的号,被静默去重。
  assert.match(code, /const result = await rawPropose\(toast, \{ \.\.\.spec, commandKey \}\);\s*commandAttempts\.forget\(slot\);/);
  // 槽位不得用展示文案(常内嵌输入值,如「上架节奏 · 延迟 1 个月 · Gen3」)。
  assert.match(code, /const slot = `\$\{spec\.command\.op\}\|\$\{spec\.obj\}`/);
  assert.doesNotMatch(code, /const slot = `\$\{spec\.action\}/,
    "槽位用 spec.action(运营展示串,含输入值)会让改回原值时复用旧槽里可能已消费的号");
  // 指纹取 command 全量:它就是发给后端的 payload,两者必须逐字一致。剔一边不剔另一边 = 同号异载荷
  // → 后端 payload-bound 幂等回 409「内容已变化」,重试被硬拒。
  // 易变字段(媒体预签名 URL,每次拉目录都续签)在 command 构造源头就剔了,两侧天然对称。
  const registry = stripComments(read("lib/admin/high-ops-registry.ts"));
  assert.match(registry, /imagePreviewUrl: _imagePreviewUrl,/,
    "预签名 URL 必须在 canonicalE1SkuParams 源头剔除 —— 只剔指纹不剔 body 会制造 409");
  assert.doesNotMatch(code, /stableCommand\(/,
    "不得回到「只给指纹剔、body 照送」的不对称写法");
  // 绕法防御:再声明一个 usePropose() 就能整条绕开咽喉,而 rawPropose 计数断言看不见。
  assert.equal((code.match(/usePropose\(\)/g) ?? []).length, 1,
    "e-view 的 usePropose() 应恒为 1 处 —— 第二个提案 hook 实例就是第二条绕过咽喉的入口");
  // 指纹不得含 reason:理由是审计元数据,进指纹会让「结果未知后补理由再点」换新号 → 双提案双退款。
  assert.doesNotMatch(code, /JSON\.stringify\(\[spec\.after[^\]]*spec\.reason/,
    "reason 进指纹 = 改一下理由就铸新号,同一笔退款进两次审批队列");
  // 鸭型判据(不用裸 instanceof:打包边界下失真方向恰好是「该保号却弃号」);
  // 且只有全新尝试才在确定性失败时弃号。
  assert.match(code, /if \(mintedFresh && !isA2OutcomeUncertainError\(error\)\)\s*\{?\s*commandAttempts\.forget\(slot\)/);
  assert.doesNotMatch(code, /instanceof A2OutcomeUncertainError/,
    "裸 instanceof 在打包边界下会失真,仓内已有 isA2OutcomeUncertainError 鸭型判据");

  // rawPropose 直调恒 1 处(咽喉本体)。多一处 = 有提交绕过稳定命令号。
  const direct = code.match(/rawPropose\(toast/g) ?? [];
  assert.equal(direct.length, 1,
    `e-view.tsx 的 rawPropose(toast 应恒为 1 处(仅咽喉),实际 ${direct.length} —— 新增 A2 提交必须走 propose 包装`);
  // 绕法 B 防御:换掉 rawPropose 的来源(usePropose → 任意每次现铸的 hook)源文本一字不改也能全绿。
  assert.match(code, /const rawPropose = usePropose\(\);/,
    "rawPropose 必须来自 usePropose —— 换个来源就能让上面所有断言变成摆设");
  // 绕法 A 防御:块作用域内重新声明同名 const 遮蔽 resolve 的结果,所有正则照样匹配。
  assert.equal((code.match(/const commandKey =/g) ?? []).length, 1,
    "e-view.tsx 的 const commandKey 应恒为 1 处 —— 多一处意味着 resolve 的结果被块级遮蔽掉了");

  // 咽喉无旁路:调用点携号短路会让那条路径退回「谁传谁负责」,又是刷新即丢的老形态。
  assert.doesNotMatch(code, /if \(spec\.commandKey\)/,
    "咽喉不得有 spec.commandKey 短路旁路 —— E 域每次提交的命令号都必须由咽喉派");

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

const eFingerprint = (after, command, target = null) => JSON.stringify([after, command, target]);

test("A2 结果未知后刷新重开同弹窗同输入:复用同号;成功收敛后同输入换新号", () => {
  const { store, mint } = freshStore();
  const slot = "下架 SKU|SKU-RTX4090";
  const fp = eFingerprint("已移除", { op: "sku-delete", skuId: "SKU-RTX4090" });

  const first = store.resolve(slot, fp, mint);
  // 刷新 = 新 store 实例,内存清零只剩 sessionStorage。
  const afterReload = createSlotAttemptStore({ storageKey: "nexion-admin-e-domain-commands-v1" });
  assert.equal(afterReload.resolve(slot, fp, mint), first,
    "弹窗态半措施刷新即丢 —— 迁移后必须跨刷新复用同号,这正是本轮修的缺陷");

  afterReload.forget(slot);
  // merge 2026-08-06:幂等包内存镜像后双实例是运行时不存在的场景,断言回归单实例语义(同 h8)。
  assert.notEqual(afterReload.resolve(slot, fp, mint), first, "成功收敛后同输入是新意图,不得复用已消费的号");
});

test("同动作改参数(指纹变)必换新号;不同目标/不同动作互不撞号", () => {
  const { store, mint } = freshStore();
  const cmd = (value) => ({ op: "param-save", key: "E.device.dailyCap", value });

  const v1 = store.resolve("调整参数|E.device.dailyCap", eFingerprint("120", cmd("120")), mint);
  const v2 = store.resolve("调整参数|E.device.dailyCap", eFingerprint("150", cmd("150")), mint);
  assert.notEqual(v2, v1, "运营改了值:按旧号去重会把新值静默吞掉");

  assert.notEqual(
    store.resolve("下架 SKU|SKU-A", eFingerprint("已移除", { skuId: "SKU-A" }), mint),
    store.resolve("下架 SKU|SKU-B", eFingerprint("已移除", { skuId: "SKU-B" }), mint),
    "目标对象在槽位里,SKU-A 与 SKU-B 绝不共号");
  assert.notEqual(
    store.resolve("暂停数据中心|DC-HCM", eFingerprint("暂停", { dc: "DC-HCM" }), mint),
    store.resolve("恢复数据中心|DC-HCM", eFingerprint("恢复", { dc: "DC-HCM" }), mint),
    "动作名在槽位里,同目标的两个动作互不顶号");
});

test("改理由不换号:结果未知后补一句理由再提交,仍是同一次意图", () => {
  const { store, mint } = freshStore();
  const slot = "订单退款|ORD-77";
  // 指纹只取 [after, command, target] —— 理由不在其中,所以改理由 resolve 出的是同一个号。
  const fp = eFingerprint("已退款", { op: "order-refund", orderId: "ORD-77", channel: "bank" });
  const first = store.resolve(slot, fp, mint);
  assert.equal(store.resolve(slot, fp, mint), first,
    "运营在「结果未知」后把理由补成「…(第二次重试)」再点 —— 换号会让同一笔退款进两次审批队列");
});
