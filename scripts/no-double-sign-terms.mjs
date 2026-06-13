// 运营后台 · 旧双人确认机制残留扫描。
// 禁止用户可见文案、脚本、清单、设计变体重新出现旧流程口径。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = /(?:^|[\\/])(?:node_modules|\.next|\.git|screenshots|videos|traces)(?:[\\/]|$)/;
const EXT = new Set([".ts", ".tsx", ".mjs", ".sh", ".md", ".json", ".html"]);
const banned = [
  /MakerCheckerModal/,
  /Maker-Checker/,
  /MakerChecker/,
  /\bmaker\b/i,
  /\bchecker\b/i,
  /\bapproval\b/i,
  /confirmer/i,
  /双签/,
  /双审/,
  /双审批/,
  /审批/,
  /双人复核/,
  /双人审批/,
  /待复核/,
  /待 Checker/,
  /第二角色确认/,
  /第二位审核人/,
  /第二个人审核/,
  /双人留痕/,
  /双人授权/,
  /两人审核/,
  /可确认/,
  /确认人/,
  /发起\s*→.*确认/,
  /待确认工单/,
  /工单 TTL/,
  /工单时限/,
  /超时自动作废/,
  /no-mc/,
  /mc-pair/,
  /ApprovalInbox/,
  /approval-inbox/,
  /setMc/,
  /审批工单/,
  /免双签/,
  /免审/,
  /提交复核/,
  /已提交复核/,
  /复核放行/,
  /复核原因/,
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (SKIP.test(fp)) continue;
    if (e.isDirectory()) walk(fp, out);
    else if (EXT.has(path.extname(e.name))) out.push(fp);
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (rel === path.join("scripts", "no-double-sign-terms.mjs")) continue;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const re of banned) {
      if (re.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (hits.length) {
  console.log(`✗ 旧确认机制残留 ${hits.length} 处:`);
  console.log(hits.slice(0, 80).map((h) => `  ${h}`).join("\n"));
  if (hits.length > 80) console.log(`  … 另 ${hits.length - 80} 处`);
  process.exit(1);
}

console.log("✓ 旧确认机制残留 0");
