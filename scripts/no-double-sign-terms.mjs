// 运营后台 · 旧双人确认机制残留扫描。
// 禁止用户可见文案、脚本、清单、设计变体重新出现旧流程口径。
// 2026-08-03 与现行架构和解:本门只禁「旧 MakerCheckerModal 时代」的机制签名(组件名/工单 TTL/双签等)。
// 现行 A2 pending 票审批链(propose-or-execute:高危资金动作入队、持 A2 审批权者放行;止血类必须即时执行)
// 是后于 2026-06 决议的受认可设计,其即时/排队分界由 a2-audit-coverage-sentinel.mjs(verify 在役)机器强制,
// 故「审批/双人复核(A2 语境)/免审(FEAT-WD01 小额免审线)/maker·checker(后端 API 契约字段)」不再入禁词。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// docs/ 为内部 PRD/SPEC/Checklist/审计文档(非用户可见文案/代码):其中合法记述「取消双签」改写决议、
// 描述新单人确认机制(「原复核层级转为执行门槛」)、及域内正常词(区域大使审批 / 法务审批 / server 复核)——
// 本门只扫用户面与代码口径(app/lib/scripts),故 docs 整树跳过(同 CLAUDE.md 历史说明豁免)。代码侧残留仍爆红。
const SKIP = /(?:^|[\\/])(?:node_modules|\.next|\.git|\.trash|\.claude|screenshots|videos|traces|docs)(?:[\\/]|$)/;
const EXT = new Set([".ts", ".tsx", ".mjs", ".sh", ".md", ".json", ".html"]);
const banned = [
  /MakerCheckerModal/,
  /Maker-Checker/,
  /MakerChecker/,
  /\bapproval\b/i,
  /\bconfirmer\b/i, // \b 界定:防误咬 operationConfirmErrorMessage 等标识符子串
  /双签/,
  /双审/,
  /双审批/,
  /双人复核/, // 2026-08-04 恢复:A2 机制为单人确认可自批(ops-authority.ts),「双人」口径=文案撒谎,必须咬
  /双人审批/,
  /待复核/,
  /待 Checker/,
  /第二角色确认/,
  /第二位审核人/,
  /第二个人审核/,
  /双人留痕/,
  /双人授权/,
  /两人审核/,
  /(?<![不有即])可确认/, // 「不可确认/没有可确认/即可确认」是数据兜底文案与 A2 权限说明,不是旧双签口径
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
  /免双签/,
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
// 2026-08-03 范围对齐章程:全词表只扫用户面与代码口径 = app/lib/scripts;
// 2026-08-04 对抗验收增补:tests/ 以「机制签名窄集」扫描(只咬旧机制部件名,不含 approval/可确认 等易误报词),
// 防旧机制断言在测试层复活而无门可咬。
const MECH_SIGNATURES = [/MakerCheckerModal/, /ApprovalInbox/, /approval-inbox/, /mc-pair/, /setMc/, /工单 TTL/, /待确认工单/, /超时自动作废/, /双签/, /双人复核/, /双人审批/];
for (const file of walk(path.join(ROOT, "tests"))) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const re of MECH_SIGNATURES) {
      if (re.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  });
}
const SCAN_ROOTS = ["app", "lib", "scripts"].map((d) => path.join(ROOT, d));
for (const file of SCAN_ROOTS.flatMap((d) => walk(d))) {
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
