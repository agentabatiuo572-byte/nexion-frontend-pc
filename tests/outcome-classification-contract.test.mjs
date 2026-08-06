import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { isDeterministicRejection, outcomeStaysUnknown } from "../lib/admin/outcome-classification.ts";

/**
 * 全家族「失败归类」统一口径契约(2026-08-06 主人拍板)。
 *
 * 要守的唯一事实:**在途命令号只有在确定性拒绝时才能丢**。
 * 5xx / 传输层失败 / 响应不可读时后端可能已经落库,丢了号 → 下次重试铸新号 →
 * 后端按新号当成第二条命令 → 重复入账 / 重复打款。
 *
 * 两半合一:
 *   运行时半 —— 谓词本身的真值表(含边界);
 *   静态半   —— 全舰队接线:每个带命令号的 client 都必须由**这一个**谓词做判断,
 *               不许再各写各的 `status < 500` / `=== "unknown"`。
 */

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ---------------------------------------------------------------- 运行时半:真值表

test("确定性拒绝 = 4xx ∨ (2xx 且业务码非 0);其余一律结果未知", () => {
  // 4xx:服务端明确拒绝,没有副作用 → 可以安全丢弃命令号
  for (const status of [400, 401, 403, 404, 409, 422, 429, 499]) {
    assert.equal(isDeterministicRejection(status), true, `${status} 应判确定性拒绝`);
    assert.equal(outcomeStaysUnknown(status), false);
  }
  // 5xx:后端可能已经落库 → 必须保号
  for (const status of [500, 502, 503, 504, 599]) {
    assert.equal(isDeterministicRejection(status), false, `${status} 不得判确定失败 —— 保号才防得住双发`);
    assert.equal(outcomeStaysUnknown(status), true);
  }
  // 2xx 带非 0 业务码 = 请求到达且被业务层拒绝
  assert.equal(isDeterministicRejection(200, 1001), true);
  assert.equal(isDeterministicRejection(200, 0), false, "业务码 0 是成功,不该走失败分支");
  assert.equal(isDeterministicRejection(200), false, "2xx 且无业务码 = 说不清,按未知处理");
  // 边界:399 / 600 这类非常规值不得被当成确定失败
  assert.equal(isDeterministicRejection(399), false);
  assert.equal(isDeterministicRejection(600), false);
  assert.equal(outcomeStaysUnknown(0), true, "status 0(传输层失败的常见取值)必须归未知");
});

test("两个谓词恒为互补(避免将来有人只改一个)", () => {
  for (const status of [0, 200, 204, 301, 400, 404, 418, 500, 503, 599]) {
    for (const code of [undefined, 0, 7]) {
      assert.equal(outcomeStaysUnknown(status, code), !isDeterministicRejection(status, code));
    }
  }
});

// ---------------------------------------------------------------- 静态半:全舰队接线

/**
 * ground truth 取磁盘。扫描面 = 「自带结果未知通道」**或**「自己维护命令号去留」的模块。
 *
 * 🔴 不再只筛 `-client.ts` + `Outcome*Error`(2026-08-06 独立验收 P1-3 / P2-4):
 *   `stable-mutation.ts` 不是 -client 却握着 g1/g2/g3/g4/g7 五个域的判据;
 *   `d-client` / `i-client` 没有自带错误类型却自己决定 forget,先前整个不在覆盖内。
 */
