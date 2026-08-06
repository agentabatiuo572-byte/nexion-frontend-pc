import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { F1OutcomeUncertainError, f1StableWrite } from "../lib/admin/f1-stable-write.ts";

/**
 * F 域直写通道稳定命令号契约(2026-08-06 任务 A:f1-client 九个高危写函数迁 SlotAttemptStore)。
 *
 * 两半合一才算「运行时证明对」:
 *   静态半 —— 钉 f1-client 每个写函数的**表达式级接线**(槽位带目标 id + 指纹构成),并封死
 *   `idempotencyPrefix` 现铸后门与 TeamConfig 死代码复活;
 *   运行时半 —— 真 import 咽喉 `f1-stable-write.ts` 跑「未知留号 / 收敛弃号 / 换输入换号」语义,
 *   并断言**发给后端的 key 就是 store 里的号**(只钉赋值语句的话,`request(key + Date.now())`
 *   这类加工绕法照样全绿 —— 对抗审计实证过)。
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

test("f1-client 九个直写函数全部经 f1StableWrite,槽位带目标 id、指纹带输入值且不含 reason", () => {
  const code = stripComments(read("lib/admin/f1-client.ts"));

  assert.match(code, /from "@\/lib\/admin\/f1-stable-write"/);

  // 现铸后门封死:idempotencyPrefix 通道与 TeamConfig 死代码不得复活。
  assert.equal((code.match(/idempotencyPrefix/g) ?? []).length, 0,
    "f1-client 不得再出现 idempotencyPrefix —— 它是「每次现铸」后门,新写函数必须走 f1StableWrite");
  assert.equal((code.match(/TeamConfig/g) ?? []).length, 0,
    "updateF*TeamConfig 全仓零调用死代码已清,不得复活");

  // 逐函数钉「槽位 + 指纹」完整表达式(只查字面量会放过改槽/改指纹的回退)。
  assert.match(code, /f1StableWrite\(`f5-reverse\|\$\{commissionId\}`, JSON\.stringify\(\[refundRef, operator\]\)/);
  assert.match(code, /f1StableWrite\("f5-reissue", JSON\.stringify\(\[sortedIds, operator\]\)/,
    "重发 = 打款:整批 id 必须在**指纹**里(放槽位会让改回原勾选复用可能已消费的旧号,且撑爆头长度)");
  assert.match(code, /f1StableWrite\(`f5-suspend\|\$\{userId\}\|\$\{suspended\}`, JSON\.stringify\(\[sortedKinds, operator\]\)/);
  // 🔴 body 必须送与指纹**同一个**排序数组:后端幂等 payload-bound(同键异载荷 → 409),
  // 指纹排序而 body 送原序时,列表刷新导致顺序变化就会把重试硬拒掉。
  assert.match(code, /const sortedIds = \[\.\.\.commissionIds\]\.sort\(\);/);
  assert.match(code, /body: JSON\.stringify\(\{ commissionIds: sortedIds, reason, operator \}\)/);
  assert.match(code, /const sortedKinds = \[\.\.\.kinds\]\.sort\(\);/);
  assert.match(code, /body: JSON\.stringify\(\{ kinds: sortedKinds, suspended, reason, operator \}\)/);
  assert.match(code, /f1StableWrite\("f5-anomaly-config", JSON\.stringify\(\[commissionAnomalySigma, layerRatioAnomalyPct, operator\]\)/);
  assert.match(code, /f1StableWrite\(`f3-settle\|\$\{ownerUserId\}\|\$\{settlementDate\}`, "settlement"/,
    "F3 结算:烂尾的稳定号通道必须真接上,且同 owner+结算日恒定指纹");
  assert.match(code, /f1StableWrite\(`f1-vrank\|\$\{rank\}\|\$\{field\}`, JSON\.stringify\(\[value, operator\]\)/);
  assert.match(code, /f1StableWrite\(`f1-reward-add\|\$\{rank\}`, JSON\.stringify\(\[item, operator\]\)/);
  assert.match(code, /f1StableWrite\(`f1-reward-update\|\$\{rank\}\|\$\{rewardId\}`, JSON\.stringify\(\[item, operator\]\)/);
  assert.match(code, /f1StableWrite\(`f1-reward-remove\|\$\{rank\}\|\$\{rewardId\}`, JSON\.stringify\(\[operator\]\)/);

  // reason 不得进任何指纹:理由是审计元数据,进指纹会让「结果未知后补理由再点」换新号 → 重复打款。
  assert.doesNotMatch(code, /f1StableWrite\([^)]*reason[,\]]/,
    "指纹里出现 reason —— 改理由就会铸新号,同一笔动作被执行两次");

  // 数量精确:九个写函数、九处接线。写 >= 会让「漏接一个」永远不红。
  assert.equal((code.match(/f1StableWrite\(/g) ?? []).length, 9);
  assert.equal((code.match(/stableIdempotencyKey: commandKey/g) ?? []).length, 9);
});

test("f1Request:写路径无稳定号直接拒绝,四类结果未知保号,4xx/401 仍弃号且照常登出", () => {
  const code = stripComments(read("lib/admin/f1-client.ts"));

  // 保底闸:删了 idempotencyPrefix 后,这是唯一挡住「新写函数忘了走咽喉」的东西。
  // 走 formatAdminApiError:裸错误码会被确认弹窗原样上屏,违反「页面文案禁工程名词/错误码」。
  assert.match(code, /if \(isWrite && !stableKey\) \{\s*throw new Error\(formatAdminApiError\(undefined, "F1_WRITE_REQUIRES_STABLE_KEY"\)\)/);

  // 会话失效判定必须在任何 throw 之前,否则 401 + 非标准错误页会卡在僵尸登录态。
  const authAt = code.indexOf("const authRejected = isAdminAuthFailure");
  const firstUncertainAt = code.indexOf("F1_RESPONSE_UNREADABLE");
  assert.ok(authAt > 0 && firstUncertainAt > authAt,
    "isAdminAuthFailure 必须排在「响应不可读」抛出之前 —— 否则 401 + HTML 错误页时不再登出");
  assert.match(code, /if \(authRejected\) \{\s*resetAdminSession\(\)/);
  assert.match(code, /if \(isWrite && stableKey && !authRejected\)/,
    "401 是后端明确拒绝,必须排除在「结果未知」之外,否则会把没执行的操作标成可能已执行");

  // 四类未知。
  assert.match(code, /error instanceof Error \? error\.message : "F1_REQUEST_OUTCOME_UNKNOWN"/);
  assert.match(code, /F1OutcomeUncertainError\(formatAdminApiError\(undefined, "F1_RESPONSE_UNREADABLE"\), stableKey\)/);
  // 「结果未知」文案必须过 formatAdminApiError:F 域的错误在 f-view 走 toast 路径原样上屏,
  // 裸错误码会直接怼到运营脸上(违反「页面文案禁工程名词/错误码」)。
  assert.doesNotMatch(code, /F1OutcomeUncertainError\("F1_[A-Z_]+", stableKey\)/);
  assert.match(code, /X-Nexion-Upstream-Outcome"\)\?\.trim\(\)\.toLowerCase\(\) === "unknown"/);
  assert.match(code, /includes\("UPSTREAM_OUTCOME_UNKNOWN"\)/,
    "除响应头外还要认 message 里的上游未知标记(teams proxy 目前不透传该头)");
  assert.match(code, /if \(response\.status >= 500\) \{\s*throw new F1OutcomeUncertainError\(/,
    "5xx 必须归「结果未知」保号 —— 归确定性失败会让重试铸新号 → 重复打款");
  // 「200 + 业务码 0 但 data 缺失」= 回包被截断,后端可能已执行 → 保号。
  // 但只对**要读返回值**的调用开:F5 四个 void 写若后端本就返 data:null,无条件启用会每次抛未知
  // 且不弃号 → 重试原样重放、再抛,操作面永久卡死而钱其实已经打了。
  assert.match(code, /if \(init\?\.expectsData && response\.ok && result\?\.code === 0 && result\.data == null\)/);
  assert.equal((code.match(/expectsData: true/g) ?? []).length, 5,
    "expectsData 应恰好 5 处(F3 结算 + 4 个 F1 读回 overview 的写);给 void 写开会把它们钉死");

  // 反向:不许把判据放宽成一切非 2xx(4xx 是后端明确拒绝,保号会把下一次真实提交误标成重试)。
  assert.doesNotMatch(code, /if \(response\.status >= 400\) \{\s*throw new F1OutcomeUncertainError/);
});

test("f1-stable-write 咽喉:resolve 接线 + 只在结果未知/非全新尝试时留号(鸭型守卫)", () => {
  const code = stripComments(read("lib/admin/f1-stable-write.ts"));
  assert.match(code, /createSlotAttemptStore\(\{ storageKey: "nexion-admin-f-direct-commands-v1" \}\)/);
  assert.match(code, /const commandKey = commandAttempts\.resolve\(slot, inputFingerprint, \(\) => \{/);
  assert.match(code, /mintedFresh = true;/);
  assert.match(code, /if \(mintedFresh && !isF1OutcomeUncertainError\(error\)\)\s*\{?\s*commandAttempts\.forget\(slot\)/,
    "复用来的号说明上次结果未知,这次的确定性失败证明不了那次没落地 —— 弃号会导致重复执行");
  // 命令号必须原样交给 request,不得加工(加尾缀会让后端去重失效,而只钉赋值语句的门看不见)。
  assert.match(code, /const result = await request\(commandKey\);/);
  // 唯一性必须有随机源:只用时间戳+模块序号时,两个标签页同毫秒会撞出同一个号。
  // 且必须兜底 —— randomUUID 是 secure-context-only,局域网 http 演示下不存在,裸调会让铸号即崩。
  assert.match(code, /typeof crypto\.randomUUID === "function"[\s\S]{0,120}Math\.random\(\)/,
    "randomUUID 必须带 typeof 兜底(仓内 8 处同款写法),否则 http 演示环境下 F 域全部写入发不出去");
});

test("确认弹窗错误文案:认全族,但不承诺「自动复用命令号」(A3 等仍是每次现铸)", () => {
  const code = stripComments(read("lib/admin/operation-confirm-error.ts"));
  assert.match(code, /error\.name\.endsWith\("OutcomeUncertainError"\)/,
    "族判定被收窄回单一域名单会让 F/H8/K 的「结果未知」在弹窗里失去人话指引");
  assert.doesNotMatch(code, /系统会复用同一命令号/,
    "不得对全族承诺自动去重:A3/A1 带 commandKey 但每次现铸,这个承诺会骗运营去重试");
});

test("本契约与哨兵仍挂在 verify 齿轮上;咽喉文件仍登记在哨兵 MIGRATED(防回退门不失守)", () => {
  const verify = read("scripts/verify.mjs");
  assert.match(verify, /tests\/f1-direct-pending-store-contract\.test\.mjs/);
  assert.match(verify, /scripts\/pending-idempotency-key-sentinel\.mjs/);
  assert.match(read("scripts/pending-idempotency-key-sentinel.mjs"), /"lib\/admin\/f1-stable-write\.ts",/,
    "从 MIGRATED 摘行会让哨兵不再盯该文件回退成内存态 —— 登记本身也是契约的一部分");
});

// ---------- 运行时半:真 import 咽喉跑语义 ----------

const STORAGE_KEY = "nexion-admin-f-direct-commands-v1";

/** 极简 sessionStorage 替身。咽喉的 resolve 只读持久面,换替身即等价于刷新。 */
function installStorage() {
  const cells = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => (cells.has(key) ? cells.get(key) : null),
      setItem: (key, value) => { cells.set(key, String(value)); },
      removeItem: (key) => { cells.delete(key); },
    },
  };
  return {
    raw: () => JSON.parse(globalThis.window.sessionStorage.getItem(STORAGE_KEY) ?? "null"),
    storedKeys: () => Object.keys(JSON.parse(globalThis.window.sessionStorage.getItem(STORAGE_KEY) ?? "{}")),
  };
}

