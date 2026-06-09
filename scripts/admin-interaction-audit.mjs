// 运营后台 · 交互完整性自查门(防「打地鼠」)。
// 把本会话踩过的 6 类问题固化成静态扫描,每次 verify 跑一遍,残留即 FAIL。
//   A 死控件:hub 卡有 onClick 动作却没接真状态 store(只 toast)
//   B 上下文错配:多-Tab 域视图页头动作未随 Tab 切换(硬编码单一动作)
//   C 链接目标错:per-user 详情页 KPI/stat 链到全局域路由(应锚点到本页/本实体)
//   E persist 不显:读 admin persist store 的组件缺水合门(useOpsHydrated/mounted)
//   F 版本漂移:前端 PRD 文件名 / 内部版本表 / prd-guard 路径 三者版本号不一致
//   G 凭据反模式:运营后台出现明文密码输入(应走邀请 / SSO / 临时密码强制改)
//   H 绕 Maker-Checker:高敏处置(放行/驳回/封禁/冻结/终止/升级/kill/红冲…)的 onClick 直接 setParam 或仅高敏 setToast 而未经 setMc 双签(C-10 强制登出 + 本轮 a/c/k-view 放行驳回/终止/升级 教训)
// 用法:node scripts/admin-interaction-audit.mjs   (verify.sh 末段调用)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN = path.resolve(ROOT, "..");
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
function walk(dir, re, acc = []) {
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { if (!/node_modules|\.next|\.tmp-design/.test(fp)) walk(fp, re, acc); }
      else if (re.test(e.name)) acc.push(fp);
    }
  } catch {}
  return acc;
}
const findings = [];
const add = (cls, sev, file, msg) => findings.push({ cls, sev, file: path.relative(ROOT, file), msg });
const rel = (f) => path.relative(ROOT, f);

