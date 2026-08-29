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

  // 调参:槽位=param|参数键,指纹带 storedValue + expectedVersion(CAS 语义),**不含 reason**。
  assert.match(code, /const slot = `param\|\$\{param\.key\}`/);
  assert.match(code, /JSON\.stringify\(\[storedValue, data\.version\]\)/);
  // 结算:指纹带 limit + version + 倍率月 + 快照哈希 —— 任一变即新意图。
  // pending 计数进了提案 body 的 before,刷新后会随新邀请关系变化;漏进指纹 = 同号异载荷 409 死锁。
  assert.match(code, /JSON\.stringify\(\[limit, data\?\.version, data\?\.rhythmMonth, data\?\.rewardSnapshotHash, data\?\.pending\]\)/);
  // reason 不得进指纹:理由是审计元数据,进指纹会让「结果未知后补理由再点」换新号 → 重复发奖。
  assert.doesNotMatch(code, /JSON\.stringify\(\[storedValue[^\]]*reason/);
  assert.doesNotMatch(code, /rewardSnapshotHash, reason\]/);

  // 现铸只允许出现在 resolve 的 mint 回调里:恒 2 处(调参 + 服务端权威结算)。
  const minted = code.match(/createH8CommandKey\(/g) ?? [];
  assert.equal(minted.length, 2, `createH8CommandKey( 应恒为 2 处(两个权威写入 mint 回调),实际 ${minted.length}`);
  assert.equal((code.match(/mintedFresh = true; return createH8CommandKey\(/g) ?? []).length, 2,
    "现铸必须全部包在 resolve 的 mint 回调里 —— 出现裸调用即弹窗态半措施回潮");

  // resolve 出的号必须**原样**交给下游:`commandKey + Date.now()` 这类加工会让后端按另一个号去重,
  // 而只钉 resolve 赋值语句的门看不见(对抗审计实证过的绕法)。
  assert.match(code, /updateH8ReferralRewardParam\(param\.key, storedValue, reason, data\.version, commandKey\)/,
    "调参必须把 resolve 出的 commandKey 原样传给 client,不得拼接加工");
  assert.match(code, /^\s*commandKey,$/m,
    "结算必须把 commandKey 原样放进 propose spec");

  // resolve 必须发生在 run 回调内部(打开弹窗时 resolve 会把「查看」也当成「在途尝试」)。
  // 用 [^]*? 会跨到下一个 run,所以钉调参 run 内部的完整片段。
  assert.match(code, /run: async \(reason, value\) => \{\s*if \(value == null[\s\S]{0,400}?const slot = `param\|/,
    "resolve 必须在 run(提交时)执行,不得回到 editParam 打开弹窗时");

  // 收敛语义:鸭型判据 + 只有全新尝试才在确定性失败时弃号。
  assert.match(code, /if \(mintedFresh && !isH8OutcomeUncertainError\(error\)\)\s*\{?\s*commandAttempts\.forget\(slot\)/);
  assert.match(code, /if \(mintedFresh && !isA2OutcomeUncertainError\(error\)\)\s*\{?\s*commandAttempts\.forget\(slot\)/);
  assert.doesNotMatch(code, /instanceof A2OutcomeUncertainError/,
    "裸 instanceof 在打包边界下会失真,仓内已有 isA2OutcomeUncertainError 鸭型判据");
});

test("h-client:H8「结果未知」三类齐(网络层 / 回执读不出 / 5xx),与 F 域口径一致", () => {
  const code = stripComments(read("lib/admin/h-client.ts"));
  assert.match(code, /class H8OutcomeUncertainError extends Error/);
  // 网络层异常由错误文案咽喉的 guardedFetch 接管(抛出的 Error 没有 status),所以判据按
  // 「有没有 HTTP 状态码」分流:没有 = 网络层,请求可能已到达后端 → 未知。
  assert.match(code, /const response = await guardedFetch\(`\/api\/admin\/growth\$\{path\}`/);
  // 写入端与读取端都要钉:只钉读取端时,删掉 growthRequest 里的赋值门照样绿,而 status 恒为
  // undefined → 503 全部落回确定性失败弃号(红测 RH3c 实测抓到过这个假绿)。
  assert.match(code, /Object\.assign\(error, \{ status: response\.status, bodyUnreadable: result === null \}\);/,
    "growthRequest 必须把状态码与「回执可读性」挂到抛出的错误上,否则调用方分不出 503 与 400");
  assert.match(code, /const \{ status, bodyUnreadable \} = error as Error & \{ status\?: number; bodyUnreadable\?: boolean \};/,
    "H8 必须真读这两个标记来分类");
  // 关键:growth proxy 后端不可达时返回的是**带 JSON body 的 503**,解析得动、走的是普通 Error 分支。
  // 只认解析异常 = 按错误页格式分类(返 HTML 算未知、返 JSON 算确定失败),那是巧合不是判据。
  assert.match(code, /if \(typeof status !== "number" \|\| bodyUnreadable \|\| outcomeStaysUnknown\(status\)\)/,
    "5xx 与网络层必须归「结果未知」保号 —— 归确定性失败会让重试铸新号 → 重复发奖");
  assert.match(code, /throw new H8OutcomeUncertainError\(/);
  // 命令号已持久化 24h,铸号必须带随机段且兜底 secure context(局域网 http 演示下 randomUUID 不存在)。
  assert.match(code, /typeof crypto\.randomUUID === "function"[\s\S]{0,120}Math\.random\(\)/);
});

test("verify 齿轮表:生产构建恰好一条,且排在依赖兄弟仓的齿之前", () => {
  const verify = read("scripts/verify.mjs");
  const builds = verify.match(/\["production build"/g) ?? [];
  assert.equal(builds.length, 1,
    `production build 齿轮应恰好 1 条,实际 ${builds.length} —— 重复会让有兄弟仓的机器跑两遍最贵的齿`);
  const buildAt = verify.indexOf('["production build"');
  const backendAt = verify.indexOf('["real recharge-channel parity"');
  assert.ok(buildAt > 0 && backendAt > 0);
  assert.ok(buildAt < backendAt,
    "齿轮表是 fail-fast:production build 排在缺仓必崩的齿之后 = 完成门要求的「含生产构建的全绿」结构性不可达");
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

test("结果未知后刷新原样重试:同值同 version 复用同号;收敛后同输入换新号", () => {
  const { store, mint } = freshStore();
  const fp = JSON.stringify(["3", 7]);

  const first = store.resolve("param|newcomer.usdt", fp, mint);
  const reloaded = createSlotAttemptStore({ storageKey: "nexion-admin-h8-commands-v1" });
  assert.equal(reloaded.resolve("param|newcomer.usdt", fp, mint), first,
    "命令号必须落 sessionStorage:弹窗打开时现铸存组件态的旧半措施,刷新即丢");

  reloaded.forget("param|newcomer.usdt");
  // merge 2026-08-06:幂等包给 store 加内存镜像(防写失败)后,「双实例同键」是运行时
  // 不存在的场景(模块级单实例);收敛换新号断言回归单实例语义。
  assert.notEqual(reloaded.resolve("param|newcomer.usdt", fp, mint), first);
});

test("指纹织入 expectedVersion:同值不同 version 是新意图必换号(CAS 不是幂等重试)", () => {
  const { store, mint } = freshStore();
  const v7 = store.resolve("param|inviter.nex", JSON.stringify(["120", 7]), mint);
  const v8 = store.resolve("param|inviter.nex", JSON.stringify(["120", 8]), mint);
  assert.notEqual(v8, v7,
    "version 变了 = 基于新快照的新提交;复用旧号会被后端当成旧版本的重试去重吞掉");
});

test("改理由不换号:结果未知后补一句理由再提交,仍是同一次发奖意图", () => {
  const { store, mint } = freshStore();
  // 指纹只有 [新值, version] —— 理由不在其中,所以改理由 resolve 出的是同一个号。
  const fp = JSON.stringify(["3", 7]);
  const first = store.resolve("param|newcomer.usdt", fp, mint);
  assert.equal(store.resolve("param|newcomer.usdt", fp, mint), first,
    "理由是审计元数据不是意图:改理由换号会让同一笔发奖参数变更执行两次");
});

test("不同参数键互不撞号;结算与调参分槽", () => {
  const { store, mint } = freshStore();
  assert.notEqual(
    store.resolve("param|newcomer.usdt", JSON.stringify(["3", 7]), mint),
    store.resolve("param|newcomer.nex", JSON.stringify(["3", 7]), mint));
  assert.notEqual(
    store.resolve("param|newcomer.usdt", JSON.stringify(["3", 7]), mint),
    store.resolve("settle|batch", JSON.stringify([20, 7, 3, "hash"]), mint));
});
