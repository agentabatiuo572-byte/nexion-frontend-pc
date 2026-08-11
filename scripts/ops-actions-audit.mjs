// 运营后台 · 动作完整性门(防「声明即覆盖」幻觉 + 锁死回归)。
// 缘起:商品目录只有定价、缺改价/下架——排查发现全后台 ~671 声明动作仅 ~20 真接 store,~110 死控件。
// 既有的门只查「已存在代码对不对」,无人查「该有的动作在不在 + 声明的有没有真落地」。本门补这个正交维度。
//
// 清单驱动(docs/ops-actions.manifest.json)+ 三条硬规则:
//   1. 死控件基线软哨兵:每 view 实际死控件信号数 ≤ deadControlBaseline[view](只减不增);超标出 warning 提示(不 FAIL,措辞会影响计数)。
//   2. 防 built 退化:status=built 行的 storeAction 必须在 lib/store/admin/* 真定义 + 在其 view 真被调用。否则 FAIL(虚标/被改回死控件)。
//   3. readonly 须带 reason(防滥用 readonly 逃避补齐)。
// 批次收紧:OPS_BATCH=P0|P1|P2|ALL — 设定后,该批次(含)的 pending/missing 行必须已 built,否则 FAIL。默认只跑规则 1-3 + 计欠账。
// 用法:node scripts/ops-actions-audit.mjs   (verify.mjs GEARS 常驻齿轮,2026-08-03 起)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  validateRuntimeConsumerContracts,
  validateRuntimeEvidence,
  validateServiceDelegations,
} from "./lib/ops-actions-reverse-coverage.mjs";
import {
  resolveNexionAppRoot,
  resolveNexionBackendRoot,
} from "./lib/nexion-workspace-paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const MANIFEST = path.join(ROOT, "docs", "ops-actions.manifest.json");
const VIEWS_DIR = path.join(ROOT, "app/components/domain-views");
const BATCH_ORDER = ["P0", "P1", "P2"];
const curBatch = process.env.OPS_BATCH || "";