const CLIENTS = readdirSync(new URL("../lib/admin/", import.meta.url))
  .filter((name) => /\.ts$/.test(name) && !/\.test\./.test(name))
  .map((name) => ({ name, code: strip(read(`lib/admin/${name}`)) }))
  .filter(({ name, code }) => {
    if (name === "outcome-classification.ts") return false;
    // 必须**真的检查了 HTTP 结果**才谈得上归类:h9-client 只在成功后丢号、没有失败分支,
    // propose-or-execute / operation-confirm-error / pending-mutation-store 是编排与存储层,
    // 都不做归类 —— 把它们拖进来只会逼出无意义的接线。
    // 「检查了 HTTP 结果」有两种形态:自己读 response.ok/status,或**收一个 status 形参**
    // 替别人判(stable-mutation 就是后者 —— 它握着 g1/g2/g3/g4/g7 五个域的判据,
    // 却因为不读 response 差点整个漏出扫描面,2026-08-06 独立验收 P1-3)。
    const inspectsOutcome = /\b(?:response|res)\.(?:ok|status)\b/.test(code)
      || /\bstatus\s*:\s*number\b/.test(code);
    // 🔴 「认了 unknown 头」本身就是「这个模块在做结果归类」的铁证(2026-08-06 收尾自检):
    //   a6 / a7 带命令号、认这个头、给的是「结果尚未确认」话术,但既没有专门的错误类型
    //   也不调 forget —— 前一版按「有没有错误类型 / 有没有 forget」筛范围,把这两个域
    //   整个漏在覆盖面外,它们的 5xx 与断网因此一直还是老口径。
    const decidesRetention = /\.forget\s*\(/.test(code)
      || /Outcome(?:Uncertain|Unknown)\w*Error/.test(code)
      || /StableMutationFailure/.test(code)
      || /X-Nexion-Upstream-Outcome/.test(code);
    return inspectsOutcome && decidesRetention;
  });

/**
 * 🔴 覆盖面本身必须钉住(2026-08-06 收尾自检)。
 *
 * 「把范围改窄」不会让任何门变红 —— 它只会让门悄悄变松,这是最难发现的退化方式:
 * a6 / a7 就是这么在覆盖面外躺了一整轮的。ground truth = 凡是往请求里塞 Idempotency-Key
 * 的模块,都在做「命令号去留」的决定,一个都不能漏出扫描面。
 */
/**
 * 发命令号但**不在归类门覆盖面内**的模块台账。每条必须写清为什么不需要归类。
 *
 * 🔴 为什么要有这张表(2026-08-06 收尾自检):「把范围改窄」不会让任何门变红 ——
 *   它只让门悄悄变松,是最难发现的退化方式。a6 / a7 就是这么在覆盖面外躺了一整轮:
 *   它们带命令号、认 unknown 头、给「结果尚未确认」话术,却因为没有专门的错误类型
 *   而被范围判据筛掉,5xx 与断网一直还是老口径。
 *   新增一个发命令号的模块时,要么进覆盖面,要么在这里登记理由 —— 不许沉默。
 */
const CLASSIFICATION_EXEMPT = {
  "g1-client.ts": "走通用执行器,归类在 stable-mutation 统一做",
  "g2-client.ts": "同上",
  "g3-client.ts": "同上",
  "g4-client.ts": "同上",
  "g7-client.ts": "同上",
  "h9-client.ts": "只在成功后弃号,没有失败期的去留决定;换输入即换号由槽位指纹保证",
  "a4-client.ts": "命令号每次现铸,没有可复用的号 → 谈不上保号/弃号(待迁,交接文档任务 A)",
  "b-client.ts": "同上",
  "f1-client.ts": "同上;stableIdempotencyKey 形参存在但全仓 0 调用方(任务 A 已记档)",
  "l-client.ts": "同上",
  "m-client.ts": "同上",
  "e1-client.ts": "同上", "e2-client.ts": "同上", "e3-client.ts": "同上",
  "e4-client.ts": "同上", "e5-client.ts": "同上", "e6-client.ts": "同上",
  "h-client.ts": "同上", "media-client.ts": "同上",
};

test("扫描面必须盖住每一个发命令号的模块(要么覆盖,要么台账登记理由)", () => {
  const carriers = readdirSync(new URL("../lib/admin/", import.meta.url))
    .filter((name) => /\.ts$/.test(name) && !/\.test\./.test(name))
    .filter((name) => /"Idempotency-Key"/.test(strip(read(`lib/admin/${name}`))));
  assert.ok(carriers.length >= 30, `只找到 ${carriers.length} 个发命令号的模块,扫描已失真`);

  const covered = new Set(CLIENTS.map(({ name }) => name));
  const undecided = carriers.filter((name) => !covered.has(name) && !CLASSIFICATION_EXEMPT[name]);
  assert.deepEqual(undecided, [],
    `这些模块会发命令号,却既不在归类门覆盖面内、也没在豁免台账里登记理由:${undecided.join(", ")}`);

  // 反向:台账登记了、但已经不发命令号(或已进覆盖面)的条目要删,防台账静默失真。
  const stale = Object.keys(CLASSIFICATION_EXEMPT)
    .filter((name) => !carriers.includes(name) || covered.has(name));
  assert.deepEqual(stale, [], `豁免台账里的过期条目(已进覆盖面或已不发命令号):${stale.join(", ")}`);
});

test("每个带「结果未知」通道的 client 都由共享谓词判定,不许各写各的", () => {
  assert.ok(CLIENTS.length >= 10, `只找到 ${CLIENTS.length} 个带 outcome 通道的 client,扫描已失真`);
  for (const { name, code } of CLIENTS) {
    // 两个谓词都算数(互补的一对):判「要不要丢号」用 outcomeStaysUnknown,
    // 判「是不是确定性拒绝」用 isDeterministicRejection —— stable-mutation 用的是后者。
    assert.match(code, /import \{ (?:outcomeStaysUnknown|isDeterministicRejection)[^}]*\} from "[^"]*outcome-classification(?:\.ts)?"/,
      `${name} 没接共享归类谓词 → 它自己那套口径迟早和别人分叉(正是本轮要根治的)`);
    assert.match(code, /(?:outcomeStaysUnknown|isDeterministicRejection)\s*\(/, `${name} 只 import 不用等于没接`);
  }
});

