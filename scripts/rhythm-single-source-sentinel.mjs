#!/usr/bin/env node
/**
 * 节奏单源哨兵(2026-06-24 audit 评估闭环)。
 *
 * 不变量:活渲染面(app/(console) + app/components/domain-views)禁止直接读
 *   PHASE.current / PHASE.month / PHASE.label / PHASE.dials / CURRENT_PHASE.{code,month,total}
 * 来显示「当前节奏状态」(阶段 / 运营月 / 总时长)—— 必须走 H1 真实接口单源。
 *
 * 为什么:节奏总时长 + 当前运营月已运营可配(H1.rhythm.*)。任何面若读旧常量就会在运营改节奏后抄快照、与全站分叉。
 *   本轮审计正是命中 F3 双轨卡标签 / L4 效果报表表格 / D5 派发只读三项 / H3 倍率标记 等漏接面。
 *
 * 豁免:整行注释(// 或 * 开头)与行尾注释不计。
 * 修复:从 H1 真实接口读取 currentPhase / currentMonth / totalMonths。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  path.join(ROOT, "app", "(console)"),
  path.join(ROOT, "app", "components", "domain-views"),
];
const FORBIDDEN = /\bPHASE\.(current|month|label|dials)\b|\bCURRENT_PHASE\.(code|month|total)\b/;

const hits = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".trash" || entry.name === "node_modules" || entry.name === ".next") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return; // 整行注释豁免
      const code = line.split("//")[0]; // 去行尾注释
      if (FORBIDDEN.test(code)) hits.push(`${path.relative(ROOT, p).replace(/\\/g, "/")}:${i + 1}  ${trimmed.slice(0, 110)}`);
    });
  }
}

SCAN_DIRS.forEach(walk);

if (hits.length) {
  console.error("[rhythm-single-source] 活渲染面直接读 PHASE.*/CURRENT_PHASE.* 显示当前节奏状态(应改 rhythmState(pget) 单源):");
  for (const h of hits) console.error("  " + h);
  console.error("  修复:从 H1 真实接口读取 currentPhase / currentMonth / totalMonths。");
  process.exit(1);
}

console.log("[rhythm-single-source] OK · 活渲染面 0 处直接读 PHASE/CURRENT_PHASE 当前态(节奏状态全走 rhythmState 单源)");
process.exit(0);
