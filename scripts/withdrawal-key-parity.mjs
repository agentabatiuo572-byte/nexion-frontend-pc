#!/usr/bin/env node
/**
 * 提现单主键字段名 parity 门 —— 线上真名只有一个,PRD 不许把它漂回旧名。
 *
 * why(2026-08-11):后台 PRD 把提现单主键写成 `withdrawalId`,而 admin 实现一直是
 * `withdrawalNo`,错了很久没人发现。当轮手工改完 18 处,但**没有任何机器判据锁住它** ——
 * 下一个写新章节的人,或者把刻意保留的例外当笔误"修正"的人,都会让它静默漂回去。
 *
 * 🔴 判据是**构造性**的,不是黑名单:
 *   真名从 admin 实现里抠出来(唯一权威),PRD 里凡是主键那一族的名字,都必须落进
 *   「主键真名 / 批量入参真名 / conflicts 成员真名 / 明确的否定式说明」四类之一,否则红。
 *   ——不是「禁止出现 withdrawalId」。新变体(withdrawalNos、withdrawalNo 复数化…)
 *   不用补正则就会被抓,而例外靠**结构特征**(批量端点上下文 / conflicts 上下文 /
 *   否定词窗口)识别,不硬编码行号。
 *
 * 🔴 扫描面是**整棵权威 PC PRD 树**,不是三份点名的文档:消费面是开放集合,只锁点名的
 *   那几份必复发。
 *
 * 用法:node scripts/withdrawal-key-parity.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNexionPrdRoot } from "./lib/nexion-workspace-paths.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = path.resolve(HERE, "..");
// 红测通过显式环境变量把实现真源切到一次性临时副本；默认执行仍只读正式实现。
const D_CLIENT = path.resolve(
  process.env.NEXION_D2_CLIENT_PATH?.trim()
    || path.join(ADMIN_ROOT, "lib", "admin", "d-client.ts"),
);

let PRD_ROOT;
try {
  PRD_ROOT = resolveNexionPrdRoot({ adminRoot: ADMIN_ROOT });
} catch (e) {
  // 缺工作区文档面 = 判据无法执行。verify 用这句话的特征把本齿标成 SKIPPED 并继续
  //(不是放宽:跳过会进收尾台账,且退出码非零 —— 单跑时它就是失败)。
  console.error(`❌ ${e.message}`);
  process.exit(1);
}

const fail = [];
const client = fs.readFileSync(D_CLIENT, "utf8");

/** 从 TS interface 抠字段名(照抄 PRD/specs/wd01-contract-parity.mjs 的同名函数)。 */
function interfaceFields(src, name) {
  const m = src.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`未找到 interface ${name} —— d-client 结构变了,本门判据失效`);
  return m[1].split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"))
    .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/))
    .filter(Boolean).map((m2) => m2[1]);
}

