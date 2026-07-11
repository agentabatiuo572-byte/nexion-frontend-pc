// 扫描运行时禁用的 mock/store import。原用 ripgrep(rg) execFileSync,Windows 环境无 rg 致 ENOENT,
// 改用 node fs 递归 + 字面匹配(等价 rg --fixed-strings -n),自包含跨平台零外部依赖。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const scanRoots = ["app", "lib/admin", "lib/store", "tests"];
const forbiddenImports = [
  "@/lib/mock/admin/command-center",
  "@/lib/mock/admin/design-data",
  "@/lib/mock/admin/ledger",
  "@/lib/mock/admin/user-360",
  "@/lib/mock/admin/user-deposits",
  "@/lib/mock/admin/users",
  "@/lib/mock/admin/vouchers",
  "@/lib/store/admin/platform-config-store",
  "@/lib/store/admin/user-ops-store",
];

// 递归收集源码文件(跳过 node_modules/.next/隐藏目录)。
function collectFiles(root) {
  const out = [];
  let st;
  try {
    st = statSync(root);
  } catch {
    return out;
  }
  if (!st.isDirectory()) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) continue;
    const p = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(p));
    } else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

const files = scanRoots.flatMap(collectFiles);

let failed = false;
for (const pattern of forbiddenImports) {
  const matches = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    content.split(/\r?\n/).forEach((line, idx) => {
      if (line.includes(pattern)) matches.push(`${file}:${idx + 1}:${line.trim()}`);
    });
  }
  if (matches.length) {
    failed = true;
    console.error(`Forbidden runtime mock import: ${pattern}`);
    console.error(matches.join("\n"));
  }
}

if (failed) {
  process.exit(1);
}

console.log("Runtime mock import guard passed.");
