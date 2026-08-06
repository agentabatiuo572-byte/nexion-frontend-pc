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

/** ground truth 取磁盘:凡是自带「结果未知」错误类型的 client,都必须接共享谓词。 */
const CLIENTS = readdirSync(new URL("../lib/admin/", import.meta.url))
  .filter((name) => /-client\.ts$/.test(name))
  .map((name) => ({ name, code: strip(read(`lib/admin/${name}`)) }))
  .filter(({ code }) => /Outcome(Uncertain|Unknown)Error/.test(code));

test("每个带「结果未知」通道的 client 都由共享谓词判定,不许各写各的", () => {
  assert.ok(CLIENTS.length >= 10, `只找到 ${CLIENTS.length} 个带 outcome 通道的 client,扫描已失真`);
  for (const { name, code } of CLIENTS) {
    assert.match(code, /import \{ outcomeStaysUnknown \} from "@\/lib\/admin\/outcome-classification"/,
      `${name} 没接共享归类谓词 → 它自己那套口径迟早和别人分叉(正是本轮要根治的)`);
    assert.match(code, /outcomeStaysUnknown\s*\(/, `${name} 只 import 不用等于没接`);
  }
});

test("不许再出现自搓的 5xx 门槛(status < 500 / >= 500 这类散落判据)", () => {
  for (const { name } of CLIENTS) {
    // 这一条打在**原文**上:豁免标记写在注释里,剥注释后就找不到了。
    // 豁免必须显式(`classification-ok:` + 理由),不许靠沉默 —— 合法例外确实存在
    // (如按 5xx 挑错误文案),但要让评审看得见,而不是让门去猜。
    const raw = read(`lib/admin/${name}`);
    const homemade = raw.split("\n")
      .filter((line) => /\bstatus\s*[<>]=?\s*500\b/.test(line))
      .filter((line, index, all) => {
        const lineNo = raw.split("\n").indexOf(line);
        const context = raw.split("\n").slice(Math.max(0, lineNo - 3), lineNo + 1).join("\n");
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
    const wired = [...code.matchAll(/outcomeStaysUnknown\s*\([^)]*\)/g)].some((match) => {
      const after = code.slice(match.index, match.index + 260);
      return /throw new \w*Outcome(?:Uncertain|Unknown)\w*Error/.test(after) || /\.forget\s*\(/.test(after);
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
