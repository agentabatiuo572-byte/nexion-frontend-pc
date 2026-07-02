#!/usr/bin/env node
/**
 * Kill-switch 计数一致性哨兵。
 *
 * 防「改枚举数后 N 闸残留漂移」复发(2026-06-17:premium+nexv2 下线后 7→5,
 * 但多处「7闸/6闸/7-7/六功能闸/七闸/七个熔断闸」漏改、含运营可见 stat 卡 + 首页驾驶舱告警;
 * 典型「修一处≠修全部」,且旧 grep 只盯「N 闸」漏掉了「N/N」「N 功能闸」「中文数字 N 闸」)。
 *
 * 单源 = EXPECTED_KEYS(当前后端功能闸集合)。如新增/移除功能闸,同步改此常量与可见文案。
 * 断言:
 *   计数:app/ lib/ 代码里所有「断言式功能闸计数」的数字 == 功能闸数 N。覆盖形态:
 *      N 道熔断闸 / N 个?熔断闸 / N 功能闸 / N 大业务闸门 / N 闸(全开|全部在线|矩阵|只读|在线)/
 *      Kill[-Switch] N 闸 / Kill[-Switch] N/N / N/N 熔断(总数=N)/ 中文数字「N个熔断闸·N功能闸·NN闸」。
 *      旧 7/6(含已下线两闸)即违例。
 *   (geo-block「6 闸(5+geo)」框架只在 PRD 文档,不在 app/lib 代码,故此处不豁免 6;若未来代码引入需加例外。)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_KEYS = ["withdraw", "staking", "genesis", "exchange", "trial"];
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };

const read = (f) => fs.readFileSync(f, "utf8");

const failures = [];
const N = EXPECTED_KEYS.length;

// ---- 扫描 app/ lib/ 的断言式闸计数,必 == N ----
const ARABIC = [
  /(\d+)\s*道熔断闸/g,
  /(\d+)\s*个?熔断闸/g,
  /(\d+)\s*功能闸/g,
  /(\d+)\s*大业务闸门/g,
  /(\d+)\s*闸(?:全开|全部在线|矩阵|只读|在线)/g,
  /Kill-?Switch\s*(\d+)\s*闸/g,
];
const KILL_RATIO = /Kill[-\s]?(?:Switch)?\s*(\d+)\s*\/\s*(\d+)/gi; // 在线 X<=N、总数 Y==N
const MELT_RATIO = /(\d+)\s*\/\s*(\d+)\s*熔断/g;                    // 总数 Y==N
const CN_NAMED = /([一二三四五六七八九十]+)\s*个?(?:功能闸|熔断闸)/g;
const CN_BARE = /([一二三四五六七八九十]+)闸(?!门)/g;               // 「五闸/七闸」,排除「闸门」(N 大业务闸门 走 ARABIC)

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".next", ".trash"].includes(e.name)) continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const scanDirs = ["app", "lib"].map((d) => path.join(ROOT, d)).filter(fs.existsSync);
const viol = [];
for (const dir of scanDirs) {
  for (const file of walk(dir)) {
    const src = read(file);
    const rel = path.relative(ROOT, file);
    for (const re of ARABIC) {
      for (const m of src.matchAll(re)) {
        const c = parseInt(m[1], 10);
        if (c !== N) viol.push(`${rel}: "${m[0].trim()}" 计数 ${c} ≠ 功能闸数 ${N}`);
      }
    }
    for (const m of src.matchAll(KILL_RATIO)) {
      const online = parseInt(m[1], 10), total = parseInt(m[2], 10);
      if (total !== N || online > N) viol.push(`${rel}: "${m[0].trim()}" Kill 计数 ${online}/${total} 与功能闸数 ${N} 不符`);
    }
    for (const m of src.matchAll(MELT_RATIO)) {
      const total = parseInt(m[2], 10);
      if (total !== N) viol.push(`${rel}: "${m[0].trim()}" 总闸数 ${total} ≠ ${N}`);
    }
    for (const re of [CN_NAMED, CN_BARE]) {
      for (const m of src.matchAll(re)) {
        const c = CN[m[1]];
        if (c !== undefined && c !== N) viol.push(`${rel}: "${m[0].trim()}"(中文 ${m[1]}=${c})≠ 功能闸数 ${N}`);
      }
    }
  }
}
// ③ CSS 结构:.gates-strip 基准网格列数必 == 功能闸数(防布局按旧闸数硬编码,如 repeat(7);.css 不在上面 .ts/.tsx 扫描内)
function walkCss(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", ".next", ".trash"].includes(e.name)) walkCss(p, out); }
    else if (/\.css$/.test(e.name)) out.push(p);
  }
  return out;
}
for (const dir of scanDirs) {
  for (const file of walkCss(dir)) {
    const reps = [...read(file).matchAll(/gates-strip[^{}]*\{[^}]*repeat\((\d+)\s*,/g)].map((m) => +m[1]);
    if (reps.length && Math.max(...reps) !== N) viol.push(`${path.relative(ROOT, file)}: .gates-strip 基准网格 repeat(${Math.max(...reps)},…) ≠ 功能闸数 ${N}(闸卡条按旧闸数布局)`);
  }
}

failures.push(...viol);

const result = {
  status: failures.length === 0 ? "passed" : "failed",
  functionalGateCount: N,
  expectedKeys: EXPECTED_KEYS,
  scanned: scanDirs.map((d) => path.relative(ROOT, d)),
  failureCount: failures.length,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exit(1);
