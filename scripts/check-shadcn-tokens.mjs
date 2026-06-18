#!/usr/bin/env node
/**
 * shadcn token 一致性门 —— 引入 shadcn/ui 时新增的强制层。
 *
 * 背景:shadcn 组件(app/components/ui/*)从注册表拷入时自带一套默认语义 token
 * (bg-background / text-muted-foreground / border-border / bg-popover / bg-accent / var(--ring) …),
 * 这些 token 在本工程的 V5 设计系统里【不存在】。本门强制:凡落到 app/components/ui/ 的
 * shadcn 组件必须把默认 token 全部重皮到 Nexion V5(var(--v5-*) / var(--admin-*)),
 * 否则渲染失色 + 破坏设计纪律。把"V5 与 shadcn 并存的一致性税"从靠自觉变成机器门。
 *
 * 通过条件:app/components/ui/ 下所有 .ts(x)/.js(x) 文件 0 处残留默认 token。
 * 用法:node scripts/check-shadcn-tokens.mjs   (退出码 0=通过, 1=有残留)
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const UI_DIR = join(ROOT, "app", "components", "ui");

// shadcn 默认语义 token 名(与 V5 的 --v5-* / --admin-* 互斥)。
const SEMANTIC =
  "background|foreground|card|card-foreground|popover|popover-foreground|" +
  "primary|primary-foreground|secondary|secondary-foreground|muted|muted-foreground|" +
  "accent|accent-foreground|destructive|destructive-foreground|border|input|ring|" +
  "chart-[1-5]|sidebar(?:-[a-z-]+)?";

// 1) Tailwind 工具类形式:bg-background / text-muted-foreground / border-border / ring-ring / ring-offset-background …
//    要求前缀前有边界(行首/空白/引号/反引号/冒号/中括号),后缀后无 \w 或 -(避免吃掉 border-strong 之类)。
const CLASS_RE = new RegExp(
  "(?:^|[\\s\"'`:\\[])" +
    "(?:bg|text|border|ring|ring-offset|fill|stroke|from|via|to|outline|divide|placeholder|caret|decoration|shadow|accent)-" +
    "(?:" + SEMANTIC + ")(?![\\w-])",
  "g",
);

// 2) CSS 变量形式:var(--background) / var(--muted-foreground) / var(--ring) …
//    注意 --v5-border / --admin-* 不会命中(变量名在 -- 后必须直接是上面的语义词)。
const VAR_RE = new RegExp("var\\(\\s*--(?:" + SEMANTIC + ")\\s*\\)", "g");

// 剥离注释后再扫(保留行号),避免文档注释里举例写的 token 名造成误报。
function stripComments(src) {
  // 块注释 /* … */:逐字符换空格但保留换行,行号不变。
  src = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  // 行注释 // …:避开 URL 的 "://"(前一个非冒号字符保留)。
  src = src.replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1) => p1 + " ".repeat(_m.length - p1.length));
  return src;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(UI_DIR);
let violations = 0;

for (const f of files) {
  const rel = f.slice(ROOT.length + 1).replace(/\\/g, "/");
  const lines = stripComments(readFileSync(f, "utf8")).split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const re of [CLASS_RE, VAR_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        violations++;
        console.error(`  ✗ ${rel}:${i + 1}  残留 shadcn 默认 token → ${m[0].trim()}`);
      }
    }
  });
}

if (files.length === 0) {
  console.log("  shadcn token 门:无 app/components/ui/* 文件,跳过");
  process.exit(0);
}
if (violations > 0) {
  console.error(
    `  ✗ shadcn token 门失败:${violations} 处未重皮到 V5(必须改用 var(--v5-*) / var(--admin-*))`,
  );
  process.exit(1);
}
console.log(`  ✓ shadcn token 门通过:${files.length} 个 ui 组件,0 残留默认 token`);
process.exit(0);
