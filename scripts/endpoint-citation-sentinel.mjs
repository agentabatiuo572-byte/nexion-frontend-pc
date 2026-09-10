#!/usr/bin/env node
/**
 * endpoint-citation-sentinel — 注释里的接口地址必须在台账里有据。
 *
 * 缺陷族(2026-08-04 R4):`lib/mock/admin/compute-config.ts` 全仓零引用,却带 4 段
 * PROD 注释指向 `/api/admin/config/compute-share/*` 这类**根本不存在**的接口(实际
 * 实现是 `/api/admin/devices/compute-config`)。tsc / verify 全绿也抓不到 —— 注释
 * 不参与编译,死代码更没人读。
 *
 * 判据:扫全部**注释行**里的 `/api/...` 引用,逐条对下面的 LEDGER 比对。
 *   - 代码里出现、台账里没有  → RED(新接口没登记,或是笔误 / 虚构)
 *   - 台账里有、代码里没出现  → RED(台账过期,防止台账变成只增不减的垃圾场)
 *   - 一条都没扫到            → RED(判据本身失效,空集全过是哨兵最常见的假绿)
 *
 * 本仓的**权威不是前端 PRD**,而是真实存在的 Next route handler(`app/api/**`)
 * 与后台 PRD;LEDGER 每条注明 "route: <文件>" 或 "TBD: <原因>"。
 * 台账**写在本文件里**,不写在被查文件里 —— 否则改注释的同时改台账,门等于没有。
 *
 * 用法:node scripts/endpoint-citation-sentinel.mjs [--dump]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app", "lib", "components"];
const EXT = new Set([".ts", ".tsx", ".js", ".mjs"]);
const SKIP_DIR = new Set(["node_modules", ".git", ".trash", ".next", "dist", "build", ".playwright-mcp"]);

/** normalized citation → 出处 */
const LEDGER = {
  "GET /api/admin/content/conversations/stream":
    "route: app/api/admin/content/conversations/stream/route.ts(自描述,SSE 透传)",
  "GET /api/admin/devices/compute-config":
    "route: app/api/admin/devices/[...path]/route.ts(isComputeConfig 分支)",
  "PATCH /api/admin/devices/compute-config/params/{paramKey}":
    "route: app/api/admin/devices/[...path]/route.ts(isComputeConfigParam 分支)",
  "/api/admin/growth/*": "route: app/api/admin/growth/[...path]/route.ts(H 域族引用,非单一 endpoint)",
  "/api/admin/growth": "route: app/api/admin/growth/[...path]/route.ts(错误字典注释指认 GROWTH_* 机器码的铸码处,域前缀)",
  "/api/admin/growth/public-stats":
    "route: app/api/admin/growth/[...path]/route.ts(public-stats 已在白名单;上游 nexion-backend 是否已实现该端点未核实 —— h9-client.ts 头注释的 A/B 待决即此事)",
  "/api/admin/risk/*": "route: app/api/admin/risk/[...path]/route.ts(K 域族引用,非单一 endpoint)",
  "/api/admin/janus": "route: app/api/admin/janus/[...path]/route.ts(域前缀)",
  "/api/admin/market/exchange": "route: app/api/admin/market/[...path]/route.ts:24",
  "/api/admin/market/nex/curve": "route: app/api/admin/market/[...path]/route.ts:27",
  "/api/admin/market/nex/genesis": "route: app/api/admin/market/[...path]/route.ts:57",
  "/api/admin/market/nex/repurchase": "route: app/api/admin/market/[...path]/route.ts:33",
  "/api/admin/teams/leadership-pool": "route: app/api/admin/teams/[...path]/route.ts",
  "/api/admin/treasury/b-domain": "route: app/api/admin/treasury/[...path]/route.ts",
  "/api/admin/users/profiles": "route: app/api/admin/users/[...path]/route.ts",
};

// ── 扫描 ────────────────────────────────────────────────────────────────
const files = [];
function walk(d) {
  let entries;
  try {
    entries = readdirSync(d, { withFileTypes: true });
  } catch {
    return; // 目录不存在(可选扫描面)
  }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (EXT.has(extname(e.name))) files.push(p);
  }
}
for (const d of SCAN_DIRS) walk(join(ROOT, d));