test("发给后端的 key 就是 store 里的号:咽喉不得对命令号做任何加工", async () => {
  const env = installStorage();
  let sent;
  await f1StableWrite("f5-reverse|C-2001", JSON.stringify(["REF-1", "ops-a"]), async (key) => {
    sent = key;
    throw new F1OutcomeUncertainError("网络中断", key);
  }).catch(() => {});

  assert.deepEqual(env.storedKeys(), [sent],
    "store 里存的号必须与发出去的号逐字相同 —— 加尾缀/改写都会让后端按另一个号去重,防重复形同虚设");
});

test("结果未知留号:原样重试复用同一命令号;成功收敛后同输入 = 新意图新号", async () => {
  installStorage();
  const seen = [];
  const fp = JSON.stringify(["REF-9", "ops-a"]);

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

test("全新尝试撞确定性失败即弃号;但「未知之后」的确定性失败不得弃号", async () => {
  installStorage();
  const fresh = [];
  const fp = JSON.stringify([["ref"], "ops-a"]);

  // ① 全新尝试 → 4xx:后端明确拒绝且没执行,弃号。
  await assert.rejects(
    f1StableWrite("f5-suspend|1001|true", fp, async (key) => {
      fresh.push(key);
      throw new Error("F1_REQUEST_FAILED_400");
    }),
  );
  await f1StableWrite("f5-suspend|1001|true", fp, async (key) => { fresh.push(key); return "ok"; });
  assert.notEqual(fresh[1], fresh[0], "4xx 是确定性拒绝,命令号已收敛,下一次是新意图");

  // ② 先未知(保号),再撞确定性失败:那次未知可能已落地,号必须留着。
  installStorage();
  const chain = [];
  const fp2 = JSON.stringify([["ref2"], "ops-a"]);
  await f1StableWrite("f5-suspend|1002|true", fp2, async (key) => {
    chain.push(key);
    throw new F1OutcomeUncertainError("网关超时", key);
  }).catch(() => {});
  await f1StableWrite("f5-suspend|1002|true", fp2, async (key) => {
    chain.push(key);
    throw new Error("F1_REQUEST_FAILED_409");
  }).catch(() => {});
  await f1StableWrite("f5-suspend|1002|true", fp2, async (key) => { chain.push(key); return "ok"; });
  assert.equal(chain[1], chain[0], "重试必须复用未知那次的号");
  assert.equal(chain[2], chain[0],
    "409 证明不了第一次未知尝试没落地;此时弃号会让下一次重试铸新号 → 重复执行(d-client 同款守卫)");
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

  const original = await run("f1-vrank|V3|teamGv", JSON.stringify(["50000", "ops-a"]));
  const changed = await run("f1-vrank|V3|teamGv", JSON.stringify(["60000", "ops-a"]));
  assert.notEqual(changed, original, "输入变了必须铸新号,否则后端按旧号去重,新值被静默吞掉");
  assert.ok(!env.storedKeys().includes(original),
    "旧命令号必须随换输入被丢弃 —— 留到 TTL 会在改回原值时复活已消费的号");
  const backToOriginal = await run("f1-vrank|V3|teamGv", JSON.stringify(["50000", "ops-a"]));
  assert.notEqual(backToOriginal, original, "改回原值也是新意图:旧号可能已被后端消费");

  const otherTarget = await run("f1-vrank|V4|teamGv", JSON.stringify(["50000", "ops-a"]));
  assert.notEqual(otherTarget, backToOriginal, "目标对象在槽位里,跨档位绝不共号");
});

test("F5 批量重发:改勾选换新号并弃旧号,改回原勾选不复活;命令号长度不随勾选量增长", async () => {
  installStorage();
  const run = (ids) => {
    let captured;
    return f1StableWrite("f5-reissue", JSON.stringify([[...ids].sort(), "ops-a"]), async (key) => {
      captured = key;
      throw new F1OutcomeUncertainError("网关超时", key);
    }).catch(() => captured);
  };

  const ab = await run(["EVT-A", "EVT-B"]);
  assert.equal(await run(["EVT-B", "EVT-A"]), ab, "勾选顺序不同不是两批,必须同号");
  const abc = await run(["EVT-A", "EVT-B", "EVT-C"]);
  assert.notEqual(abc, ab);
  assert.notEqual(await run(["EVT-A", "EVT-B"]), ab,
    "改回原勾选也是新意图:旧号可能已被后端消费,复用会让这次真实补发被静默吞掉");

  const bulk = await run(Array.from({ length: 200 }, (_, i) => `EVT-${i}`));
  assert.ok(bulk.length < 100, `命令号长度 ${bulk.length},随勾选量增长会撞 HTTP 头长度上限被 proxy 拒`);
});

test("刷新后仍认得在途命令号:换 store 读面(模拟刷新)原样重试复用同号", async () => {
  const env = installStorage();
  let first;
  await f1StableWrite("f3-settle|7001|2026-08-06", "settlement", async (key) => {
    first = key;
    throw new F1OutcomeUncertainError("响应丢失", key);
  }).catch(() => {});

  const persisted = env.raw();
  // 刷新 = 内存清零、sessionStorage 留存。换一个只保留持久面的替身,证明复用不是内存 Map 蒙的。
  const survived = installStorage();
  globalThis.window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

  let second;
  await f1StableWrite("f3-settle|7001|2026-08-06", "settlement", async (key) => {
    second = key;
    return "ok";
  });
  assert.equal(second, first, "命令号必须落 sessionStorage 跨刷新存活 —— 组件态/内存态正是本轮迁移根除的缺陷");
  assert.deepEqual(survived.storedKeys(), [], "成功后必须清槽");
});
