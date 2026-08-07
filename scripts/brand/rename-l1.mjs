/**
 * 品牌改名 L1(运营/用户可见文案)· 白名单字面量替换 + 契约面回验。
 *
 * 设计原则:**只改列出来的字面量**,不做 /Nexion/g 全局替换 ——
 * 后者会连带改掉仓库目录名(Nexion-uniapp / nexion-backend)、环境变量、代理头、
 * 持久化键与 cookie 名,那些是接口契约,改了就是线上事故。
 * 纯 Node 实现,不依赖 shell(Windows 下 node 拿不到 /bin/bash)。
 */
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["lib", "app", "scripts", "tests"];
const EDIT_ROOTS = ["lib", "app"];
const EXT = /\.(ts|tsx|mjs|json)$/;

// 只改这些字面量。每条都要能回答「运营或用户会在界面上看到它吗」。
const RENAMES = [
  ["NexionBox", "NexGridBox"],        // 设备产品名,用户端已是 NexGridBox(194 处)
  ["NexionRack", "NexGridRack"],      // 同上
  ["Nexion Ops Console", "NexGrid Ops Console"],
  ["Nexion 运营控制台", "NexGrid 运营控制台"],
  ["Nexion 运营控制后台", "NexGrid 运营控制后台"],
  ["Nexion 全托管", "NexGrid 全托管"],
  ["Nexion 消费端", "NexGrid 消费端"],
  ["Nexion V5", "NexGrid V5"],
  ["risk@nexion", "risk@nexgrid"],    // 用户端域名口径是 nexgrid.ai / nexgrid.io
  ["nexion-reconciliation-", "nexgrid-reconciliation-"], // 导出文件名,零脚本断言
];

// 🔴 改完必须逐字节相同的东西。任何一条数量变化 = 误伤契约面,直接失败。
const UNTOUCHABLE = [
  "Nexion-uniapp", "Nexion-prototype", "Nexion-admin-prototype", "nexion-backend",
  "NEXION_", "X-Nexion-", "nexion-admin-", "nexion_admin_token",
  "nexion_admin_pwd_change_token", "__nexionAdmin",
  "nexion:l2:view", "nexion:l4:view", "nexion-sidebar-scroll",
  "What is Nexion", // 课程标题归后端内容,前端单方面改会对不上
];

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
    // 排除本脚本自己:它的白名单/回验清单里字面写着这些标识符,扫进来会把自己算成命中。
    if (e.isDirectory() && dir.endsWith("scripts") && e.name === "brand") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXT.test(e.name)) out.push(full);
  }
  return out;
}

const scanFiles = ROOTS.flatMap((r) => walk(r));
const editFiles = EDIT_ROOTS.flatMap((r) => walk(r));

const countIn = (files, needle) =>
  files.reduce((n, f) => n + (fs.readFileSync(f, "utf8").split(needle).length - 1), 0);

const before = Object.fromEntries(UNTOUCHABLE.map((n) => [n, countIn(scanFiles, n)]));

let touched = 0;
const hits = {};
for (const file of editFiles) {
  const original = fs.readFileSync(file, "utf8");
  let next = original;
  for (const [from, to] of RENAMES) {
    if (!next.includes(from)) continue;
    hits[from] = (hits[from] ?? 0) + next.split(from).length - 1;
    next = next.split(from).join(to);
  }
  if (next !== original) {
    fs.writeFileSync(file, next, "utf8");
    touched++;
  }
}

console.log(`扫描 ${editFiles.length} 个文件,改动 ${touched} 个`);
for (const [from, to] of RENAMES) console.log(`  ${String(hits[from] ?? 0).padStart(3)} 处  ${from} → ${to}`);

let broken = 0;
for (const needle of UNTOUCHABLE) {
  const after = countIn(scanFiles, needle);
  if (after !== before[needle]) {
    console.error(`🔴 契约面被误伤:${needle}  ${before[needle]} → ${after}`);
    broken++;
  } else {
    console.log(`  ✓ ${needle} 未变(${before[needle]} 处)`);
  }
}
if (broken) {
  console.error(`\n🔴 ${broken} 条契约面标识符数量变化,改动不可信 —— git checkout 回滚后重来。`);
  process.exit(1);
}

const totalHits = Object.values(hits).reduce((a, b) => a + b, 0);
if (totalHits === 0) {
  console.error("🔴 白名单一处都没命中 —— 要么已改过,要么判据写错,请人工确认。");
  process.exit(1);
}
console.log(`\n✅ 契约面回验通过(${UNTOUCHABLE.length} 条全部未变);共改 ${totalHits} 处文案`);
