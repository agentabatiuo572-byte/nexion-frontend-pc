#!/usr/bin/env node
/**
 * H9「对外公布数据」跨仓字段 / 值域 parity 哨兵(规格 FEAT-HOME02b ⑦)。
 *
 * 同一份配置分散在三处,谁都可以单独改,而 tsc 一处都拦不住:
 *   ① 规格表   PRD/specs/FEAT-HOME02-network-pulse-configurable.md ③(合法域权威)
 *   ② 前端类型 Nexion-uniapp/src/store/config-types.ts `PublicStatsConfig`(客户端消费面)
 *   ③ 后台参数 admin-ops/lib/admin/h9-client.ts `H9PublicStatsValues` + `H9_FIELDS`(运营写入面)
 * 前端加一个字段而后台没有对应控制项 = 运营改不了的死配置;后台把值域抄错 = 前端能收到
 * 自己判为非法的值,首页那一格直接退化成占位。两种都是静默的。
 *
 * 另外两处同样静默的坑,一并焊在这里(新增 L2 的位置栈漏一处就是死链):
 *   D. nav 条目 / registry summary / FOLD↔RO_COPY 配对 / 分发分支 / growth 代理白名单
 *      —— 少 FOLD↔RO 的配对会在切 Tab 时解构 undefined 直接白屏,少代理白名单则读写一律 404。
 *   E. 面板用到的 class 在 `.hdom` scope(或 globals)里真有样式 —— 各域 CSS 互相独立,
 *      从别的域抄个 class 名过来选择器根本不命中,tsc / build / 类型都绿,页面却是裸的。
 *   E2. `param-grid` 族:凡 `{x}-tabs` 面板用到 `param-grid` 的域,`{x}-domain.css` 里必须有
 *      主语位 `.{x}dom .param-grid { display: grid }` 基础规则(消费面扫出来的,不手写名单;
 *      @container 变体不算数 —— 基础 display 规则被删时页面就是无栅格堆叠)。
 *      // ponytail: 全部 13 域 × 全部 class 的通用门是独立存量专项(实测 31 面板命中待清),
 *      // 本条只治 P2-18 已确认裸奔的 param-grid 一族,不悄悄扩权。
 *
 * 判据(任一不成立即红):
 *   A. `PublicStatsConfig` 的运营字段与 `H9PublicStatsValues` 键集合**双向**相等；
 *      `realUserCount` 是后端实时安全投影，只读且不属于8项运营配置。
 *   A2. **删除向**:规格 ③ 的每个字段都必须真实存在于后台键集合(A 是两侧互比,两端一起删
 *       它照样相等 —— 锚在规格文件的字段表上,不手抄清单,规格行还在、代码没了就红)。
 *   B. `H9_FIELDS` 的可写项 = 键集合 − 派生锚点 − 分位表(新增字段必须同时长出运营控制项)。
 *   C. `H9_FIELDS` 每项的 min/max 与规格 ③ 表里的 `[a, b]` 逐字段相等。
 *   C2. 分位表**档数**值域随规格:规格「至少 N 档」= `H9_BAND_MIN`;规格没写上限而后台自造一个
 *       (旧 `H9_BAND_MAX = 8`)也红 —— 后台比权威侧更严时,一张合法的表会把整页锁成不可保存。
 *   C3. 分位表**单档 tops 下限**随前端:前端 `network-rank.ts` 判非法的门槛 = `H9_BAND_TOPS_MIN`,
 *       且面板必须真的用共享常量与共享校验(判据打在**剥掉 import 后的用途位**,一行悬空
 *       import 不算接上;行为级等价另由 tests/h9-public-stats-contract.test.mjs 钉死)。
 *   F. **默认(种子)值三处一致**(规格 ⑦):规格 ③「默认」列 ↔ 前端 `mock/platform-config.ts` 种子。
 *      fleetDevices 在种子里是锚常量,故经 `lib/platform-stats.ts` 间接取值——种子里写字面量本身
 *      就是把单源变双源(前端另有 platform_stats_anchor 哨兵守那条)。
 *   G. **前端侧取值域**(规格 ⑦):`PublicStatsConfig` 每个可写标量的文档注释里必须写着合法域
 *      `[a, b]`,且与规格 ③ 逐字段相等。前端的域只存在于注释里,不焊这条就只有后台一侧被守。
 * 另:任一侧解析出 0 个字段即红 —— 空集全过是哨兵最常见的假绿。
 *
 * 用法:node scripts/h9-public-stats-parity.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./lib/strip-comments.mjs";
import { resolveNexionAppRoot, resolveNexionBackendRoot } from "./lib/nexion-workspace-paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = path.join(ROOT, "docs", "PRD", "specs-snapshot-20260807", "FEAT-HOME02-network-pulse-configurable.md");
const APP_ROOT = resolveNexionAppRoot({ adminRoot: ROOT });
const BACKEND_ROOT = resolveNexionBackendRoot({ adminRoot: ROOT });
const UNI_TYPES = path.join(APP_ROOT, "src", "store", "config-types.ts");
const UNI_RANK = path.join(APP_ROOT, "src", "lib", "network-rank.ts");
const BACKEND_MIGRATION = path.join(BACKEND_ROOT, "scripts", "migrations", "20260807_nexion_hard_blockers.sql");
const ADMIN_CLIENT = path.join(ROOT, "lib", "admin", "h9-client.ts");
/** 分位表值域常量与逐行校验的后台单源(零 import 纯模块,契约测试直接加载它)。 */
const ADMIN_RULES = path.join(ROOT, "lib", "admin", "h9-validation.ts");