/**
 * 标出每一行是不是注释。**必须带块状态**:JSDoc `/* … *\/` 的续行没有任何前缀,
 * 只按行首前缀匹配会整片漏掉。
 */
function markCommentLines(lines) {
  const out = new Array(lines.length).fill(false);
  let inBlock = false;
  let inHtml = false;
  lines.forEach((line, i) => {
    if (inBlock || inHtml) {
      out[i] = true;
      if (inBlock && line.includes("*/")) inBlock = false;
      if (inHtml && line.includes("-->")) inHtml = false;
      return;
    }
    if (/^\s*\/\//.test(line) || /\S\s+\/\/\s/.test(line)) out[i] = true;
    if (line.includes("/*")) {
      out[i] = true;
      if (!line.includes("*/")) inBlock = true;
    }
    if (line.includes("<!--")) {
      out[i] = true;
      if (!line.includes("-->")) inHtml = true;
    }
  });
  return out;
}

/** `.` 不进路径(注释里常跟字段访问);`,` 进,支持 `{a,b}` 并列写法 */
const CITE = /(?:\b(GET|POST|PUT|PATCH|DELETE)\s+)?(\/api\/[A-Za-z0-9_:{},*|/?=&…-]*)/g;

/** 归一:去 query string / 句读尾巴 / 尾斜杠;必须还剩至少一个 segment */
function normalizePath(raw) {
  const p = raw
    .replace(/\?.*$/, "")
    .replace(/[,.;:)]+$/, "")
    .replace(/\/+$/, "");
  return /^\/api\/[A-Za-z{]/.test(p) ? p : null;
}

const found = new Map();
for (const f of files) {
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  const isComment = markCommentLines(lines);
  lines.forEach((line, i) => {
    if (!isComment[i]) return;
    for (const m of line.matchAll(CITE)) {
      const p = normalizePath(m[2]);
      if (!p) continue;
      const token = (m[1] ? `${m[1]} ` : "") + p;
      if (!found.has(token)) found.set(token, []);
      found.get(token).push({ file: relative(ROOT, f).replace(/\\/g, "/"), line: i + 1 });
    }
  });
}

if (process.argv.includes("--dump")) {
  for (const [t, locs] of [...found.entries()].sort()) {
    console.log(`${String(locs.length).padStart(3)}  ${t}${LEDGER[t] ? "" : "   <<< NOT IN LEDGER"}`);
    if (!LEDGER[t]) locs.forEach((l) => console.log(`       ${l.file}:${l.line}`));
  }
  process.exit(0);
}

const totalCitations = [...found.values()].reduce((s, v) => s + v.length, 0);
const unregistered = [...found.entries()].filter(([t]) => !LEDGER[t]);
const orphanLedger = Object.keys(LEDGER).filter((t) => !found.has(t));

const fail = [];
if (totalCitations === 0) {
  fail.push(
    `扫描 0 命中 —— 判据失效(扫了 ${files.length} 个文件却一条 /api/ 注释引用都没找到)。` +
      `先修扫描逻辑,别把空集当通过。`,
  );
}
for (const [t, locs] of unregistered) {
  fail.push(
    `未登记的接口引用 \`${t}\`(${locs.length} 处):\n` +
      locs.map((l) => `      ${l.file}:${l.line}`).join("\n") +
      `\n      → 与 app/api/** 真实 route handler(或后台 PRD)核对后加进 ` +
      `scripts/endpoint-citation-sentinel.mjs 的 LEDGER,并注明 "route: <文件>" 或 "TBD: <原因>"。`,
  );
}
for (const t of orphanLedger) {
  fail.push(
    `台账条目 \`${t}\` 在代码注释里已不存在 —— 台账过期,请从 LEDGER 删除` +
      `(出处记录:${LEDGER[t]})。`,
  );
}

if (fail.length) {
  console.error("✗ endpoint-citation-sentinel FAIL");
  fail.forEach((m, i) => console.error(`  ${i + 1}. ${m}`));
  process.exit(1);
}

console.log(
  `✓ endpoint-citation-sentinel PASS — ${totalCitations} 处注释接口引用 / ` +
    `${found.size} 个去重地址,全部在台账有据(扫描 ${files.length} 个源文件;` +
    `台账 ${Object.keys(LEDGER).length} 条)`,
);