/** 规格里某节的正文(到下一个同级或更高级标题为止)。同上,照抄参照实现。 */
function section(md, heading) {
  const i = md.indexOf(heading);
  if (i < 0) throw new Error(`规格里未找到小节「${heading}」`);
  const rest = md.slice(i + heading.length);
  const next = rest.search(/\n#{2,4} /);
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * 该节里有没有**以 name 起头的表格行**。
 * 🔴 不能用 `includes`:散文里顺嘴提一句就会让它假绿(参照实现的红测实测记录)。
 */
function hasRow(sec, name) {
  return new RegExp(`^\\|\\s*\`?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\`?\\s*\\|`, "m").test(sec);
}

// ── 单一真理源:三个线上真名全部从 admin 实现里派生,不在这里写死 ──────────────
//
// 🔴 主键不能靠「名字长得像」去猜:D2Withdrawal 里 `withdrawal*` 开头的字段有好几个
//   (withdrawalCount24h / withdrawalHistory),挑名字必然挑错(写这道门时第一版就栽在这)。
//   改用主键的**定义性质**:线上用哪个值寻址单笔,哪个就是主键 —— 即单笔详情端点的路径参数。
const detailFn = client.match(
  /export async function fetchD2WithdrawalDetail\((\w+):\s*string\)[\s\S]{0,240}?`\/withdrawals\/\$\{encodeURIComponent\((\w+)\)\}`/,
);
const KEY = detailFn && detailFn[1] === detailFn[2] ? detailFn[1] : null;
const d2Fields = interfaceFields(client, "D2Withdrawal");
const batchSig = client.match(/export async function reviewD2WithdrawalsBatch\(([\s\S]*?)\)\s*\{/);
const BATCH_PARAM = batchSig?.[1].match(/(withdrawal[A-Za-z0-9]*)\s*:\s*string\[\]/)?.[1];
const CONFLICT_MEMBER = client.match(/conflicts:\s*Array<\{\s*(withdrawal[A-Za-z0-9]*)\s*:/)?.[1];

// ── 已知答案探针:判据本身得先能用,抠不出东西就直接作废,不许往下报绿 ──────────
// 主键还要在 D2Withdrawal 里真有这个字段 —— 两条独立性质(寻址用它 + 载荷带它)同时成立,
// 才算抠对了;只改其中一处(比如只把 interface 字段改名)也会在这里红。
if (d2Fields.length < 10 || !KEY || !d2Fields.includes(KEY) || !BATCH_PARAM || !CONFLICT_MEMBER) {
  console.error("❌ 探针失效:没能从 d-client.ts 抠出三个真名,以下结论作废");
  console.error(`   单笔寻址参数 ${KEY} / D2Withdrawal ${d2Fields.length} 字段(含该参数:${d2Fields.includes(KEY)})`
    + ` / 批量入参 ${BATCH_PARAM} / conflicts 成员 ${CONFLICT_MEMBER}`);
  process.exit(1);
}

/**
 * 主键族 = 三个真名的后缀 + 各自的单复数近似拼写。
 * 这样 `withdrawalNos`(把批量入参"改正"成主键复数)这类新变体不用补正则就会落进扫描面,
 * 而 `withdrawalIntentId` / `withdrawalEvaluationFactsHash` 这些**别的字段**不会被误伤。
 */
const variants = new Set();
for (const n of [KEY, BATCH_PARAM, CONFLICT_MEMBER]) {
  const s = n.slice("withdrawal".length);
  variants.add(s);
  variants.add(s.endsWith("s") ? s.slice(0, -1) : `${s}s`);
}
const TOKEN = new RegExp(`withdrawal(?:${[...variants].sort((a, b) => b.length - a.length).join("|")})\\b`, "g");

// ── 分类器:每个 token 必须落进四类之一,否则就是"指代主键却没用真名" ──────────
const NEGATION = ["不是", "而非", "不随", "不叫", "旧名", "已更正", "错的", "写错", "≠", "↔"];
const WINDOW = 28;

/** @returns {"key"|"batch"|"conflict"|"note"|null} null = 不合格 */
function classify(line, token, idx) {
  if (token === KEY) return "key";
  const before = line.slice(Math.max(0, idx - WINDOW), idx);
  const after = line.slice(idx + token.length, idx + token.length + WINDOW);
  // 批量端点入参:结构特征 = 这一行在讲批量端点
  if (token === BATCH_PARAM && (line.includes("/batch") || line.includes("批量"))) return "batch";
  // conflicts 回传项成员:结构特征 = 紧邻上文就是 conflicts 容器
  if (token === CONFLICT_MEMBER && before.includes("conflicts")) return "conflict";
  // 明确的否定式说明("不是 X" / "发 X 而非 Y" / "X↔Y" / "写的 X 是错的")。
  // 🔴 光有否定词不够,同一行还必须点出真名:否则「`withdrawalId` 不是可选字段」这种
  //   跟命名无关的否定句会白白开一个口子,真漂移从那儿溜过去。全仓现有的说明句无一例外
  //   都是"不是 A,是 B"的形状,所以这条只收紧不误伤。
  if (line.includes(KEY) && NEGATION.some((n) => before.includes(n) || after.includes(n))) return "note";
  return null;
}

// 分类器探针:光证明"文件在"不算数,判据得真有判别力 —— 合法行必须放行,漂移行必须抓住。
const probeGood = classify(`| \`${KEY}\` | string | 单笔主键 |`, KEY, 3);
const probeBad = classify(`| \`${CONFLICT_MEMBER}\` | string | 是 | 服务端生成 |`, CONFLICT_MEMBER, 3);
if (probeGood !== "key" || probeBad !== null) {
  console.error(`❌ 分类器探针失效(合法行判成 ${probeGood} / 漂移行判成 ${probeBad}),以下结论作废`);
  process.exit(1);
}

/**
 * 两个合法例外的**逐处**校验(不是"放行区",是"必须正好是这个名字")。
 * 🔴 只靠 token 分类不够:把 `conflicts[].withdrawalId` 改成 `conflicts[].withdrawalNo`,
 *   token 变成主键真名就被放行了 —— 而它恰恰是错的(那是批量端点自有真名)。所以这两个
 *   形状单独按**结构**抓出来逐个比对,名字同样派生自 d-client.ts。
 */
const CONFLICT_SHAPE = /conflicts\[\]\.([A-Za-z0-9_]+)/g;
const ARRAY_PARAM_SHAPE = /(withdrawal[A-Za-z0-9]*)\s*:\s*\[\s*\]/g;

/**
 * 一棵文档树里的所有 .md。
 * 排除 `_bak*` 备份、点目录、以及 **snapshot 目录** —— 快照是按定义冻结的(h9 那道门就靠它
 * 不变),把它一起锁住等于要求"修改一份不许修改的东西"。
 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name.startsWith("_bak") || e.name === "node_modules") continue;
    if (e.isDirectory() && /snapshot/i.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/**
 * 默认权威面就是本仓 docs/PRD。只有显式 NEXION_PRD_ROOT 指向另一棵 PRD 时，才把
 * 本仓 docs/PRD 当第二张镜像一起扫描；相同物理目录绝不能重复计数。
 */
const DOCS_ROOT = process.env.NEXION_ADMIN_DOCS_ROOT?.trim() || path.join(ADMIN_ROOT, "docs");
const DOCS_PRD_ROOT = path.join(DOCS_ROOT, "PRD");
const samePath = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const FACES = [
  { label: "权威 PC PRD", dir: PRD_ROOT },
  ...(samePath(PRD_ROOT, DOCS_PRD_ROOT) ? [] : [{ label: "admin 仓镜像", dir: DOCS_PRD_ROOT }]),
];

// ── 基数台账:门集体对「删除」向是盲的,所以主键点数量单独设地板 ────────────────
// 地板取当前权威 PC PRD 的裁决基线(合计 19 = 15+2+2),不追平当前实测值:实测只会
// 越写越多,地板管的是"只减不增的那一侧"。真要下调必须改这里 —— 那就是一次显式决定。
const KEY_FLOOR = [
  ["Nexion_运营控制后台PRD_v1.md", 15],
  ["Nexion_运营后台_交互与确认机制改写SPEC.md", 2],
  ["Nexion_运营控制后台_开发落地规格.md", 2],
];

const files = FACES.flatMap(({ label, dir }) => walk(dir).map((abs) => ({ abs, label, dir })));
const tally = { key: 0, batch: 0, conflict: 0, note: 0 };
const perFileKey = new Map();
const perFace = new Map(FACES.map((f) => [f.label, 0]));
// 两个例外的声明**每张面各自**都要有:镜像丢了它,下次拿镜像当底稿同步回去就把例外带走了
//(红测实测:只按总数判时,删掉工作区那份,镜像那份会把门顶绿)。
const conflictShapes = new Map(FACES.map((f) => [f.label, 0]));
const arrayShapes = new Map(FACES.map((f) => [f.label, 0]));
let hitFiles = 0, tokens = 0;

for (const { abs, label, dir } of files) {
  perFace.set(label, perFace.get(label) + 1);
  const rel = `${label}:${path.relative(dir, abs).replace(/\\/g, "/")}`;
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  let fileTokens = 0, fileKey = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    TOKEN.lastIndex = 0;
    let m;
    while ((m = TOKEN.exec(line)) !== null) {
      fileTokens += 1;
      tokens += 1;
      const verdict = classify(line, m[0], m.index);
      if (verdict) {
        tally[verdict] += 1;
        if (verdict === "key") fileKey += 1;
        continue;
      }
      fail.push(`${rel}:${i + 1} 用 \`${m[0]}\` 指代提现单主键,线上真名是 \`${KEY}\``
        + `(要保留旧名请写成否定式说明,或落进批量端点 / conflicts 结构)`);
    }
    CONFLICT_SHAPE.lastIndex = 0;
    while ((m = CONFLICT_SHAPE.exec(line)) !== null) {
      conflictShapes.set(label, conflictShapes.get(label) + 1);
      if (m[1] !== CONFLICT_MEMBER) {
        fail.push(`${rel}:${i + 1} 冲突回传项写成 \`conflicts[].${m[1]}\`,实现真名是 \`${CONFLICT_MEMBER}\``);
      }
    }
    ARRAY_PARAM_SHAPE.lastIndex = 0;
    while ((m = ARRAY_PARAM_SHAPE.exec(line)) !== null) {
      arrayShapes.set(label, arrayShapes.get(label) + 1);
      if (m[1] !== BATCH_PARAM) {
        fail.push(`${rel}:${i + 1} 批量入参数组写成 \`${m[1]}:[]\`,实现真名是 \`${BATCH_PARAM}\``);
      }
    }
  }
  if (fileTokens > 0) hitFiles += 1;
  perFileKey.set(`${label}:${path.relative(dir, abs).replace(/\\/g, "/")}`, fileKey);
}

// ── 禁空集假绿:扫不到东西一律不许当通过 ──────────────────────────────────────
for (const [label, n] of perFace) if (n === 0) fail.push(`「${label}」这张消费面一份 .md 都没扫到 —— 判据失效`);
if (tokens === 0) fail.push("整棵 PRD 树里一个主键族 token 都没命中 —— 判据失效,不是通过");
if (tally.key === 0) fail.push(`一处 \`${KEY}\` 都没有 —— 主键真名在文档里已彻底消失`);

// ── 基数地板:删掉主键行时,只有它会响 ────────────────────────────────────────
for (const { label } of FACES) {
  for (const [name, floor] of KEY_FLOOR) {
    const hits = perFileKey.get(`${label}:${name}`);
    if (hits === undefined) fail.push(`${label} 基数台账里的 ${name} 不存在 —— 改名/搬走了就同步改台账`);
    else if (hits < floor) fail.push(`${label}:${name} 的 \`${KEY}\` 只剩 ${hits} 处,低于台账基数 ${floor} —— 有主键行被删了`);
  }
}

// ── 两个合法例外必须仍然在场:整段删掉 = 悄悄撤销"它们不是笔误"这条结论 ─────────
for (const label of perFace.keys()) {
  if (conflictShapes.get(label) === 0) fail.push(`「${label}」里没有 \`conflicts[].${CONFLICT_MEMBER}\` —— 冲突回传项真名的声明被删了`);
  if (arrayShapes.get(label) === 0) fail.push(`「${label}」里没有 \`${BATCH_PARAM}:[]\` —— 批量入参真名的声明被删了`);
}

// ── 结构锚:主键宣告删了就等于把这次决议撤销。按内容找,不按行号 ───────────────────
//
// 🔴 判据是**邻近**不是"同一行":后台 PRD 有 612 字符的表格行,三个词在同一行里各据一方
//   也算命中 —— 红测实测把宣告那句整个改掉,门照样绿(同一行另一处「单笔主键」把它顶了)。
//   宣告是一句话,就按一句话的距离量。
const near = (hay, needle, at, span) => hay.slice(Math.max(0, at - span), at + span).includes(needle);
for (const { label, dir } of FACES) {
  const file = path.join(dir, "Nexion_运营控制后台PRD_v1.md");
  if (!fs.existsSync(file)) { fail.push(`${label} 的后台 PRD 不在(${file})—— 判据失效`); continue; }
  const src = fs.readFileSync(file, "utf8");
  let declared = false;
  for (let at = src.indexOf("单笔主键"); at >= 0; at = src.indexOf("单笔主键", at + 1)) {
    if (near(src, KEY, at, 160) && near(src, "d-client.ts", at, 240)) { declared = true; break; }
  }
  if (!declared) {
    fail.push(`${label} 的后台 PRD 里找不到主键宣告行(须邻近写明「单笔主键」+ \`${KEY}\` + \`d-client.ts\`)`);
  }
}

// ── 收尾:PASS 必须打实测样本量,0 样本报绿等于判据静默跳过 ────────────────────
if (fail.length) {
  console.log("❌ 提现单主键 parity 不通过:\n" + fail.map((f) => "  · " + f).join("\n"));
  process.exit(1);
}
console.log(`✅ 提现单主键 parity 通过 —— 线上真名 \`${KEY}\``
  + `(批量入参 \`${BATCH_PARAM}\` / 冲突项 \`conflicts[].${CONFLICT_MEMBER}\`,三名均派生自 d-client.ts)`);
console.log(`   扫描 ${files.length} 份文档(${[...perFace].map(([l, n]) => `${l} ${n}`).join(" + ")}),`
  + `其中 ${hitFiles} 份命中主键族,共 ${tokens} 处:`
  + ` 主键点 ${tally.key} · 批量入参 ${tally.batch} · conflicts 成员 ${tally.conflict} · 否定式说明 ${tally.note}`);
console.log(`   合法例外逐处核对(每张面各自须有):`
  + [...perFace.keys()].map((l) => `${l} conflicts ${conflictShapes.get(l)} / 数组入参 ${arrayShapes.get(l)}`).join(" · "));
console.log(`   基数台账:${FACES.flatMap(({ label }) => KEY_FLOOR.map(([n, f]) => `${label}:${n.replace(/\.md$/, "")} ${perFileKey.get(`${label}:${n}`)}/${f}`)).join(" · ")}`);
