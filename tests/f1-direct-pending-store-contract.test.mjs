import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { F1OutcomeUncertainError, f1StableWrite } from "../lib/admin/f1-stable-write.ts";

/**
 * F 域直写通道稳定命令号契约(2026-08-06 任务 A:f1-client 十个高危写函数迁 SlotAttemptStore)。
 *
 * 两半合一才算「运行时证明对」:
 *   静态半 —— 钉 f1-client 每个写函数的**表达式级接线**(槽位带目标 id + 指纹构成),并封死
 *   `idempotencyPrefix` 现铸后门与 TeamConfig 死代码复活;
 *   运行时半 —— 真 import 咽喉 `f1-stable-write.ts` 跑「未知留号 / 收敛弃号 / 换输入换号」语义
 *   (f1-client 本体依赖 `@/` 路径别名,node --test 进不去 —— 咽喉抽零依赖文件正是为此)。
 */

/** 剥注释 + CRLF 归一:JS 正则 `.` 不吃 \r,行尾 \r 会挡住 `//.*$`,不归一则剥除器静默失效。 */
function stripComments(source) {
  return source
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
}

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// ---------- 静态半:f1-client 写函数逐个钉接线 ----------

test("f1-client 十个直写函数全部经 f1StableWrite,槽位带目标 id、指纹带输入值", () => {
  const code = stripComments(read("lib/admin/f1-client.ts"));

  assert.match(code, /from "@\/lib\/admin\/f1-stable-write"/);

  // 现铸后门封死:idempotencyPrefix 通道与 TeamConfig 死代码不得复活。
  assert.equal((code.match(/idempotencyPrefix/g) ?? []).length, 0,
    "f1-client 不得再出现 idempotencyPrefix —— 它是「每次现铸」后门,新写函数必须走 f1StableWrite");
  assert.equal((code.match(/TeamConfig/g) ?? []).length, 0,
    "updateF*TeamConfig 全仓零调用死代码已清,不得复活");

  // 逐函数钉「槽位 + 指纹」完整表达式(只查字面量会放过改槽/改指纹的回退)。
  assert.match(code, /f1StableWrite\(`f5-reverse\|\$\{commissionId\}`, JSON\.stringify\(\[refundRef, reason, operator\]\)/);
  assert.match(code, /f1StableWrite\(`f5-reissue\|\$\{\[\.\.\.commissionIds\]\.sort\(\)\.join\(","\)\}`, JSON\.stringify\(\[reason, operator\]\)/,
    "重发 = 打款:槽位必须钉排序后的整批事件 id");
  assert.match(code, /f1StableWrite\(`f5-suspend\|\$\{userId\}\|\$\{suspended\}`, JSON\.stringify\(\[\[\.\.\.kinds\]\.sort\(\), reason, operator\]\)/);
  assert.match(code, /f1StableWrite\("f5-anomaly-config", JSON\.stringify\(\[commissionAnomalySigma, layerRatioAnomalyPct, reason, operator\]\)/);
  assert.match(code, /f1StableWrite\(`f3-settle\|\$\{ownerUserId\}\|\$\{settlementDate\}`, JSON\.stringify\(\[reason\]\)/,
    "F3 结算:烂尾的稳定号通道必须真接上(焊在请求层,不再依赖零调用形参)");
  assert.match(code, /f1StableWrite\(`f1-vrank\|\$\{rank\}\|\$\{field\}`, JSON\.stringify\(\[value, reason, operator\]\)/);
  assert.match(code, /f1StableWrite\(`f1-reward-add\|\$\{rank\}`, JSON\.stringify\(\[item, reason, operator\]\)/);
  assert.match(code, /f1StableWrite\(`f1-reward-update\|\$\{rank\}\|\$\{rewardId\}`, JSON\.stringify\(\[item, reason, operator\]\)/);
  assert.match(code, /f1StableWrite\(`f1-reward-remove\|\$\{rank\}\|\$\{rewardId\}`, JSON\.stringify\(\[reason, operator\]\)/);

  // 每个接线都把 resolve 出的命令号真送进请求头通道。
  const wired = code.match(/stableIdempotencyKey: commandKey/g) ?? [];
  assert.ok(wired.length >= 9, `stableIdempotencyKey: commandKey 接线应 ≥9 处,实际 ${wired.length}`);
});

test("f1Request 写路径三类「结果未知」全部抛 F1OutcomeUncertainError(K 域同款分类)", () => {
  const code = stripComments(read("lib/admin/f1-client.ts"));
  // 网络断(fetch 抛)/ 响应体不可读 / 上游显式 unknown 头。
  assert.match(code, /error instanceof Error \? error\.message : "F1_REQUEST_OUTCOME_UNKNOWN"/);
  assert.match(code, /F1OutcomeUncertainError\("F1_RESPONSE_UNREADABLE", stableKey\)/);
  assert.match(code, /response\.headers\.get\("X-Nexion-Upstream-Outcome"\) === "unknown"/);
});

test("f1-stable-write 咽喉:resolve 接线 + 只在结果未知时留号(鸭型守卫)", () => {
  const code = stripComments(read("lib/admin/f1-stable-write.ts"));
  assert.match(code, /createSlotAttemptStore\(\{ storageKey: "nexion-admin-f1-direct-commands-v1" \}\)/);
  assert.match(code, /const commandKey = commandAttempts\.resolve\(slot, inputFingerprint,/);
  assert.match(code, /if \(!isF1OutcomeUncertainError\(error\)\)\s*\{?\s*commandAttempts\.forget\(slot\)/);
});

test("确认弹窗错误文案认得所有域的 *OutcomeUncertainError 族(不回退成只认 A2)", () => {
  const code = stripComments(read("lib/admin/operation-confirm-error.ts"));
  assert.match(code, /error\.name\.endsWith\("OutcomeUncertainError"\)/,
    "族判定被收窄回单一域名单会让 F/H8/K 的「结果未知」在弹窗里失去人话指引");
});

test("本契约与哨兵仍挂在 verify 齿轮上;咽喉文件仍登记在哨兵 MIGRATED(防回退门不失守)", () => {
  const verify = read("scripts/verify.mjs");
  assert.match(verify, /tests\/f1-direct-pending-store-contract\.test\.mjs/);
  assert.match(verify, /scripts\/pending-idempotency-key-sentinel\.mjs/);
  assert.match(read("scripts/pending-idempotency-key-sentinel.mjs"), /"lib\/admin\/f1-stable-write\.ts",/,
    "从 MIGRATED 摘行会让哨兵不再盯该文件回退成内存态 —— 登记本身也是契约的一部分");
});

// ---------- 运行时半:真 import 咽喉跑语义 ----------

/** 极简 sessionStorage 替身:换替身 = 模拟刷新(咽喉模块级 store 的内存 Map 不被 resolve 读取,持久面唯一真源)。 */
function installStorage() {
  const cells = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => (cells.has(key) ? cells.get(key) : null),
      setItem: (key, value) => { cells.set(key, String(value)); },
      removeItem: (key) => { cells.delete(key); },
    },
  };
  return { raw: (key) => JSON.parse(globalThis.window.sessionStorage.getItem(key) ?? "null") };
}

test("结果未知留号:原样重试复用同一命令号;成功收敛后同输入 = 新意图新号", async () => {
  installStorage();
  const seen = [];
  const fp = JSON.stringify(["REF-9", "重复入账冲正", "ops-a"]);

  await assert.rejects(
    f1StableWrite("f5-reverse|C-1001", fp, async (key) => {
      seen.push(key);
      throw new F1OutcomeUncertainError("网络中断", key);
    }),
    (error) => error instanceof F1OutcomeUncertainError,
  );
  await f1StableWrite("f5-reverse|C-1001", fp, async (key) => { seen.push(key); return "ok"; });
  assert.equal(seen[1], seen[0], "结果未知后的原样重试必须复用同号,否则后端无法去重 → 重复冲正");

  await f1StableWrite("f5-reverse|C-1001", fp, async (key) => { seen.push(key); return "ok"; });
  assert.notEqual(seen[2], seen[0], "成功收敛后同输入是新一次真实操作,复用已消费的号会被后端幂等吞掉");
});

test("确定性失败(后端拒绝)也收敛弃号:改对输入后重提不背旧号", async () => {
  installStorage();
  const seen = [];
  const fp = JSON.stringify([["ref"], "误发暂停", "ops-a"]);

  await assert.rejects(
    f1StableWrite("f5-suspend|1001|true", fp, async (key) => {
      seen.push(key);
      throw new Error("F1_REQUEST_FAILED_400");
    }),
  );
  await f1StableWrite("f5-suspend|1001|true", fp, async (key) => { seen.push(key); return "ok"; });
  assert.notEqual(seen[1], seen[0], "4xx 是确定性拒绝,命令号已收敛;继续背旧号会把下一次真实提交误标成重试");
});

test("换输入 = 新意图换新号并弃旧号(改回原值不复活旧号);不同目标互不撞号", async () => {
  const env = installStorage();
  const run = (slot, fp) => {
    let captured;
    return f1StableWrite(slot, fp, async (key) => {
      captured = key;
      throw new F1OutcomeUncertainError("网络中断", key);
    }).catch(() => captured);
  };

  const original = await run("f1-vrank|V3|teamGv", JSON.stringify(["50000", "调档", "ops-a"]));
  const changed = await run("f1-vrank|V3|teamGv", JSON.stringify(["60000", "调档", "ops-a"]));
  assert.notEqual(changed, original, "输入变了必须铸新号,否则后端按旧号去重,新值被静默吞掉");
  const persisted = env.raw("nexion-admin-f1-direct-commands-v1");
  assert.ok(persisted && !Object.keys(persisted).includes(original),
    "旧命令号必须随换输入被丢弃 —— 留到 TTL 会在改回原值时复活已消费的号");
  const backToOriginal = await run("f1-vrank|V3|teamGv", JSON.stringify(["50000", "调档", "ops-a"]));
  assert.notEqual(backToOriginal, original, "改回原值也是新意图:旧号可能已被后端消费");

  const otherTarget = await run("f1-vrank|V4|teamGv", JSON.stringify(["50000", "调档", "ops-a"]));
  assert.notEqual(otherTarget, backToOriginal, "目标对象在槽位里,跨档位绝不共号");
});

test("刷新后仍认得在途命令号:换 store 读面(模拟刷新)原样重试复用同号", async () => {
  installStorage();
  let first;
  await f1StableWrite("f3-settle|7001|2026-08-06", JSON.stringify(["周结算"]), async (key) => {
    first = key;
    throw new F1OutcomeUncertainError("响应丢失", key);
  }).catch(() => {});

  // 刷新 = 内存清零只剩 sessionStorage;咽喉的 resolve 只读持久面,直接复演即可。
  let second;
  await f1StableWrite("f3-settle|7001|2026-08-06", JSON.stringify(["周结算"]), async (key) => {
    second = key;
    return "ok";
  });
  assert.equal(second, first, "命令号必须落 sessionStorage 跨刷新存活 —— 组件态/内存态正是本轮迁移根除的缺陷");
});