/** 派生锚点由服务端在改基数时重置,不给运营手填;分位表是表不是标量。 */
const NON_SCALAR = new Set(["registeredUsersAnchorAt", "hashratePercentileTable"]);

const failures = [];

function read(file, label) {
  if (!fs.existsSync(file)) {
    failures.push(`${label} 不存在:${file}(判据失效,不能当通过)`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

/** 取 head 之后的花括号块(计数配对,防被内嵌对象字面量截断)。 */
function braceBody(source, headRe) {
  const head = source.search(headRe);
  if (head < 0) return null;
  const open = source.indexOf("{", head);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

function interfaceBody(source, name) {
  return braceBody(source, new RegExp(`interface\\s+${name}\\s*\\{`));
}

function interfaceKeys(source, name, label) {
  const body = interfaceBody(stripComments(source), name);
  if (body == null) {
    failures.push(`${label}:找不到 interface ${name}(被改名/删了?同步更新本哨兵)`);
    return new Set();
  }
  const keys = new Set();
  for (const match of body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*\??\s*:/gm)) keys.add(match[1]);
  if (keys.size === 0) failures.push(`${label}:${name} 解析出 0 个字段(判据失效)`);
  return keys;
}

// ── 数据源 ───────────────────────────────────────────────────────────────
const uniSource = read(UNI_TYPES, "前端类型文件");
const adminSource = read(ADMIN_CLIENT, "后台 H9 client");
const rulesSource = read(ADMIN_RULES, "后台 H9 值域校验模块");
const specSource = read(SPEC, "FEAT-HOME02 规格");

const uniKeys = uniSource ? interfaceKeys(uniSource, "PublicStatsConfig", "前端") : new Set();
const adminKeys = adminSource ? interfaceKeys(adminSource, "H9PublicStatsValues", "后台") : new Set();
const SERVER_PROJECTION_ONLY = new Set(["realUserCount"]);
// 🔴 常量 / 字段的比对一律用剥掉注释的正文:注释里写「曾经有过 H9_BAND_MAX = 8」不等于代码里还有它。
//    (子串哨兵不剥注释 = 假阳性,同族坑见 feedback_cards_audit_round_lessons)
const adminCode = stripComments(adminSource);
// 分位表常量(H9_BAND_MIN / H9_BAND_TOPS_MIN / H9_BAND_MAX 违禁项)住在校验模块里,单独剥。
const rulesCode = stripComments(rulesSource);

// ── A. 键集合双向相等 ────────────────────────────────────────────────────
for (const key of uniKeys) {
  if (SERVER_PROJECTION_ONLY.has(key)) continue;
  if (!adminKeys.has(key)) failures.push(`A 前端有、后台没有:${key} —— 运营改不到这个配置(死配置)`);
}
for (const key of adminKeys) {
  if (!uniKeys.has(key)) failures.push(`A 后台有、前端没有:${key} —— 后台在配一个客户端不消费的字段`);
}
// A2 的循环在 specRows 解析之后(见下),这里只留坑位说明:A 是两侧互比,对「两端一起删、
// 规格还在」这个形态是盲的 —— 删除向必须锚在规格 ③ 的字段表上反查代码。

// ── B. 可写标量项 = 键集合 − 派生锚点 − 分位表 ───────────────────────────
const fieldKeys = new Set();
for (const match of adminCode.matchAll(/key:\s*"([A-Za-z_$][\w$]*)"/g)) fieldKeys.add(match[1]);
if (adminSource && fieldKeys.size === 0) failures.push("B H9_FIELDS 解析出 0 个可写项(判据失效)");
const expectedScalars = [...adminKeys].filter((key) => !NON_SCALAR.has(key));
for (const key of expectedScalars) {
  if (!fieldKeys.has(key)) failures.push(`B ${key} 在配置里有,但 H9_FIELDS 没给运营控制项`);
}
for (const key of fieldKeys) {
  if (!adminKeys.has(key)) failures.push(`B H9_FIELDS 多出 ${key},配置结构里没有这个字段`);
  else if (NON_SCALAR.has(key)) failures.push(`B ${key} 不该出现在 H9_FIELDS(派生锚点 / 分位表不是标量参数)`);
}

// ── C. 值域与规格 ③ 表逐字段相等 ─────────────────────────────────────────
const specRanges = new Map();
for (const match of specSource.matchAll(/`H\.publicStats\.([\w$]+)`[^\n]*?\[\s*(-?[\d_]+)\s*,\s*(-?[\d_]+)\s*\]/g)) {
  specRanges.set(match[1], [Number(match[2].replace(/_/g, "")), Number(match[3].replace(/_/g, ""))]);
}
if (specSource && specRanges.size === 0) failures.push("C 规格 ③ 表解析出 0 条值域(表结构变了?同步更新本哨兵)");

const adminRanges = new Map();
for (const match of adminCode.matchAll(/key:\s*"([\w$]+)"[\s\S]{0,400}?min:\s*(-?[\d_]+)[\s\S]{0,80}?max:\s*(-?[\d_]+)/g)) {
  adminRanges.set(match[1], [Number(match[2].replace(/_/g, "")), Number(match[3].replace(/_/g, ""))]);
}
for (const key of fieldKeys) {
  const spec = specRanges.get(key);
  const admin = adminRanges.get(key);
  if (!spec) { failures.push(`C 规格 ③ 表里没有 ${key} 的值域 —— 后台在用一个没有权威依据的范围`); continue; }
  if (!admin) { failures.push(`C H9_FIELDS 的 ${key} 解析不到 min/max(判据失效)`); continue; }
  if (spec[0] !== admin[0] || spec[1] !== admin[1]) {
    failures.push(`C ${key} 值域漂移:规格 [${spec[0]}, ${spec[1]}] ≠ 后台 [${admin[0]}, ${admin[1]}]`);
  }
}

// ── C2/C3. 分位表的值域也必须以权威侧为准(C 只管标量,表此前完全没门)───────
// 规格 ③ 逐行拆列:`| 字段 | 类型 | 必填 | 默认 | 生成规则 |`。
const specRows = new Map();
for (const line of specSource.split(/\r?\n/)) {
  const named = line.match(/^\|\s*`H\.publicStats\.([\w$]+)`\s*\|/);
  if (!named) continue;
  const cells = line.split("|").map((cell) => cell.trim());
  specRows.set(named[1], { default: cells[4] ?? "", rule: cells[5] ?? "" });
}
if (specSource && specRows.size === 0) failures.push("C2 规格 ③ 表逐行解析出 0 行(表结构变了?同步更新本哨兵)");

// ── A2. 删除向:规格 ③ 的字段必须在后台代码里真实存在 ────────────────────
// A/C/G 都以代码侧键集合为遍历起点 —— 两端类型一起删,遍历就少一轮,全绿。
// 判据锚在规格文件的字段表(specRows)上反查 adminKeys;前端侧经 A 的双向相等传递闭合。
if (adminKeys.size > 0) {
  for (const key of specRows.keys()) {
    if (!adminKeys.has(key)) {
      failures.push(`A2 规格 ③ 有 ${key},后台 H9PublicStatsValues 里没有 —— 删字段必须连规格 ③ 一起改(两端一起删时 A 看不见,本条看得见)`);
    }
  }
}

const number = (text) => Number(String(text).replace(/_/g, ""));
const bandRule = specRows.get("hashratePercentileTable")?.rule ?? "";
if (specRows.size > 0 && !bandRule) {
  failures.push("C2 规格 ③ 表里没有 hashratePercentileTable 行(判据失效)");
} else if (bandRule) {
  const specBandMin = bandRule.match(/至少\s*(\d+)\s*档/);
  const specBandMax = bandRule.match(/最多\s*(\d+)\s*档/);
  const adminBandMin = rulesCode.match(/H9_BAND_MIN\s*=\s*(\d+)/);
  const adminBandMax = rulesCode.match(/H9_BAND_MAX\s*=\s*(\d+)/);
  if (!specBandMin) failures.push("C2 规格 ③ 的分位表行没写「至少 N 档」(判据失效)");
  else if (!adminBandMin || number(adminBandMin[1]) !== number(specBandMin[1])) {
    failures.push(`C2 分位表档数下限漂移:规格「至少 ${specBandMin[1]} 档」≠ 后台 H9_BAND_MIN=${adminBandMin?.[1] ?? "缺失"}`);
  }
  if (specBandMax && (!adminBandMax || number(adminBandMax[1]) !== number(specBandMax[1]))) {
    failures.push(`C2 规格写了「最多 ${specBandMax[1]} 档」,后台没有等值的上限常量 —— 运营能存下前端判非法的表`);
  }
  if (!specBandMax && adminBandMax) {
    failures.push(`C2 后台自造分位表档数上限 H9_BAND_MAX=${adminBandMax[1]},规格 ③ 没有这条`
      + " —— 后台比权威侧更严,一张合法的表会把整页锁成不可保存");
  }
}

const rankSource = read(UNI_RANK, "前端分位表校验 network-rank");
const uniTopsFloor = rankSource.match(/band\.tops\s*<\s*(-?[\d_]+)/);
const adminTopsFloor = rulesCode.match(/H9_BAND_TOPS_MIN\s*=\s*(-?[\d_]+)/);
if (rankSource && !uniTopsFloor) failures.push("C3 前端 network-rank 解析不到 tops 下限判据(判据失效)");
else if (uniTopsFloor && !adminTopsFloor) {
  failures.push("C3 后台没有 H9_BAND_TOPS_MIN:分位表 tops 下限无单源,面板会自己写一个(旧版写的是 tops > 0)");
} else if (uniTopsFloor && adminTopsFloor && number(uniTopsFloor[1]) !== number(adminTopsFloor[1])) {
  failures.push(`C3 分位表 tops 下限漂移:前端判非法的门槛 ${number(uniTopsFloor[1])} ≠ 后台 H9_BAND_TOPS_MIN=${number(adminTopsFloor[1])}`);
}

// ── D. 模块位置栈接线(新增 L2 漏一处就是死链)───────────────────────────
const VIEW = path.join(ROOT, "app", "components", "domain-views", "h-view.tsx");
const CSS = path.join(ROOT, "app", "components", "domain-views", "h-domain.css");
const PANEL = path.join(ROOT, "app", "components", "domain-views", "h-tabs", "h9-public-stats.tsx");
const navSource = read(path.join(ROOT, "lib", "nav", "console-nav.ts"), "IA 单源 console-nav");
const registrySource = read(path.join(ROOT, "lib", "admin", "registry", "h.ts"), "H 域 registry");
const viewSource = read(VIEW, "h-view");
const cssSource = read(CSS, "h-domain.css");
const panelSource = read(PANEL, "H9 面板");
const proxySource = read(path.join(ROOT, "app", "api", "admin", "growth", "[...path]", "route.ts"), "growth 代理路由");

const H9_PATH = "/growth/public-stats";
if (navSource && !new RegExp(`id:\\s*"H9"[^\\n]*path:\\s*"${H9_PATH}"`).test(navSource)) {
  failures.push(`D console-nav 没有 H9 → ${H9_PATH} 的 L2 条目(侧边栏 / 路由解析 / 面包屑全都到不了)`);
}
if (registrySource && !registrySource.includes(`"${H9_PATH}"`)) {
  failures.push(`D registry/h.ts 缺 ${H9_PATH} 的 summary(页头口径副标会是空的)`);
}
// FOLD 每个值都必须在 RO 表里有键 —— 少一个,切到那个 Tab 就是解构 undefined 直接白屏。
const foldBlock = viewSource.match(/const FOLD[^=]*=\s*\{([^}]*)\}/);
const roBlock = viewSource.match(/const RO_COPY[^=]*=\s*\{([\s\S]*?)\n\};/);
if (!foldBlock || !roBlock) failures.push("D h-view.tsx 的 FOLD / RO_COPY 表解析不到(结构变了?同步更新本哨兵)");
else {
  const foldValues = [...new Set([...foldBlock[1].matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]))];
  const roKeys = [...roBlock[1].matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
  if (foldValues.length === 0) failures.push("D FOLD 解析出 0 个 Tab(判据失效)");
  for (const tab of foldValues) {
    if (!roKeys.includes(tab)) failures.push(`D FOLD 有 ${tab} 但 RO_COPY 没有对应键 —— 切到该 Tab 会解构 undefined(白屏)`);
  }
  if (!foldValues.includes("H9")) failures.push("D FOLD 里没有 H9(路由能进,页面会回落到 H1)");
}
if (viewSource && !/\{tab === "H9" && <H9PublicStats/.test(viewSource)) {
  failures.push("D h-view.tsx 没有 H9 的分发分支(Tab 命中却渲染不出东西)");
}
if (proxySource && !proxySource.includes('"public-stats"')) {
  failures.push("D growth 代理路由的白名单没有 public-stats —— 读写一律 404");
}
// C3 接线:常量对不对、有没有被面板真用上,是两道门(常量成摆设 = 面板照旧自己写一个判据)。
// 🔴 判据打在**剥掉 import 语句之后**的正文:一行悬空 import 会让 `includes(名字)` 恒真,
//    把两处真实用途全换成字面量它照样绿(红测 RT21 的原形)。用途位 = import 之外至少出现一次。
// 🔴 还要剥注释(2026-08-06 独立证伪 T2b):`{error}{/* h9PlaceholderCopy(error) */}` ——
//    真实用途已绕开、JSX 注释残留 needle,不剥就假绿。同文件 :120 对常量早剥了,
//    这里当时漏了 —— 同一脚本内纪律必须一致,四条 needle 全部同病。
const panelUsage = stripComments(panelSource)
  .replace(/^import[\s\S]*?from\s*"[^"]*";\s*$/gm, "")
  .replace(/^import\s*"[^"]*";\s*$/gm, "");
const PANEL_WIRING = [
  ["H9_BAND_TOPS_MIN", "分位表 tops 下限又变成面板里手写的一条(P2-14 的原形)"],
  ["H9_BAND_MIN", "档数下限又变成面板里手写的一条(与 C2 的单源断开)"],
  ["h9BandRowErrors(", "分位表逐行校验没走共享模块,面板在自己写第二套判据(等价契约测试只测得到共享那套)"],
  ["h9PlaceholderCopy(", "占位卡文案没走统一拼接,双句号(P2-15)会原样回归"],
];
for (const [needle, why] of PANEL_WIRING) {
  if (panelSource && !panelUsage.includes(needle)) {
    failures.push(`C3 面板的用途位(import 之外)没有 ${needle.replace(/\($/, "")} —— ${why}`);
  }
}

// ── E. H9 面板用到的 class 必须在 H 域 scope 里真有样式 ────────────────────
// 各域 CSS 互相独立:抄别的域的 class 名过来,选择器根本不命中,页面只是「没样式」——
// tsc / build / 截图之外的任何静态检查都看不出来。
const classTokens = new Set();
for (const match of panelSource.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
  const literal = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]*\}/g, " ");
  for (const token of literal.split(/\s+/)) if (token) classTokens.add(token);
  // 模板串三元分支里的字面量(如 `num${cond ? "" : " chg"}`)
  if (match[2]) for (const quoted of match[0].matchAll(/"([a-z0-9 _-]*)"/g)) {
    for (const token of quoted[1].split(/\s+/)) if (token) classTokens.add(token);
  }
}
if (panelSource && classTokens.size === 0) failures.push("E H9 面板解析出 0 个 class(判据失效)");
const globalsSource = read(path.join(ROOT, "app", "globals.css"), "globals.css");
// 🔴 剥注释再比对:注释里提到 `.l-inp` 不等于页面上真有这条规则,不剥就是子串假绿。
const stripCss = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const hdomCss = stripCss(cssSource);
const globalsCss = stripCss(globalsSource);
for (const token of classTokens) {
  const selector = new RegExp(`\\.${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);
  if (!selector.test(hdomCss) && !selector.test(globalsCss)) {
    failures.push(`E class "${token}" 在 .hdom scope 与 globals 里都没有样式 —— 页面上这块是裸的`);
  }
}

// ── E2. param-grid 族:消费面扫出来的域,基础 grid 规则必须在(P2-18 的两条不再裸奔)──
// 判据 = 主语位 `.{x}dom .param-grid { ... display: grid ... }`:@container 里只改列数的变体
// 不算数 —— 基础 display 规则被删,参数卡当场退化成无栅格堆叠,而 tsc / build 全绿。
const TABS_ROOT = path.join(ROOT, "app", "components", "domain-views");
const paramGridDomains = new Set();
for (const dirent of fs.readdirSync(TABS_ROOT, { withFileTypes: true })) {
  if (!dirent.isDirectory() || !/^([a-m])-tabs$/.test(dirent.name)) continue;
  const domain = dirent.name[0];
  for (const file of fs.readdirSync(path.join(TABS_ROOT, dirent.name))) {
    if (!file.endsWith(".tsx")) continue;
    const src = fs.readFileSync(path.join(TABS_ROOT, dirent.name, file), "utf8");
    if (/className=(?:"[^"]*\bparam-grid\b|\{`[^`]*\bparam-grid\b)/.test(src)) paramGridDomains.add(domain);
  }
}
if (paramGridDomains.size === 0) {
  failures.push("E2 全部 {x}-tabs 里扫不到任何 param-grid 消费者(K2/L5/G4/H8 存量在此,0 命中 = 判据失效)");
}
for (const domain of [...paramGridDomains].sort()) {
  const cssFile = path.join(TABS_ROOT, `${domain}-domain.css`);
  const domainCss = fs.existsSync(cssFile) ? stripCss(fs.readFileSync(cssFile, "utf8")) : "";
  const baseRule = new RegExp(`\\.${domain}dom\\s+\\.param-grid(?![\\w-])[^{}]*\\{[^}]*display\\s*:\\s*grid`);
  if (!baseRule.test(domainCss) && !/\.param-grid(?![\w-])[^{}]*\{[^}]*display\s*:\s*grid/.test(globalsCss)) {
    failures.push(`E2 ${domain}-tabs 面板在用 param-grid,但 ${domain}-domain.css 没有主语位 .${domain}dom .param-grid 的 display: grid 基础规则 —— 参数卡是无栅格堆叠`);
  }
}

// ── F. 默认值:规格 ③「默认」列 ↔ 服务端增量迁移 ─────────────────────────
// 用户端已按本轮真实接口要求删除 H9 种子与硬编码回退；默认值的唯一运行时来源是服务端。
const migrationSource = read(BACKEND_MIGRATION, "后端 H9 增量迁移");
const aggregateMatch = migrationSource.match(/growth\.public_stats\.values',\s*'([^']+)'/);
let serverDefaults = null;
try { serverDefaults = aggregateMatch ? JSON.parse(aggregateMatch[1]) : null; } catch { /* below reports invalid source */ }
if (migrationSource && !serverDefaults) failures.push("F 后端迁移里解析不到 growth.public_stats.values 默认聚合");

if (serverDefaults != null) {
  let compared = 0;
  for (const [key, row] of specRows) {
    if (key === "hashratePercentileTable") {
      // 「10 档种子」或「4–5 档种子」——默认列给档数(单值或区间),比种子表的档数落不落在里面。
      // 2026-08-05 扩档后规格写的是单值 10(算力口径组把种子从 4 档扩到 10 档,规格默认列同步)。
      const range = row.default.match(/(\d+)(?:\s*[–—~-]\s*(\d+))?\s*档/);
      const seedBands = Array.isArray(serverDefaults.hashratePercentileTable) ? serverDefaults.hashratePercentileTable.length : 0;
      if (!range) { failures.push("F 规格 ③ 分位表默认列解析不到「N 档种子 / N–M 档种子」(判据失效)"); continue; }
      const lo = number(range[1]);
      const hi = range[2] === undefined ? lo : number(range[2]);
      compared += 1;
      if (seedBands < lo || seedBands > hi) {
        failures.push(`F 分位表种子档数漂移:规格「${lo === hi ? lo : `${lo}–${hi}`} 档种子」≠ 服务端默认 ${seedBands} 档`);
      }
      continue;
    }
    const specDefault = number((row.default.match(/-?[\d_]+(?:\.\d+)?/) ?? [])[0]);
    if (!Number.isFinite(specDefault)) { failures.push(`F 规格 ③ 的 ${key} 默认列解析不到数字(原文「${row.default}」,判据失效)`); continue; }
    const seed = Number(serverDefaults[key]);
    if (!Number.isFinite(seed)) {
      failures.push(`F 服务端默认聚合里取不到 ${key}`);
      continue;
    }
    compared += 1;
    if (seed !== specDefault) failures.push(`F ${key} 默认值漂移:规格 ③ ${specDefault} ≠ 服务端默认 ${seed}`);
  }
  if (compared === 0) failures.push("F 一个默认值都没比到(判据失效)");
}

// ── G. 前端侧取值域(只存在于 PublicStatsConfig 的注释里)↔ 规格 ③ ────────
// C 只守住了后台一侧:前端把注释里的合法域改宽,门照绿,而那正是「前端能收到自己判非法的值」的另一半。
const uniDocs = new Map();
for (const matched of (interfaceBody(uniSource, "PublicStatsConfig") ?? "").matchAll(/\/\*\*([\s\S]*?)\*\/\s*([A-Za-z_$][\w$]*)\s*\??\s*:/g)) {
  uniDocs.set(matched[2], matched[1]);
}
if (uniSource && uniDocs.size === 0) failures.push("G 前端 PublicStatsConfig 解析出 0 条字段注释(判据失效)");
for (const key of fieldKeys) {
  const spec = specRanges.get(key);
  if (!spec || uniDocs.size === 0) continue; // 规格缺值域已在 C 报过,不重复刷屏
  const doc = uniDocs.get(key);
  if (doc == null) { failures.push(`G 前端 PublicStatsConfig 的 ${key} 没有文档注释 —— 前端侧合法域无处可比`); continue; }
  const ranges = [...doc.matchAll(/\[\s*(-?[\d_]+)\s*,\s*(-?[\d_]+)\s*\]/g)];
  if (ranges.length === 0) { failures.push(`G 前端 ${key} 的注释里没写合法域 [a, b] —— 客户端消费面的域没有落到字面上`); continue; }
  const last = ranges[ranges.length - 1];
  if (number(last[1]) !== spec[0] || number(last[2]) !== spec[1]) {
    failures.push(`G ${key} 前端合法域漂移:规格 ③ [${spec[0]}, ${spec[1]}] ≠ 前端注释 [${number(last[1])}, ${number(last[2])}]`);
  }
}

// ── 结论 ─────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`✗ H9 对外公布数据 parity FAIL — ${failures.length} 项:`);
  for (const line of failures) console.error(`  ✗ ${line}`);
  process.exit(1);
}
console.log(
  `✓ H9 对外公布数据 — 前端/后台字段 ${adminKeys.size} 键双向相等 · 规格 ③ ${specRows.size} 字段在代码两侧均存在(删除向)· `
  + `运营控制项 ${fieldKeys.size} 个全覆盖 · 值域与规格 ③ 逐字段相等(后台 ${specRanges.size} 条 + 前端注释 ${uniDocs.size} 字段)· `
  + `分位表档数与 tops 下限随权威侧 · 共享校验/常量在面板用途位接线 ${PANEL_WIRING.length} 处 · `
  + `默认种子与规格 ③ 逐键相等(${specRows.size} 行)· 位置栈接线齐(nav/registry/FOLD↔RO/分支/代理白名单)· `
  + `面板 ${classTokens.size} 个 class 在 .hdom 均有样式 · param-grid 基础规则覆盖 ${paramGridDomains.size} 个消费域`,
);
