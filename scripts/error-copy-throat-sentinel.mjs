#!/usr/bin/env node
/**
 * 错误文案咽喉哨兵(2026-08-06 专项落地)。
 *
 * 防的坑(专项开工时的实测存量):
 *   ① 31 个 client 的 fetch 无网络异常捕获 → 断网时运营屏幕上是英文 "Failed to fetch";
 *   ② 百余处工程机器码沿 `error.message` 直达页面 → 运营看见 `H8_RESPONSE_INVALID:recentSettlements`。
 * 治法:网络层唯一入口 `guardedFetch`,展示层唯一通道 `displayAdminError`(均在 lib/admin/error-messages.ts)。
 *
 * 三道判据(纯文本可判,不含语义判断——白名单越小越强):
 *   A. 客户端侧代码里的裸 `fetch(` = 红。白名单只有下方 BARE_FETCH_ALLOW 两条,每条写清为什么。
 *      why 判据能这么硬:2026-08-06 四路独立验收后裁决 rawFetch 调用点清零,
 *      「catch 依赖网络异常原始形态」的点全仓为零,故无需按语义放行任何调用点。
 *   B. `x instanceof Error ? x.message : "MACHINE_CODE"` 形态 = 红。
 *      这是本专项修掉 30+ 次的缺陷原型:非 Error 时把机器码原样糊上屏,
 *      Error 时把未过咽喉的原文糊上屏。白名单 MARKER_CLASS_ALLOW 只放「喂给自家标记类构造器/数据结构、
 *      最终仍会过展示边界」的点。
 *   C. 裸 `x.message` 直进展示 setter(setToast/setError/toast/…) = 红,无白名单。
 *
 * 🔴 rawFetch 调用点必须为 0(判据 D):它是导出的白名单锚点,一旦有人开始用,
 *    判据 A 的「裸 fetch 清零」就会退化成「看得见的清零」。
 *
 * 红测方式:把任一被治文件改回旧写法(例如给某 client 换回裸 fetch、或把某 setError 换回三元机器码),
 * 本哨兵必须报红;还原用内容恢复,禁 git checkout(会连带冲掉同工作树的其它改动)。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 客户端侧取材面:运营浏览器里跑的代码。app/api/** 是服务端代理(自管超时与 5xx 转译),不在此面。
const SCAN_DIRS = ["lib/admin", "app/components", "app/_console"];
const EXTS = new Set([".ts", ".tsx"]);

/** 判据 A 白名单:允许出现裸 fetch 的位置,每条必须写清为什么不会有英文上屏。 */
const BARE_FETCH_ALLOW = [
  {
    file: "lib/admin/error-messages.ts",
    why: "guardedFetch 自身的实现,它就是那道包装,不能自我包装",
  },
  {
    file: "lib/admin/auth-session.ts",
    why: "登出发完即忘:`.catch(() => undefined)` 吞掉 rejection 后无条件 reload,无任何展示路径",
  },
];

/** 判据 B 白名单:机器码字符串喂给自家标记类/数据结构,不是展示出口(最终仍过 displayAdminError)。 */
const MARKER_CLASS_ALLOW = [
  { file: "lib/admin/a2-client.ts", why: "A2OutcomeUncertainError 构造参数,展示时过咽喉" },
  { file: "lib/admin/k-client.ts", why: "K1OutcomeUncertainError 构造参数与协议校验中间值,展示时过咽喉" },
  { file: "lib/admin/j-client.ts", why: "allSettled 结果结构里的 error 字段,渲染前过咽喉" },
  { file: "app/components/domain-views/c-tabs/c1-search.tsx", why: "只喂 includes 判据,不上屏(出口已过咽喉)" },
  { file: "app/components/domain-views/c-tabs/c4-kyc.tsx", why: "同上" },
  { file: "app/components/domain-views/d-tabs/d5-params.tsx", why: "同上" },
];

const BARE_FETCH_RE = /(^|[^a-zA-Z.$_])fetch\s*\(/;
const MACHINE_CODE_TERNARY_RE = /instanceof\s+Error\s*\?[^:\n]*\.message\s*:\s*"[A-Z][A-Z0-9_]*"/;
const RAW_MESSAGE_DISPLAY_RE =
  /\b(setToast|setError|setSubmitError|setContentError|setLoadError|setA2Error|toast)\(\s*[a-zA-Z_$][\w$]*\.message\b/;
const RAW_FETCH_CALL_RE = /\brawFetch\s*\(/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (EXTS.has(path.extname(entry.name))) out.push(rel);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((dir) => walk(dir));
const violations = [];
let scanned = 0;

for (const rel of files) {
  scanned += 1;
  const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split(/\r?\n/);
  lines.forEach((line, idx) => {
    const at = `${rel}:${idx + 1}`;
    const code = line.replace(/\/\/.*$/, "");
    if (BARE_FETCH_RE.test(code) && !/guardedFetch|rawFetch/.test(code)) {
      if (!BARE_FETCH_ALLOW.some((a) => a.file === rel)) {
        violations.push(`[A 裸 fetch] ${at} —— 网络异常会以英文冒泡上屏,改用 guardedFetch\n    ${line.trim()}`);
      }
    }
    if (MACHINE_CODE_TERNARY_RE.test(code) && !MARKER_CLASS_ALLOW.some((a) => a.file === rel)) {
      violations.push(`[B 机器码兜底] ${at} —— 非 Error 时机器码直接上屏,改用 displayAdminError(x)\n    ${line.trim()}`);
    }
    if (RAW_MESSAGE_DISPLAY_RE.test(code)) {
      violations.push(`[C 裸 message 上屏] ${at} —— 未过展示边界,改用 displayAdminError(x)\n    ${line.trim()}`);
    }
    if (RAW_FETCH_CALL_RE.test(code) && rel !== "lib/admin/error-messages.ts") {
      violations.push(`[D rawFetch 调用] ${at} —— 白名单已清空(见 HANDOFF §3.1),网络层一律 guardedFetch\n    ${line.trim()}`);
    }
  });
}

// 台账失真兜底:白名单条目指向的文件若被删/改名,判据会静默缩小取材面。
for (const entry of [...BARE_FETCH_ALLOW, ...MARKER_CLASS_ALLOW]) {
  if (!fs.existsSync(path.join(ROOT, entry.file))) {
    violations.push(`[台账失真] 白名单条目指向不存在的文件:${entry.file}(${entry.why})——请删掉该条或修正路径`);
  }
}

// 判据失效兜底:取材面为空 = 扫了个寂寞,必须报错而不是全绿。
if (scanned === 0) {
  console.error("error-copy-throat-sentinel: 取材面为空(SCAN_DIRS 是否被改坏?),判据失效");
  process.exit(1);
}

if (violations.length) {
  console.error(`error-copy-throat-sentinel FAIL(扫描 ${scanned} 个文件,命中 ${violations.length} 处):\n`);
  for (const v of violations) console.error(`  ${v}\n`);
  console.error("修法:网络层 guardedFetch(lib/admin/error-messages.ts),展示层 displayAdminError(同文件)。");
  console.error("确属例外的,在本脚本的白名单里补一条并写清为什么不会有英文/机器码上屏。");
  process.exit(1);
}

console.log(
  `error-copy-throat-sentinel PASS —— 扫描 ${scanned} 个客户端文件,` +
    `裸 fetch/机器码兜底/裸 message 上屏/rawFetch 调用 均为 0(白名单 ${BARE_FETCH_ALLOW.length + MARKER_CLASS_ALLOW.length} 条)`,
);
