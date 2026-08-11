/**
 * 红测:提现单主键字段名 parity 门(scripts/withdrawal-key-parity.mjs)。
 *
 * 规矩(沿用 _redtest-idem-hardening.mjs,踩过的坑都在里面):
 *   - **按合取项逐个隔离**:每次注入只破坏一个判据,其余保持合法;一发打红多个条件时,
 *     那次只能算验了「最先失败的那一项」,所以同一种漂移拆成几条分别注入。
 *   - 还原走「.redtest-bak 副本 + finally」+ 内容指纹复核,**禁 git checkout**。
 *   - 反误红绿测与打红用例同等重要:门太紧会把合法写作挡死。
 *
 * 🔴 PRD 侧的注入**不碰工作区真文件**:先把 PRD 的 .md 树复制到临时沙箱,再用门自己支持的
 *   `NEXION_PRD_ROOT` 指过去。why:写这道门时实测有另一个会话正在改同一批 PRD 文档,
 *   在真文件上注入-还原会跟它对写,还原那一刻就把对方的改动抹掉了。
 *
 * 🔴 常驻,不是一次性脚本:**改动这道门的判据后必须重跑**。不挂进 verify(它会临时改写
 *   源文件,并行跑互相踩)—— 由 tests/redtest-harness-selfcheck.test.mjs 守住它还活着。
 *   手动跑:node scripts/_redtest-withdrawal-key-parity.mjs
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNexionPrdRoot } from "./lib/nexion-workspace-paths.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const GATE = ["scripts/withdrawal-key-parity.mjs"];
const D_CLIENT = path.join(ROOT, "lib/admin/d-client.ts");

// ── 两张消费面各造一个沙箱:把 .md 树原样复制一份,注入全在副本上做 ────────────────
const SANDBOX_ROOT = mkdtempSync(path.join(os.tmpdir(), "nexion-wdkey-"));
let copied = 0;
function copyMd(from, to) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name.startsWith("_bak") || e.name === "node_modules") continue;
    if (e.isDirectory() && /snapshot/i.test(e.name)) continue;   // 与门的 walk 同规则
    if (e.isDirectory()) copyMd(path.join(from, e.name), path.join(to, e.name));
    else if (e.name.endsWith(".md")) { copyFileSync(path.join(from, e.name), path.join(to, e.name)); copied += 1; }
  }
  return to;
}
const SANDBOX = copyMd(resolveNexionPrdRoot({ adminRoot: ROOT }), path.join(SANDBOX_ROOT, "PRD"));
const DOCS_SANDBOX = copyMd(path.join(ROOT, "docs"), path.join(SANDBOX_ROOT, "docs"));

const P_V1 = path.join(SANDBOX, "NexGrid_运营控制后台PRD_v1.md");
const P_V37 = path.join(SANDBOX, "NexGrid_产品功能架构设计文档_v3.7.md");
const M_V1 = path.join(DOCS_SANDBOX, "PRD", "Nexion_运营控制后台PRD_v1.md");

/** 跑门,返回 { red, output }。输出必须带回来:只看退出码时「红对了但理由不对」会显示 ✓。 */
function gate(args) {
  const env = { ...process.env, NEXION_PRD_ROOT: SANDBOX, NEXION_ADMIN_DOCS_ROOT: DOCS_SANDBOX };
  try {
    return { red: false, output: execFileSync("node", args, { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" }) ?? "" };
  } catch (error) {
    return { red: true, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/**
 * 注入 → 跑门 → 无论如何还原。锚点不存在、或注入没改变内容时 throw:红测本身失效必须暴露。
 * specs: { file, subs: [[from, to], ...], all? } 或它的数组(同一个文件只许出现一次)。
 */
function inject(specs, args) {
  const list = Array.isArray(specs) ? specs : [specs];
  const seen = new Set(list.map((s) => s.file));
  if (seen.size !== list.length) throw new Error("同一文件在一次注入里出现多次:备份会覆盖成被改过的内容");
  const baks = list.map(({ file }) => { const bak = `${file}.redtest-bak`; copyFileSync(file, bak); return [bak, file]; });
  try {
    for (const { file, subs, all } of list) {
      const orig = readFileSync(file, "utf8");
      let src = orig;
      for (const [from, to] of subs) {
        if (!src.includes(from)) throw new Error(`注入锚点不存在,红测本身失效:${path.basename(file)} ← ${from.slice(0, 60)}`);
        // 替换串用函数形式 —— 字符串形式里的 $& 会被当成整个匹配回填(踩过)。
        src = all ? src.split(from).join(to) : src.replace(from, () => to);
      }
      // 🔴 空注入守卫:from === to 时这一条只是「在原样的树上跑一遍门」,零判别力却照样打 ✓。
      if (src === orig) throw new Error(`空注入(内容没变),该用例没有判别力:${path.basename(file)}`);
      writeFileSync(file, src);
    }
    return gate(args);
  } finally {
    for (const [bak, file] of baks) { copyFileSync(bak, file); unlinkSync(bak); }
  }
}

const V37_ANCHOR = "返 **`withdrawalNo`**;失败回滚 NEX";

/** expect: "red"(注入必须打红)或 "green"(合法写作不得误红)。 */
const CASES = [
  // ══ ① PRD 主键点改回旧名 ═════════════════════════════════════════
  ["T1 PRD 主键点写成 `withdrawalId`(挑非基数台账的文档,隔离 token 判据)", "red",
    () => inject({ file: P_V37, subs: [[V37_ANCHOR, "返 **`withdrawalId`**;失败回滚 NEX"]] }, GATE),
    "指代提现单主键"],

  ["T1b 否定词在场但没点出真名(`withdrawalId` 不是可选字段)→ 不许当说明句放行", "red",
    () => inject({ file: P_V37, subs: [[V37_ANCHOR, "返 **`WD 单号`**(`withdrawalId` 不是可选字段);失败回滚 NEX"]] }, GATE),
    "指代提现单主键"],

  // ══ ② 合法的批量入参被"改正"成主键名 ═══════════════════════════════
  ["T2a 批量入参 `withdrawalIds` → `withdrawalNos`(它是线上真名,改了就是错)", "red",
    () => inject({ file: P_V1, subs: [["{ action, withdrawalIds:[], reason }", "{ action, withdrawalNos:[], reason }"]] }, GATE),
    "指代提现单主键"],
  ["T2b 批量入参数组写成主键真名 `withdrawalNo:[]`(token 判据放行,隔离形状判据)", "red",
    () => inject({ file: P_V1, subs: [["{ action, withdrawalIds:[], reason }", "{ action, withdrawalNo:[], reason }"]] }, GATE),
    "批量入参数组写成"],

  // ══ ③ conflicts[] 成员被改 ════════════════════════════════════════
  ["T3a `conflicts[].withdrawalId` 改成主键真名(token 判据放行,隔离形状判据)", "red",
    () => inject({ file: P_V1, subs: [["conflicts[].withdrawalId", "conflicts[].withdrawalNo"]] }, GATE),
    "冲突回传项写成"],
  ["T3b `conflicts[].X` 声明被整体删除(删除向)", "red",
    () => inject({ file: P_V1, all: true, subs: [["conflicts[].withdrawalId", "该端点自有冲突项"]] }, GATE),
    "冲突回传项真名的声明被删了"],

  // ══ ④ 删除向:门集体对"少了一行"是盲的,单独测 ═══════════════════════
  ["T4a 删掉一整处主键行(基数台账判据)", "red",
    () => inject({ file: P_V1, subs: [["1. **信息区**:withdrawalNo / userId(链 C1)", "1. **信息区**:userId(链 C1)"]] }, GATE),
    "低于台账基数"],
  ["T4b 主键宣告行被改掉(结构锚判据)", "red",
    () => inject({ file: P_V1, subs: [["**单笔主键线上真名 = ", "**该单据主键线上真名 = "]] }, GATE),
    "找不到主键宣告行"],

  // ══ ⑤ admin 代码侧改名 ═══════════════════════════════════════════
  ["T5a 代码只改 interface 字段名(载荷不再带主键)", "red",
    () => inject({ file: D_CLIENT, subs: [["  withdrawalNo: string;", "  withdrawalRef: string;"]] }, GATE),
    "探针失效"],
  ["T5b 代码只改单笔寻址参数名(寻址与载荷对不上)", "red",
    () => inject({ file: D_CLIENT, subs: [["fetchD2WithdrawalDetail(withdrawalNo: string)", "fetchD2WithdrawalDetail(withdrawalRef: string)"]] }, GATE),
    "探针失效"],
  ["T5c 代码一致改名(探针照过 → 必须由 parity 判据打红,不能靠探针兜)", "red",
    () => inject({
      file: D_CLIENT,
      subs: [
        ["  withdrawalNo: string;", "  withdrawalRef: string;"],
        ["fetchD2WithdrawalDetail(withdrawalNo: string)", "fetchD2WithdrawalDetail(withdrawalRef: string)"],
        ["`/withdrawals/${encodeURIComponent(withdrawalNo)}`))", "`/withdrawals/${encodeURIComponent(withdrawalRef)}`))"],
      ],
    }, GATE),
    "主键真名在文档里已彻底消失"],

  // ══ ⑥ 镜像面(admin 仓 docs/PRD 里的同名副本)——回流风险的那一侧 ══════════
  ["T6a 镜像里的主键点写成 `withdrawalId`(工作区那张仍是绿的)", "red",
    () => inject({ file: M_V1, subs: [["1. **信息区**:withdrawalNo / userId(链 C1)", "1. **信息区**:withdrawalId / userId(链 C1)"]] }, GATE),
    "指代提现单主键"],
  ["T6b 镜像丢掉主键宣告(下次拿它当底稿同步回去就把决议带走了)", "red",
    () => inject({ file: M_V1, subs: [["**单笔主键线上真名 = ", "**该单据主键线上真名 = "]] }, GATE),
    "找不到主键宣告行"],

  // ══ 反误红:合法写作不得被挡 ═══════════════════════════════════════
  ["G1 新增一处合法的 `withdrawalNo` 说明 → 不得误红", "green",
    () => inject({ file: P_V37, subs: [[V37_ANCHOR, "返 **`withdrawalNo`**(单笔主键 `withdrawalNo` 由 server mint);失败回滚 NEX"]] }, GATE)],
  ["G2 用否定式说明保留旧名(旧名 `withdrawalId` 已废弃)→ 不得误红", "green",
    () => inject({ file: P_V37, subs: [[V37_ANCHOR, "返 **`withdrawalNo`**(旧名 `withdrawalId` 已废弃);失败回滚 NEX"]] }, GATE)],
  ["G3 别的 withdrawal* 字段(`withdrawalIntentId`)不得被误伤", "green",
    () => inject({ file: P_V37, subs: [[V37_ANCHOR, "返 **`withdrawalNo`**(另见 `withdrawalIntentId`);失败回滚 NEX"]] }, GATE)],
];

let failed = 0;
try {
  // ── 已知答案基线:原样的沙箱必须是绿的,否则后面每一条"红了"都说明不了问题 ──
  const base = gate(GATE);
  if (base.red) {
    console.error(`✗ 基线不绿(沙箱 ${copied} 份 .md(两张面)),红测本身失效:\n${base.output.trim()}`);
    process.exit(1);
  }
  console.log(`基线:沙箱 ${copied} 份 .md(两张面),门为绿 ✅\n`);

  // 🔴 还原完整性走**内容指纹**:被注入的文件本来就可能处在 ` M` 状态,只看 git 看不出没还原。
  const touched = [D_CLIENT, P_V1, P_V37, M_V1];
  const digest = () => touched.map((f) => createHash("sha1").update(readFileSync(f)).digest("hex")).join(" ");
  const before = digest();

  for (const [name, expect, run, expectText] of CASES) {
    const { red, output } = run();
    let ok = expect === "red" ? red : !red;
    let note = "";
    // 红对了还得**红在正确的判据上**:门自己崩掉、或红在无关条目上,都不算验到。
    if (ok && expect === "red" && expectText && !output.includes(expectText)) {
      ok = false;
      note = `  ← 红了,但不是因为「${expectText}」(实际:${output.trim().split("\n").slice(-1)[0]?.slice(0, 100)})`;
    }
    if (!ok) failed += 1;
    console.log(`${ok ? "✓" : "✗"} [期望${expect === "red" ? "红" : "绿"}] ${name}${ok ? "" : (note || "  ← 与期望不符")}`);
  }

  if (digest() !== before) {
    console.error("✗ 被注入的文件内容没有逐字节还原 —— 后续门会验到被污染的树");
    failed += 1;
  }
  const strays = execFileSync("git", ["status", "--porcelain", "--", "scripts", "lib"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter((line) => line.includes(".redtest-bak"));
  if (strays.length) { console.error(`✗ 残留备份文件:${strays.join(" ")}`); failed += 1; }
} finally {
  rmSync(SANDBOX_ROOT, { recursive: true, force: true });
}

console.log(failed ? `\n红测未通过:${failed} 项与期望不符` : `\n红测全部按预期(${CASES.length} 项:红 ${CASES.filter((c) => c[1] === "red").length} / 绿 ${CASES.filter((c) => c[1] === "green").length})`);
process.exit(failed ? 1 : 0);
