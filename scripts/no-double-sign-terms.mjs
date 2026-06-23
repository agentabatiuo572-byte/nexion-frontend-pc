// 运营后台 · 旧双人确认机制残留扫描。
// 禁止用户可见文案、脚本、清单、设计变体重新出现旧流程口径。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// docs/ 为内部 PRD/SPEC/Checklist/审计文档(非用户可见文案/代码):其中合法记述「取消双签」改写决议、
// 描述新单人确认机制(「原复核层级转为执行门槛」)、及域内正常词(区域大使审批 / 法务审批 / server 复核)——
// 本门只扫用户面与代码口径(app/lib/scripts),故 docs 整树跳过(同 CLAUDE.md 历史说明豁免)。代码侧残留仍爆红。
const SKIP = /(?:^|[\\/])(?:node_modules|\.next|\.git|\.trash|screenshots|videos|traces|docs)(?:[\\/]|$)/;
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
  // CLAUDE.md 是内部架构指引(非用户可见文案/脚本/清单/设计变体):其中记述 MC 契约组件名与「双签已全量取消」决议属合法历史说明;本门只扫用户面与代码口径。
  if (rel === "CLAUDE.md") continue;
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