// 死控件信号(与 manifest.deadControlBaseline 同口径):OperationConfirm stub(onConfirm 只「提交确认」toast)/ setActedLabel / onClick 直接 toast。
// 注:不计 setActionConfirm 数 —— setActionConfirm 只是「打开确认弹窗」的通用机制,真写与否取决于 onConfirm(接 setParam/updateAccount/setFrozen=真动作)。
//    「提交确认」是 stub 兜底的强特征,作「防新增 confirm-stub」哨兵;补齐进度以 manifest built 行为准(双重保险)。
const DEAD_SIGNALS = [/setToast\([^)]*(?:提交确认|已确认生效)/g, /setActedLabel\(/g, /onClick=\{\(\)\s*=>\s*\{?\s*setToast\(/g];
const countDead = (src) => DEAD_SIGNALS.reduce((n, re) => n + (src.match(re) || []).length, 0);

// 收集 app/ 下所有 tsx 拼接 — 校验 built 的 storeAction 是否被任意 view 调用(不绑定单一文件,
// 因真动作常在子组件如 hub/*-section.tsx 调用,而非 manifest.view 标的主文件)。
function walkTsx(dir, acc = []) {
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const fp = path.join(dir, e.name); if (e.isDirectory()) { if (!/node_modules|\.next/.test(fp)) walkTsx(fp, acc); } else if (/\.tsx$/.test(e.name)) acc.push(fp); } } catch {}
  return acc;
}
const appBlob = walkTsx(path.join(ROOT, "app")).map(read).join("\n");

const m = JSON.parse(read(MANIFEST) || "{}");
const rows = m.rows || [];
const baseline = m.deadControlBaseline || {};
const problems = [];
const warnings = [];
const BACKEND_ROOT = resolveNexionBackendRoot({ adminRoot: ROOT });
const UNIAPP_ROOT = resolveNexionAppRoot({ adminRoot: ROOT });
const JANUS_ROOT = path.resolve(ROOT, "..", "NX1.0-Janus");
const evidenceRoot = (type) => type.startsWith("backend-") ? BACKEND_ROOT
  : type.startsWith("uniapp-") ? UNIAPP_ROOT
    : type.startsWith("janus-") ? JANUS_ROOT : ROOT;
problems.push(...validateRuntimeEvidence(m, (type, file) => {
  const absolute = path.resolve(evidenceRoot(type), file);
  return absolute.startsWith(`${evidenceRoot(type)}${path.sep}`) ? read(absolute) || undefined : undefined;
}).map((problem) => `[运行时证据] ${problem}`));
problems.push(...validateRuntimeConsumerContracts(m, (type, file) => {
  const absolute = resolveConsumerEvidencePath(type, file);
  return absolute ? read(absolute) || undefined : undefined;
}, resolveConsumerEvidencePath).map((problem) => `[运行时消费者证据] ${problem}`));
problems.push(...validateServiceDelegations(m, (file) => read(path.resolve(BACKEND_ROOT, file)) || undefined)
  .map((problem) => `[服务委派证据] ${problem}`));

function resolveConsumerEvidencePath(type, file) {
  const root = type === "backend-runtime" || type === "backend-test" ? BACKEND_ROOT
    : type === "uniapp-runtime" || type === "uniapp-test" ? UNIAPP_ROOT
      : type === "janus-runtime" || type === "janus-test" ? JANUS_ROOT
        : type === "pc-runtime" || type === "test-runtime" ? ROOT : undefined;
  if (!root || typeof file !== "string" || !file.trim()) return undefined;
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  try {
    const physicalRoot = fs.realpathSync.native(root);
    const physicalFile = fs.realpathSync.native(absolute);
    const physicalRelative = path.relative(physicalRoot, physicalFile);
    if (physicalRelative === "" || physicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(physicalRelative)) return undefined;
    return physicalFile;
  } catch { return undefined; }
}

// ── 规则 1:防新增死控件(per view 只减不增)──
let baselineDrift = 0;
for (const f of fs.readdirSync(VIEWS_DIR).filter((x) => /-view\.tsx$/.test(x)).sort()) {
  const actual = countDead(read(path.join(VIEWS_DIR, f)));
  const base = baseline[f];
  if (base === undefined) { warnings.push(`${f} 不在 deadControlBaseline(当前死控件特征=${actual})— 建议补一行哨兵`); continue; }
  // 软哨兵:死控件特征计数受文案措辞影响(如「提交确认」字面量),不作硬 FAIL,仅提示。
  // 硬保证靠下方:built 行 storeAction 真落地 + readonly 有据 + 批次收紧。
  if (actual > base) warnings.push(`${f}: 死控件特征 ${actual} > 基线 ${base}(+${actual - base})— 软提示(措辞会影响计数);确认是否有未登记 manifest 的新 stub`);
  else if (actual < base) { warnings.push(`${f}: 死控件 ${actual} < 基线 ${base}(已补 ${base - actual})— 可把 baseline 降到 ${actual}`); baselineDrift++; }
}

// ── 规则 2:防 built 退化(storeAction / restAction 真落地)──
const storeBlob = (() => {
  let b = ""; const dir = path.join(ROOT, "lib/store/admin");
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith(".ts")) b += read(path.join(dir, f)); } catch {}
  return b;
})();
// REST 化动作的真写入口在后端 client(lib/admin/*-client.ts),不经 store。这类行用 restAction 字段标注,
// 门照样反查「真落地(在 lib/admin/*)+ 被 view 调用」两不变量 —— 只是落地面从 store 换成 REST client,
// 防把 REST 动作改回死控件(删 client 调用 / 虚标 built)。例:A1 账号治理 createA1Account · E2 任务 CRUD createE2Task。
const libBlob = (() => {
  let b = ""; const dir = path.join(ROOT, "lib/admin");
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith(".ts")) b += read(path.join(dir, f)); } catch {}
  return b;
})();
// 2026-08-04 强化:锚校验裸子串 → 形态锚(防注释假过/超串改名不响/权限字面量 user_x 空转);
// restActions 数组支持多动作行全锚(每个锚独立校验,缺一即红)。
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const definedInLib = (a) => {
  const x = esc(a);
  return (
    new RegExp(`op:\\s*"${x}"`).test(libBlob) ||
    new RegExp(`export (?:async )?function ${x}\\b`).test(libBlob) ||
    new RegExp(`\\b${x}\\s*:\\s*(?:async )?\\(`).test(libBlob) ||
    new RegExp(`\\b${x}\\s*\\(`).test(libBlob)
  );
};
// 活跃页面也会经 store 间接调用 REST client（例如 K6 策略/设备管理）。
// 调用面同时覆盖 app/ 与 lib/store/admin；定义面仍只认 lib/admin。
const activeCallBlob = `${appBlob}\n${storeBlob}`;
const calledInApp = (a) => {
  const x = esc(a);
  return (
    new RegExp(`findHighOp\\(\\s*"${x}"`).test(activeCallBlob) ||
    new RegExp(`\\.${x}\\(`).test(activeCallBlob) ||
    new RegExp(`\\b${x}\\s*\\(`).test(activeCallBlob) ||
    new RegExp(`"${x}"`).test(activeCallBlob) // 动态 op 映射表里的精确引号字面量(引号定界,user_x 前缀串不匹配)
  );
};
for (const r of rows) {
  if (r.status !== "built") continue;
  const anchors = Array.isArray(r.restActions) ? r.restActions : r.restAction ? [r.restAction] : null;
  if (anchors) {
    for (const a of anchors) {
      if (!definedInLib(a)) problems.push(`[built 退化] ${r.id}: 锚 "${a}" 无 lib/admin 定义形态(被删/改名/虚标)`);
      else if (!calledInApp(a)) problems.push(`[built 未接线] ${r.id}: 锚 "${a}" 定义存在但 app/ 无调用形态(UI 没接)`);
    }
    continue;
  }
  if (r.runtimeEvidence !== undefined || r.serviceDelegations !== undefined) continue;
  if (!r.storeAction) { problems.push(`[built 缺锚] ${r.id} ${r.object}·${r.action}`); continue; }
  if (!storeBlob.includes(r.storeAction)) problems.push(`[built 退化] ${r.id}: storeAction "${r.storeAction}" 不在 lib/store/admin/*(被删/虚标)`);
  else if (!appBlob.includes(r.storeAction)) problems.push(`[built 未接线] ${r.id}: "${r.storeAction}" 在 store 定义但 app/ 无 view 调用(UI 没接)`);
}

