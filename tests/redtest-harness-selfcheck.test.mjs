import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 红测脚本自身的守门人(2026-08-06 第四轮验收 P1-C / P1-D)。
 *
 * 背景:`scripts/_redtest-idem-hardening.mjs` 是全包唯一验证「这些门有没有判别力」的东西,
 * 但它**自己没有任何门守着** —— 曾经处于语法错误跑不起来的状态,而 `npm run verify` 照样全绿。
 * 它不能直接挂进 verify(会临时改写源文件,并行跑互相踩),所以由本文件守住它「还活着、还合格」。
 *
 * 这里刻意**不跑**红测(那要几分钟且会改文件),只做静态自检。
 */

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const REDTEST = "scripts/_redtest-idem-hardening.mjs";

test("红测脚本语法可解析(它坏掉时 verify 不会有任何反应)", () => {
  // node --check 不执行,只解析;脚本一旦语法错误立刻红。
  execFileSync("node", ["--check", REDTEST], { cwd: new URL("../", import.meta.url).pathname.replace(/^\//, "") });
});

test("红测规模不得静默缩水(用例被删就等于门失去判别力证明)", () => {
  const src = read(REDTEST);
  const cases = src.match(/^\s{2}\["/gm) ?? [];
  assert.ok(cases.length >= 55,
    `红测用例只剩 ${cases.length} 条,少于基线 55 —— 用例被删时没有别的门会响`);
  const green = src.match(/"green"/g) ?? [];
  assert.ok(green.length >= 8,
    `反误红用例只剩 ${green.length} 条:只验「能打红」不验「不误红」的门迟早把合法重构挡死`);
});

test("红测的三道自我保护还在(空注入守卫 / 失败关键词 / 还原指纹)", () => {
  const src = read(REDTEST);
  assert.match(src, /空注入\(from === to\)/, "空注入守卫被摘掉后,零判别力的用例会照样打 ✓");
  assert.match(src, /expectText/, "失败关键词机制被摘掉后,「红对了但理由不对」会照样打 ✓");
  assert.match(src, /createHash\("sha1"\)/, "还原指纹被摘掉后,内容没还原也查不出来");
});

/**
 * 🔴 归属标记的键名必须是**稳定字面量**(第四轮验收 P1-D)。
 *
 * 根因是验证工具的维度盲区:契约测试在同一个进程里跑,模块级常量只求值一次,
 * 天生看不见「换一次页面加载」——把键名改成随机值,每次页面加载都会判成换人、
 * 每次都清扫,「命令号跨刷新存活」整体失效,而所有行为断言照样全绿。
 * 这一维只能静态守。
 */
test("归属标记键名是稳定字面量(随机化会让每次页面加载都清扫)", () => {
  const store = read("lib/admin/pending-mutation-store.ts");
  assert.match(store, /const COMMAND_OWNER_KEY = "[a-z0-9-]+";/,
    "键名必须是写死的字符串;含 Date.now / random / 变量拼接都会让它每次加载都变");
  const line = store.match(/const COMMAND_OWNER_KEY = .*/)[0];
  for (const forbidden of ["Date.now", "random", "${", "crypto", "+"]) {
    assert.ok(!line.includes(forbidden), `键名里不得出现 ${forbidden}:那会让标记每次加载都变`);
  }
});