// ───────────── A 死控件:hub 卡有动作按钮却没接真状态 store ─────────────
for (const f of walk(path.join(ROOT, "app/components/hub"), /\.tsx$/)) {
  const s = read(f);
  const hasActionBtn = /onClick=\{(?:\(\)\s*=>|async)/.test(s) && /\b(toast|confirm)\b/.test(s);
  const importsRealStore = /from "@\/lib\/store\/admin\/(user-ops-store|platform-config-store)"/.test(s);
  // 纯只读卡(只有 <Link> 跳转、无 onClick 动作)豁免
  const onlyLinks = !/onClick=\{/.test(s);
  if (hasActionBtn && !importsRealStore && !onlyLinks && !s.includes("audit-ok:no-store")) {
    add("A", "HIGH", f, "hub 卡含 onClick 动作 + toast/confirm,但未 import 真状态 store(user-ops/platform-config)→ 疑似死控件(点了不改状态)。接 store 或标注 // audit-ok:no-store");
  }
}

// ───────────── B 多-Tab 域视图页头动作未随 Tab 切换 ─────────────
for (const f of walk(path.join(ROOT, "app/components/domain-views"), /-view\.tsx$/)) {
  const s = read(f);
  const multiTab = (s.match(/tab === "/g) || []).length >= 2 || /const FOLD\b/.test(s);
  if (!multiTab) continue;
  // 抽取 DomainHeader 的 right={...} 块,看是否含 tab 条件
  const m = s.match(/<DomainHeader[\s\S]*?right=\{([\s\S]*?)\}\s*\/>/);
  if (m) {
    const rightExpr = m[1];
    const tabAware = /\btab\b/.test(rightExpr); // right 表达式里引用 tab(三元/映射)= 已分 Tab
    const hasLiteralBtn = /<Btn/.test(rightExpr);
    // 仅「实体创建」类动作(新增/新建/添加)才是 Tab 特定 → 错配风险;导出/刷新/下载属域级通用,不报
    const isCreateAction = /新增|新建|添加|create/i.test(rightExpr);
    if (hasLiteralBtn && isCreateAction && !tabAware && !s.includes("audit-ok:header-action")) {
      add("B", "HIGH", f, "多-Tab 域视图的页头「创建」动作未随 tab 切换 → 某些 Tab 显示错误的创建动作(如 E3 显示新增 SKU)。改 tab 条件渲染(每 Tab 对应实体的创建/无)或标注 // audit-ok:header-action");
    }
  }
}

// ───────────── C per-user 详情页 KPI/stat 链到全局域路由 ─────────────
for (const f of walk(path.join(ROOT, "app/(console)"), /page\.tsx$/)) {
  if (!/\[\w+\]/.test(f)) continue; // 仅 [id] 动态详情页
  const s = read(f);
  // kpis/stat 数组里出现 href: "/<域>/..." 全局路由(非 # 锚点)
  const globalHref = /\bhref:\s*"\/(finance|network|devices|growth|finance-products|risk|content|emergency|analytics|overview|platform)\//;
  if (globalHref.test(s) && !s.includes("audit-ok:detail-link")) {
    add("C", "HIGH", f, "per-entity 详情页([id])的 KPI/stat 用 href 跳全局域路由 → 显示全用户数据而非本用户。改为锚点滚动到本页对应卡(scrollToHub)或标注 // audit-ok:detail-link");
  }
}

// ───────────── E 读 admin persist store 缺水合门 ─────────────
const persistStores = walk(path.join(ROOT, "lib/store/admin"), /\.ts$/).filter((f) => /persist\(/.test(read(f)));
const storeImportNames = persistStores.map((f) => {
  const s = read(f);
  const m = s.match(/export const (use\w+) = create/);
  return m ? m[1] : null;
}).filter(Boolean);
for (const f of walk(path.join(ROOT, "app"), /\.tsx$/)) {
  const s = read(f);
  for (const hook of storeImportNames) {
    // 读 state 字段(selector 含 s.<field>,排除只取 action 的情况较难,宽松:出现 useXxx((s) => s. 即视为读 state)
    const readsState = new RegExp(hook + "\\(\\(s\\)\\s*=>\\s*s\\.").test(s);
    const gated = /useOpsHydrated|usePlatformHydrated|\bmounted\b|hasHydrated/.test(s);
    if (readsState && !gated && !s.includes("audit-ok:hydration")) {
      add("E", "HIGH", f, `${rel(f)} 读 persist store(${hook}.state)但无水合门(useOpsHydrated/mounted)→ 刷新后 UI 可能不反映持久态(SSR 水合时序)。加水合门或标注 // audit-ok:hydration`);
      break;
    }
  }
}

// ───────────── F 前端 PRD 版本号三处一致 ─────────────
(() => {
  const prdFiles = fs.readdirSync(PLAN).filter((n) => /^Nexion_产品功能架构设计文档_v[\d.]+\.md$/.test(n));
  if (prdFiles.length !== 1) { add("F", "MEDIUM", path.join(PLAN, "(prd)"), `前端 PRD 文件应唯一,实测 ${prdFiles.length} 个:${prdFiles.join(", ")}`); return; }
  const fileVer = prdFiles[0].match(/_v([\d.]+)\.md$/)[1];
  const guard = read(path.join(PLAN, "Nexion-prototype/.claude/hooks/prd-guard.mjs"));
  const guardVer = (guard.match(/产品功能架构设计文档_v([\d.]+)\.md/) || [])[1];
  if (guardVer && guardVer !== fileVer) add("F", "MEDIUM", path.join(PLAN, "Nexion-prototype/.claude/hooks/prd-guard.mjs"), `prd-guard 守护版本 v${guardVer} ≠ 实际 PRD 文件 v${fileVer}`);
})();

// ───────────── G 凭据反模式:运营后台出现明文密码输入 ─────────────
// 管理员不应设/收他人明文密码(最小知悉 + 抗抵赖);凭据走邀请链接 / SSO / 临时密码强制改。
for (const dir of ["app/components/domain-views", "app/components/hub", "app/(console)"]) {
  for (const f of walk(path.join(ROOT, dir), /\.tsx$/)) {
    const s = read(f);
    if (s.includes("audit-ok:password")) continue;
    const hasPwType = /type=["']password["']/.test(s);
    const hasPwPlaceholder = /placeholder=\{?["'][^"'}]*(密码|password)/i.test(s);
    if (hasPwType || hasPwPlaceholder) {
      add("G", "HIGH", f, "运营后台出现明文密码输入(type=password / 密码 placeholder)→ 管理员不应设/收他人明文密码(最小知悉 + 抗抵赖)。改走邀请链接 / SSO / 临时密码强制改;确属 step-up 再认证则标注 // audit-ok:password");
    }
  }
}

// ───────────── H 高敏动作绕过 Maker-Checker ─────────────
// 正确模式:高敏处置 onClick={() => setMc({ …, onApply/write:(reason)=>setParam(…) })} → MakerCheckerModal 双签 → 回调真写。
// 绕过模式(FAIL):onClick 块内直接 setParam( 或仅做高敏 setToast(,而不经 setMc( → 单人即时生效 / 假装完成
//   (C-10 强制登出直接 setParam + 本轮 a-view 放行驳回 / c-view 终止 impersonate / k-view 升级 KYC 仅 setToast 教训)。
const HISENS_VERB = /(放行|驳回|批准|核准|封禁|解封|冻结|解冻|终止|升级|降级|关停|关闭|kill|强制|没收|清退|红冲|核销|罚没|改派|调整余额)/;
// 配平括号提取某 JSX 属性的完整 {…} 块(容忍内部嵌套 / 模板字符串的平衡 {})。
function extractAttrBlocks(src, attr) {
  const out = []; const re = new RegExp(attr + "=\\{", "g"); let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth > 0) { const ch = src[i]; if (ch === "{") depth++; else if (ch === "}") depth--; i++; }
    out.push(src.slice(m.index, i));
  }
  return out;
}
for (const f of walk(path.join(ROOT, "app/components/domain-views"), /-view\.tsx$/)) {
  const s = read(f);
  if (s.includes("audit-ok:mc")) continue;
  for (const blk of extractAttrBlocks(s, "onClick")) {
    if (/setMc\(/.test(blk)) continue;          // 走 MC = 正确(setParam/toast 在 setMc 的 onApply/write 回调里)
    if (/setParam\(/.test(blk)) {               // onClick 直接 setParam 未经 setMc = 绕双签(C-10 教训)
      add("H", "HIGH", f, "onClick 直接 setParam 未经 setMc → 高敏写绕过 Maker-Checker 双签(C-10 教训)。改 onClick={() => setMc({ …, onApply/write:(reason)=>setParam(…) })};低敏确属即时生效则标 // audit-ok:mc");
      continue;
    }
    const toastM = blk.match(/setToast\(\s*[`"']([^`"']*)/);  // 仅高敏处置 toast 而无 setMc = 绕MC + 死控件
    if (toastM && HISENS_VERB.test(toastM[1])) {
      add("H", "HIGH", f, `高敏处置仅 setToast("${toastM[1].slice(0, 16)}…")未经 setMc → 绕双签且未真写状态(死控件)。改走 setMc 双签 + 回调 setParam,或标 // audit-ok:mc`);
    }
  }
}

// ───────────── I 操作列对齐:CSS 统一规则存在(防回归) ─────────────
// 操作列右对齐由 globals.css `td:last-child:has(.btn,.sw)` 统一规则保证(覆盖「td 直接控件」+「td>.row>控件」所有 DOM 写法)。
// 教训:逐处源码 grep 必漏(HTML 模式多变 — td 直接 Btn / row 容器 / 已加 flex-end),CSS 统一一处根治。
// 源码门只能防该规则被误删(删了→全站操作列退回左对齐,本轮主人抽检暴露);真实对齐须运行时 DOM 遍历验证(docs/UI-RUNTIME-AUDIT.md)。
(() => {
  const css = read(path.join(ROOT, "app/globals.css"));
  if (!/td:last-child:has\(\.btn/.test(css)) add("I", "HIGH", path.join(ROOT, "app/globals.css"), "globals.css 缺操作列右对齐统一规则 `td:last-child:has(.btn,.sw)` → 全站表格末列操作按钮退回左对齐(主人抽检暴露的系统问题)。补回该规则,勿改回逐处 inline。");
})();

// ───────────── 报告 ─────────────
const high = findings.filter((f) => f.sev === "HIGH");
console.log(`交互完整性自查:扫描完成,发现 ${findings.length} 项(HIGH ${high.length})`);
const CLS = { A: "死控件", B: "页头动作错配", C: "详情页链全局", E: "persist 水合门", F: "版本漂移", G: "凭据反模式", H: "绕 Maker-Checker", I: "操作列对齐规则" };
for (const f of findings) console.log(`  ${f.sev === "HIGH" ? "✗" : "·"} [${f.cls} ${CLS[f.cls]}] ${f.file}\n      ${f.msg}`);
if (high.length) { console.log(`\n✗ 交互完整性 FAIL — ${high.length} 项 HIGH 需修复(修后或显式 // audit-ok:* 豁免)`); process.exit(1); }
console.log("✓ 交互完整性 PASS — 无 HIGH 残留");
process.exit(0);