test("不许再出现自搓的 5xx 门槛(status < 500 / >= 500 这类散落判据)", () => {
  for (const { name } of CLIENTS) {
    // 这一条打在**原文**上:豁免标记写在注释里,剥注释后就找不到了。
    // 豁免必须显式(`classification-ok:` + 理由),不许靠沉默 —— 合法例外确实存在
    // (如按 5xx 挑错误文案),但要让评审看得见,而不是让门去猜。
    const raw = read(`lib/admin/${name}`);
    const lines = raw.split("\n");
    // 🔴 判的是**裸状态码阈值常量**,不是变量名(2026-08-06 独立验收 P1-2):
    //   原判据认 `status <> 500`,于是「参数不叫 status 的 helper」「`!(500 > res.status)`
    //   反转操作数」都能绕过,配一条永假的谓词死分支充数,门还是绿的。
    //   现在只要出现 4xx/5xx 段的三位数字面量与比较运算符同行就红,想绕只能显式豁免。
    // 🔴 具名常量也要解开(2026-08-06 第四轮验收 P1-F):把 500 提成 `const HARD = 500`
    //   再写 `status >= HARD`,字面量判据就整个绕过去了。先把本文件里指向 4xx/5xx 的
    //   数字常量名收集起来,再把用到它们的比较行一并纳入判定。
    const thresholdNames = [...raw.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::\s*number)?\s*=\s*([45]\d{2})\b/g)]
      .map((match) => match[1]);
    const namedThreshold = thresholdNames.length
      ? new RegExp(`[<>]=?\\s*(?:${thresholdNames.join("|")})\\b|\\b(?:${thresholdNames.join("|")})\\s*[<>]=?`)
      : null;
    const homemade = lines.filter((line, index) => {
      const bare = /[<>]=?\s*[45]\d{2}\b|\b[45]\d{2}\s*[<>]=?/.test(line);
      if (!bare && !(namedThreshold && namedThreshold.test(line))) return false;
      if (!bare) {
        const context = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
        return !context.includes("classification-ok:");
      }
      // 放行**业务码**门槛(`payload.code >= 400` 是本仓判「请求有没有失败」的既有惯例,
      // 与「命令号要不要丢」无关);5xx 阈值一律不放行 —— 被证明可绕过的正是那一类。
      if (/\bcode\b\s*[<>]=?\s*4\d{2}/.test(line) && !/5\d{2}/.test(line)) return false;
      const context = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
      return !context.includes("classification-ok:");
    });
    assert.deepEqual(homemade.map((line) => line.trim()), [],
      `${name} 里还有自搓的 5xx 门槛 → 归类口径必须只有 outcome-classification 一处;`
      + `确属非归类用途请在紧邻上方写 // classification-ok: <理由>`);
  }
});

test("谓词必须真的管着「命令号去留」,不是摆设(调用完得有抛未知 / 丢号的动作)", () => {
  // 判的是不变量本身,不是排版:a1 的头判定在前、5xx 判定在后隔了十几行,那完全正确 ——
  // 早期版本要求「两者必须挨在一起」,把合法写法判红了(本轮实测抓到,遂改成下面这条)。
  for (const { name, code } of CLIENTS) {
    const wired = [...code.matchAll(/(?:outcomeStaysUnknown|isDeterministicRejection)\s*\([^)]*\)/g)].some((match) => {
      const after = code.slice(match.index, match.index + 260);
      return /throw new \w*Outcome(?:Uncertain|Unknown)\w*Error/.test(after)
        || /\.forget\s*\(/.test(after)
        || /"deterministic"|"outcome-unknown"/.test(after)
        // a6 / a7 没有专门的错误类型,用本地工厂 `uncertain()` 造「结果尚未确认」的错误 ——
        // 形态不同但语义相同,同样是「谓词真的管着命令号去留」。
        || /throw uncertain\(\)/.test(after);
    });
    assert.ok(wired,
      `${name} 调了谓词却没接到任何「抛结果未知 / 丢命令号」的动作上 → 判了个寂寞`);
  }
});

test("认 unknown 头的 client 必须另有一条谓词驱动的路径(头不再是唯一保险丝)", () => {
  for (const { name, code } of CLIENTS) {
    if (!code.includes("X-Nexion-Upstream-Outcome")) continue;
    // 代理漏打这个头曾是致命单点:头没了 = 5xx 全被当确定失败 = 弃号 = 重复动作。
    assert.match(code, /outcomeStaysUnknown\s*\(/,
      `${name} 只认 unknown 头,没有谓词兜底 → 代理漏打头就退回老缺陷`);
  }
});

test("带命令号的写请求,传输层失败必须有兜底(裸 TypeError 冒到页面 = 被当确定失败弃号)", () => {
  for (const { name, code } of CLIENTS) {
    // 每个 client 的 fetch 都应处在 try 块里(或由带 try 的 helper 包着)。
    const fetches = [...code.matchAll(/await (?:fetch|writeFetch|request)\(/g)];
    if (!fetches.length) continue;
    assert.match(code, /try\s*\{[\s\S]*?await (?:fetch|writeFetch|request)\(/,
      `${name} 的写请求没有任何 try 包裹 → 断网时抛裸错误,调用方判不出「结果未知」`);
  }
});