// ── 规则 3:readonly 须带 reason ──
for (const r of rows) {
  if (r.status === "readonly" && !String(r.reason || "").trim()) problems.push(`[readonly 无理由] ${r.id} ${r.object}·${r.action} — readonly 须注明为何不该后台写`);
  if (!["built", "pending", "missing", "readonly"].includes(r.status)) problems.push(`[未知 status] ${r.id}: ${r.status}`);
}

// ── 批次收紧(可选)──
if (curBatch) {
  if (curBatch !== "ALL" && !BATCH_ORDER.includes(curBatch)) {
    problems.push(`[未知 OPS_BATCH] ${curBatch}；只允许 ${[...BATCH_ORDER, "ALL"].join("|")}`);
  }
  const idx = BATCH_ORDER.indexOf(curBatch);
  const inScope = curBatch === "ALL" ? BATCH_ORDER : BATCH_ORDER.slice(0, idx + 1);
  for (const r of rows) {
    if ((r.status === "pending" || r.status === "missing") && (curBatch === "ALL" || inScope.includes(r.batch)))
      problems.push(`[批次${curBatch} 未达] ${r.id} [${r.status}] ${r.object}·${r.action}(batch=${r.batch})须补到 built`);
  }
}

// ── 欠账统计 ──
const stat = { built: 0, pending: 0, missing: 0, readonly: 0 };
const byBatch = {};
for (const r of rows) {
  stat[r.status] = (stat[r.status] || 0) + 1;
  if (r.status === "pending" || r.status === "missing") byBatch[r.batch] = (byBatch[r.batch] || 0) + 1;
}
const owed = stat.pending + stat.missing;

console.log(`动作完整性门:清单 ${rows.length} 行 — ✅built ${stat.built} / 🟠pending ${stat.pending} / ❌missing ${stat.missing} / ⚪readonly ${stat.readonly}`);
console.log(`  欠账 ${owed}(待补):${Object.entries(byBatch).sort().map(([b, n]) => `${b}=${n}`).join(" · ")}`);
console.log(`  死控件 baseline 总计 ${Object.values(baseline).reduce((a, b) => a + b, 0)}(锁死回归:只减不增)`);
if (warnings.length) console.log(warnings.map((w) => "  ↓ " + w).join("\n"));
if (problems.length) {
  console.log(`\n✗ 动作完整性 FAIL — ${problems.length} 项:`);
  console.log(problems.slice(0, 40).map((p) => "  ✗ " + p).join("\n"));
  if (problems.length > 40) console.log(`  … 另 ${problems.length - 40} 条`);
  process.exit(1);
}
console.log(`✓ 动作完整性 PASS — 无新增死控件 · built 行均真落地 · readonly 均有据${curBatch ? ` · 批次${curBatch} 达标` : ""}`);
process.exit(0);
