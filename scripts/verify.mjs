/**
 * admin-ops 完成门 runner:类型检查、静态检查和生产构建,不含测试。
 *
 * 🔴 **run-all,不 fail-fast**(2026-08-17 主人签字的分档提案 T7)。
 *   从前第一个红齿就 `process.exit`,于是:① 后面的齿一次都没跑,而输出看起来只是「某齿失败」;
 *   ② 收尾汇总(那段专门用来喊「跳过≠放宽」的字)**永远打不出来**。现在每个齿都跑完,
 *   逐齿记 PASS / FAIL / SKIP / SCOPED-SKIP / NOT-RUN + 耗时,收尾一次性摊开,
 *   **退出码非零 ⟺ 有 FAIL 或 NOT-RUN**(SKIP 是环境事实,SCOPED-SKIP 是档位选择,都不改退出码)。
 *
 * 档位(默认 full):
 *   · `--static` / `VERIFY_MODE=static` —— 只跳「重齿」(生产构建),记 SCOPED-SKIP。**scoped 绿 ≠ 全量绿**,合并守卫只认 mode=full。
 *   · `--only <齿名子串>` —— 调试用,未命中的齿记 NOT-RUN(所以 --only 必然非零退出,不会被误当成绿)。
 *
 * 落盘(三份,给不同读者):
 *   · `.verify-exit.code`   —— 真实退出码(防管道吞码,见下方 process.on("exit"))。
 *   · `.verify-chain.code`  —— 第 1 行退出码,第 2 行一行式计数,给脚本 / agent 扫。
 *   · `.verify-cache/last-run.json` —— 给合并守卫 `.claude/hooks/verify-fresh-before-merge.mjs` 读:
 *     它要 mode=full · verdict=pass · treeMoved=false · dirty=false · headTree == 要合的那棵树。
 *     🔴 开跑即写 verdict:"running" 占位 —— 否则半路崩掉时,守卫会拿**上一轮**的 pass 记录放行
 *     (headTree 没变的情况下完全对得上)。「中止 ≠ 判红」这个坑在退出码哨兵上踩过一次,不在这里再踩。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { resolveNexionAppRoot, resolveNexionBackendRoot, resolveNexionPrdRoot } from "./lib/nexion-workspace-paths.mjs";

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";
const npxCmd = isWindows ? "npx.cmd" : "npx";

const argv = process.argv.slice(2);
const mode = argv.includes("--static") || process.env.VERIFY_MODE === "static" ? "static" : "full";
const only = (() => {
  const i = argv.indexOf("--only");
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
})();

// 🔴 退出码哨兵文件:进程无论从哪条路径退出,都把真实退出码原子落盘到 .verify-exit.code。
//   why:调用侧 `npm run verify | tail` 这类管道会吞掉退出码(拿到的是 tail 的 0),
//   「verify 绿」由此被误报过两次(EVOLUTION-LEDGER WF-7/WF-10)——外部判定一律读本文件,
//   不读管道退出码。'exit' 回调里只允许同步写。
process.on("exit", (code) => {
  try { writeFileSync(".verify-exit.code", String(code)); } catch { /* 落盘失败不改变退出语义 */ }
});
// 启动即写占位:防「进程没跑起来/中途被杀,调用侧读到上一轮的 0」——读到 "running" 一律按未完成处理。
try { writeFileSync(".verify-exit.code", "running"); } catch { /* 同上 */ }

/**
 * 🔴 「环境缺件」与「真发现缺陷」必须分开处理(2026-08-05)。
 *
 * 本机没有兄弟仓 `nexion-backend` 时,依赖它的齿轮在 **import 期**就抛错。当年 `run()` 还是
 * fail-fast(一遇非零退出码就 `process.exit`),整条链在第 14 齿断掉 —— **后面 19 个齿一次都没跑过**,
 * 而输出看起来只是「某个齿失败了」。实测:改后台代码后想验证,拿不到 15-33 齿的任何信号。
 * (fail-fast 本身已于 2026-08-17 改成 run-all,见文件抬头;下面这套分类**照旧必要** ——
 *  它决定一个红齿是记 SKIP 还是记 FAIL,也就是决定退出码。)
 *
 * 处置:开跑前先探仓;缺仓就把依赖它的齿**显式标记为跳过并继续**,收尾大声列出跳了哪些。
 * 🔴 **不是放宽判据**:跳过的齿会被逐条打印,且「跳过」与「通过」在收尾里分开计数 ——
 * 谁都不该把「verify 绿」误读成「33 个齿全跑了」。仓在的机器上行为完全不变。
 */
// 🔴 探仓走**现成的解析器**,不在这里另抄一份候选路径(2026-08-05 独立验收 P2-18):
//   抄一份的话今天两边一致、将来解析规则一改就静默分叉 —— 探测说「有」而齿轮说「没有」,
//   或者反过来跳过了本该跑的齿。解析器缺仓时是**抛错**(那是它对调用方的正确契约),
//   所以这里用 try/catch 把「抛错」翻译成「不存在」,而不是复制它的路径列表。
const present = (resolve) => {
  try { resolve({ adminRoot: process.cwd() }); return true; } catch { return false; }
};
/**
 * 🔴 依赖的兄弟仓**不止一个**,而且**不能靠手写齿名清单**(2026-08-05 独立验收 P0 + 红测)。
 *
 *   上一版是「手写 NEEDS_BACKEND 齿名集合」。两处都塌了:
 *   ① 新加的跨仓齿改读 Nexion-uniapp,清单里没有它 → 缺仓机器上整链在该齿断掉;
 *   ② 红测把 uniapp 仓指向不存在的路径后,链其实断在**更早**的第 15 齿
 *      `App storage-key parity` —— 那是**早就存在**的齿,同样读 uniapp 仓,
 *      而手写清单从来没收录过它。后面 20 个齿一次都没跑。
 *
 *   实测 ground truth:提到 nexion-backend 的脚本/测试有 30+ 个,而本机实际只有 7 个
 *   真的因缺仓而炸 —— 所以**「按提及派生清单」会过度跳过**,比漏跳更糟(静默少跑 20 多个齿)。
 *
 *   故改成**检测而非预测**:照常跑,齿真的非零退出时,再看它的输出是不是
 *   「缺兄弟仓」的特征错误(解析器的两句报错,或 ENOENT 命中该仓目录名)。
 *   是 → 记进跳过台账并继续;不是 → 照旧 exit。这条判据没有清单可漂移,
 *   也不会把真缺陷误判成环境问题(真缺陷不会报「找不到那个仓」)。
 */
const SIBLING_REPOS = [
  {
    name: "nexion-backend",
    envKey: "NEXION_BACKEND_ROOT",
    hint: "克隆该仓到 ../nexion-backend",
    ok: present(resolveNexionBackendRoot),
    // 解析器报错句 + 裸 readFileSync 的 ENOENT 都要认(不是所有齿都走解析器)
    signature: /未找到 Nexion Backend 项目|NEXION_BACKEND_ROOT 配置的.*不存在|ENOENT[^\n]*nexion-backend/i,
  },
  {
    name: "Nexion-uniapp",
    envKey: "NEXION_APP_ROOT",
    hint: "克隆该仓到 ../Nexion-uniapp",
    ok: present(resolveNexionAppRoot),
    signature: /未找到 Nexion App 项目|NEXION_APP_ROOT 配置的.*不存在|ENOENT[^\n]*(Nexion-uniapp|NX1\.0)/i,
  },
  {
    // 工作区文档面(PRD/)不是 git 仓,但对本仓一样是「可能不在这台机器上」的外部依赖:
    // 只 clone admin-ops 的机器没有它,而读它的齿若硬崩,其后所有本地齿一个都跑不到。
    name: "PRD 工作区文档面",
    envKey: "NEXION_PRD_ROOT",
    hint: "把工作区 PRD/ 放到 ../PRD",
    ok: present(resolveNexionPrdRoot),
    signature: /未找到 Nexion PRD 文档面|NEXION_PRD_ROOT 配置的.*不存在/,
  },
];
/** 所有兄弟仓都在时行为与从前**逐字节一致**(仍走 stdio:inherit 流式输出)。 */
const anyRepoMissing = SIBLING_REPOS.some((r) => !r.ok);
const skipped = [];

function run(label, command, args, gearName) {
  console.log(`== ${label} ==`);
  const executable = isWindows && command.endsWith(".cmd") ? "cmd.exe" : command;
  const finalArgs = isWindows && command.endsWith(".cmd") ? ["/d", "/s", "/c", command, ...args] : args;
  // 缺仓时才截流(需要读输出来分类);仓齐时保持 inherit,不改变既有观感与实时性。
  const result = spawnSync(executable, finalArgs, {
    cwd: process.cwd(),
    stdio: anyRepoMissing ? ["inherit", "pipe", "pipe"] : "inherit",
    shell: false,
    encoding: anyRepoMissing ? "utf8" : undefined,
  });
  if (anyRepoMissing) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
  }
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    return { status: "pass" };
  }
  const missing = SIBLING_REPOS.find((r) => !r.ok && r.signature.test(out));
  if (missing) {
    console.log(`   ⏭  SKIPPED — 本机无兄弟仓 ${missing.name}(设 ${missing.envKey} 可指定)`);
    skipped.push({ gear: gearName, repo: missing.name });
    return { status: "skip", reason: `缺兄弟仓 ${missing.name}` };
  }
  // 🔴 这里从前是 `process.exit(result.status ?? 1)`。改成记账后继续 —— 一个红齿不再让后面几十道门失声。
  const why = result.status === null ? `进程未正常退出${result.error ? `:${result.error.message}` : ""}` : `退出码 ${result.status}`;
  console.log(`   ❌ FAIL — ${why}`);
  return { status: "fail", reason: why };
}

/**
 * `--static` 档跳过的「重齿」判据:生产构建(next build,本机 1-2 分钟,占全链大头)。
 */
function isHeavyGear([, cmd, args]) {
  const line = [cmd, ...args].join(" ");
  return /\brun\s+(build|dev|start)\b/.test(line) || /\bnext\s+(build|dev|start)\b/.test(line);
}

/** git 读命令(只读,失败返回 null —— 拿不到就把记录里的对应字段留空,不编)。 */
const repoRoot = (() => {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : process.cwd();
})();
const git = (args, input) => {
  const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? (r.stdout ?? "") : null;
};

/** 工作树里所有「与 HEAD 不一致」的路径(含未跟踪;-z 免去引号转义歧义,重命名的原路径也收)。 */
function dirtyPaths() {
  const out = git(["status", "--porcelain", "-z", "--untracked-files=all"]);
  if (out === null) return null;
  const fields = out.split("\0");
  const paths = [];
  for (let i = 0; i < fields.length; i += 1) {
    const f = fields[i];
    if (!f) continue;
    const xy = f.slice(0, 2);
    paths.push(f.slice(3));
    if (xy[0] === "R" || xy[0] === "C") { i += 1; if (fields[i]) paths.push(fields[i]); }
  }
  return [...new Set(paths)].sort();
}

/**
 * 工作树指纹:干净时就是 HEAD 的树对象;脏时是 sha256(headTree + 逐个脏文件的 "路径:blob 哈希")。
 * 用途只有一个 —— 比开跑前 / 跑完后两次指纹,判「这一轮跑的到底是不是同一棵树」。
 * 已删除的文件哈希不出来,记 `<gone>`(它也是一种差异,不能当不存在)。
 */
function fingerprint(headTree, paths) {
  if (paths === null) return null;
  if (paths.length === 0) return headTree;
  const alive = paths.filter((p) => existsSync(path.join(repoRoot, p)));
  const hashes = new Map();
  if (alive.length > 0) {
    const lines = (git(["hash-object", "--stdin-paths"], `${alive.join("\n")}\n`) ?? "").trim().split(/\r?\n/).filter(Boolean);
    alive.forEach((p, i) => hashes.set(p, lines[i] ?? "?"));
  }
  const h = createHash("sha256");
  h.update(String(headTree));
  for (const p of paths) h.update(`\n${p}:${hashes.get(p) ?? "<gone>"}`);
  return h.digest("hex");
}

const CACHE_DIR = path.join(repoRoot, ".verify-cache");
/** 合并守卫读的那份记录。开跑写 running 占位,收尾覆盖成真结论(理由见文件抬头)。 */
function writeRecord(record) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(path.join(CACHE_DIR, "last-run.json"), `${JSON.stringify(record, null, 2)}\n`);
  } catch { /* 落盘失败不改变退出语义;守卫读不到会自己判「没跑过」 */ }
}

// 🔴 rev-parse 的输出必须 trim:合并守卫是 `rec.headTree !== refTree` **全等**比较,而它那边的
//   git 包装器是 trim 过的 —— 这里留个尾换行,守卫就永远对不上,于是「跑绿了也不许合」。
//   (`git()` 本身不 trim:`status --porcelain -z` 的首字符可能就是个有意义的空格,如 " M path"。)
const headTree = git(["rev-parse", "HEAD^{tree}"])?.trim() ?? null;
const head = git(["rev-parse", "HEAD"])?.trim() ?? null;
const dirtyStart = dirtyPaths();
const fpStart = fingerprint(headTree, dirtyStart);
const startedAt = Date.now();
writeRecord({
  mode, verdict: "running", treeMoved: false, tree: null, headTree, dirty: dirtyStart === null ? null : dirtyStart.length > 0,
  head, at: new Date(startedAt).toISOString(), totalMs: 0, steps: [],
});

// 齿轮表:序号自动派生(新增/重排齿轮不再手工改 [x/N])。本机注意:channel-parity 起的后端依赖齿轮
// 硬读兄弟仓 nexion-backend,缺仓环境链在该齿断(memory: nexion-backend-not-in-workspace)。
const GEARS = [
  ["typecheck", npxCmd, ["--no-install", "tsc", "--noEmit"]],
  ["runtime mock import guard", "node", ["scripts/check-runtime-mock-imports.mjs"]],
  ["admin auth gate sentinel", "node", ["scripts/admin-auth-gate-sentinel.mjs"]],
  ["canon sentinel", "node", ["scripts/canon-sentinel.mjs"]],
  ["interaction audit", "node", ["scripts/admin-interaction-audit.mjs"]],
  ["M support surface audit", "node", ["scripts/admin-support-surface-audit.mjs"]],
  ["Support profile static filled-block border", "node", ["scripts/inner-block-no-border-sentinel.mjs", "--support-profile"]],
  ["CGM field coverage", "node", ["scripts/cgm-coverage.mjs"]],
  ["no-double-sign residue", "node", ["scripts/no-double-sign-terms.mjs"]],
  ["ops-actions integrity", "node", ["scripts/ops-actions-audit.mjs"]],
  ["modal contract", "node", ["scripts/admin-modal-contract-audit.mjs"]],
  ["list capability", "node", ["scripts/admin-list-capability-audit.mjs"]],
  ["App storage-key parity", "node", ["scripts/uni-storage-key-sentinel.mjs"]],
  // H9 对外公布数据:同一份配置散在「规格 ③ / 前端 PublicStatsConfig / 后台 H9_FIELDS」三处,
  // 键少一个 = 运营改不到的死配置,值域抄错 = 前端收到自己判非法的值。tsc 一处都拦不住。
  // (硬读兄弟仓 Nexion-uniapp —— 该仓在本机存在,故留在前段;缺 nexion-backend 的齿见文件末尾。)
  ["H9 public-stats cross-repo parity", "node", ["scripts/h9-public-stats-parity.mjs"]],
  ["kill-switch sentinel", "node", ["scripts/kill-switch-count-sentinel.mjs"]],
  ["rhythm sentinel", "node", ["scripts/rhythm-single-source-sentinel.mjs"]],
  ["A2 coverage sentinel", "node", ["scripts/a2-audit-coverage-sentinel.mjs"]],
  ["in-memory idempotency-key sentinel", "node", ["scripts/pending-idempotency-key-sentinel.mjs"]],
  ["endpoint citation ledger", "node", ["scripts/endpoint-citation-sentinel.mjs"]],
  // 提现单主键线上真名(`withdrawalNo`)在 PRD 与 admin 实现之间的 parity:后台 PRD 一度写成
  // `withdrawalId`,错了很久没人发现 —— 手工改完 18 处但没有任何机器判据锁住它。真名从
  // d-client.ts 派生,整棵 PRD 树逐处核。
  ["withdrawal key-name parity", "node", ["scripts/withdrawal-key-parity.mjs"]],
  ["error-copy throat sentinel", "node", ["--experimental-strip-types", "scripts/error-copy-throat-sentinel.mjs"]],
  // 生产构建必须排在依赖兄弟仓 nexion-backend 的齿**之前**:它是最贵也最有价值的本地齿,
  // 排在后面等于在缺仓机器上永远跑不到,完成门要求的「verify 全绿(含 production build)」会结构性不可达。
  ["production build", npmCmd, ["run", "build"]],
  // ↓↓↓ 以下齿轮硬读兄弟仓 nexion-backend。缺仓的机器(本机即是)会在第一条硬崩,
  //     而 run() 是 fail-fast —— 所以它们必须集中排在**最后**,否则其后的本地齿全部执行不到。
  //     2026-08-06 前它们散在中段,导致其后 21 道本可运行的门在本机从未跑过。
  ["real recharge-channel parity", "node", ["scripts/channel-parity-sentinel.mjs"]],
  ["FE/BE mapping closure ratchet", "node", ["scripts/fe-be-mapping-coverage.mjs"]],
];
// 🔴 run-all:每个齿都跑到,逐齿记状态与耗时。红齿不再中断链条(理由见文件抬头)。
const results = [];
GEARS.forEach((gear, index) => {
  const [label, cmd, args] = gear;
  const n = index + 1;
  const head = `[${n}/${GEARS.length}] ${label}`;
  // --only 的干草堆 = 齿名 + 它真正跑的那条命令。只匹齿名不够用:齿名是中英混排的人话
  // (「App storage-key parity」),而调试时手边有的往往是脚本文件名(uni-storage-key-sentinel.mjs)。
  if (only && ![label, cmd, ...args].join(" ").toLowerCase().includes(only.toLowerCase())) {
    results.push({ n, label, status: "not-run", ms: 0, reason: `--only ${only} 未命中` });
    return;
  }
  if (mode === "static" && isHeavyGear(gear)) {
    console.log(`== ${head} ==`);
    console.log("   ⏭  SCOPED-SKIP — --static 档不跑重齿;要它的结论请跑全量 npm run verify");
    results.push({ n, label, status: "scoped-skip", ms: 0, reason: "--static 档不跑重齿" });
    return;
  }
  const t = Date.now();
  const r = run(head, cmd, args, label);
  results.push({ n, label, status: r.status, ms: Date.now() - t, reason: r.reason });
});

const totalMs = Date.now() - startedAt;
const of = (s) => results.filter((r) => r.status === s);
const counts = { pass: of("pass").length, fail: of("fail").length, skip: of("skip").length, scoped: of("scoped-skip").length, notRun: of("not-run").length };
const ran = counts.pass + counts.fail;
// 🔴 退出码非零 ⟺ 有 FAIL 或 NOT-RUN。SKIP(环境缺件)与 SCOPED-SKIP(档位)不改退出码,
//   但下面会被逐条列出 —— 「跳过 ≠ 放宽」靠的是**看得见**,不是靠把它算成红。
const exitCode = counts.fail > 0 || counts.notRun > 0 ? 1 : 0;

const NAME = { pass: "PASS", fail: "FAIL", skip: "SKIP", "scoped-skip": "SCOPED-SKIP", "not-run": "NOT-RUN" };
const secs = (ms) => (ms > 0 ? `${(ms / 1000).toFixed(1)}s` : "–");
const width = Math.max(...results.map((r) => r.label.length));
console.log(`\n────── verify 汇总(mode=${mode}${only ? ` · --only ${only}` : ""})──────`);
for (const r of results) {
  console.log(
    `  ${NAME[r.status].padEnd(11)} [${String(r.n).padStart(2)}/${GEARS.length}] ${r.label.padEnd(width)}  ${secs(r.ms)}`,
  );
}
console.log(`  ── PASS ${counts.pass} · FAIL ${counts.fail} · SKIP ${counts.skip} · SCOPED-SKIP ${counts.scoped} · NOT-RUN ${counts.notRun} / ${GEARS.length}  ·  用时 ${(totalMs / 1000).toFixed(1)}s`);

if (counts.fail > 0) {
  console.log(`\n❌ FAIL(${counts.fail} 个,必须修):`);
  for (const r of of("fail")) console.log(`     [${r.n}/${GEARS.length}] ${r.label}  ←  ${r.reason}`);
}
if (counts.notRun > 0) {
  console.log(`\n🚫 NOT-RUN(${counts.notRun} 个,**没跑**,结论不存在):`);
  // --only 调试时 NOT-RUN 动辄六十几条、理由还全一样,全列出来只是把真信号刷走 ——
  // 逐条状态上面的表里一条不少,这里只留头 10 条 + 一行尾数。FAIL 不设上限(见上)。
  for (const r of of("not-run").slice(0, 10)) console.log(`     [${r.n}/${GEARS.length}] ${r.label}  ←  ${r.reason}`);
  if (counts.notRun > 10) console.log(`     …还有 ${counts.notRun - 10} 个(逐条见上表)`);
}
if (counts.scoped > 0) {
  console.log(`\n⏭  SCOPED-SKIP(${counts.scoped} 个,**没跑**,不是通过):`);
  for (const r of of("scoped-skip")) console.log(`     [${r.n}/${GEARS.length}] ${r.label}  ←  ${r.reason}`);
  console.log("   🔴 --static 绿只买内循环速度;宣布 done / 合并主线要的是全量档绿(合并守卫只认 mode=full)。");
}
// 🔴 收尾必须把「跳过」单独说清楚,且不能只在中间刷屏一行就算 —— 这道汇总正是为了
//   防止「verify 绿」被误读成「全部齿都跑了」。跳过数 > 0 时,这段是最后可见的输出。
if (skipped.length > 0) {
  console.log(`\n⚠️  ${skipped.length}/${GEARS.length} 个齿轮**未运行**(环境缺件,非缺陷):`);
  for (const s of skipped) console.log(`     ⏭  ${s.gear}  ←  缺 ${s.repo}`);
  // 原因按仓分组列 —— 上一版把原因写死成 nexion-backend 一行,第二个兄弟仓加进来时
  // 台账会指着错误的仓让人去克隆(2026-08-05 独立验收 P0 的同族)。
  for (const r of SIBLING_REPOS) {
    if (r.ok || !skipped.some((s) => s.repo === r.name)) continue;
    console.log(`   原因:本机无兄弟仓 ${r.name}。要跑齐,${r.hint} 或设 ${r.envKey}。`);
  }
  console.log(`   🔴 在这台机器上「verify 通过」只覆盖 ${ran} 个齿,涉及跨仓契约的结论不成立。`);
}

// 🔴 结论必须落到**机器可读**的信号上(2026-08-05 独立验收 P1-11)。
//   只改人读的告警行不够:CI / 脚本 / 另一个 agent 看的是 stdout 末行与退出码,
//   它们照旧收到「verify OK」+ exit 0,于是「26/33」被当成「33/33」继续往下走。
//   末行三态:红 / 有跳过(exit 0,但没设 NEXION_VERIFY_ALLOW_SKIP 就标 DEGRADED)/ 全绿。
if (exitCode !== 0) {
  console.log(`\nverify FAILED (mode=${mode}, ${counts.fail} fail, ${counts.notRun} not-run, ${ran}/${GEARS.length} gears ran)`);
} else if (skipped.length > 0 || counts.scoped > 0) {
  const acknowledged = process.env.NEXION_VERIFY_ALLOW_SKIP === "1";
  const tail = `mode=${mode}, ${ran}/${GEARS.length} gears ran, ${skipped.length} skipped, ${counts.scoped} scoped-skipped`;
  console.log(acknowledged ? `verify OK (${tail}, acknowledged)` : `verify DEGRADED (${tail}) — 设 NEXION_VERIFY_ALLOW_SKIP=1 表示已知悉`);
} else {
  console.log(`\n✅ verify 完成:${GEARS.length}/${GEARS.length} 个齿轮全部运行。`);
  console.log(`verify OK (mode=${mode}, ${GEARS.length}/${GEARS.length} gears)`);
}

// ── 落盘:给合并守卫与脚本读的两份记录(人读的已经打在上面了)。
const dirtyEnd = dirtyPaths();
const fpEnd = fingerprint(headTree, dirtyEnd);
const treeMoved = fpStart === null || fpEnd === null || fpStart !== fpEnd;
writeRecord({
  // --only 调试跑不是任何一档的覆盖面:记 "partial",守卫只认 "full"(tester-C 观察 2:此前记 full+fail 虽安全但命名歧义)
  mode: only ? "partial" : mode,
  verdict: exitCode === 0 ? "pass" : "fail",
  treeMoved,
  tree: treeMoved ? null : fpEnd,
  headTree,
  // dirty 取**开跑时**的工作树状态(那才是这一轮真正验的东西);跑的过程中变了由 treeMoved 兜住。
  dirty: dirtyStart === null ? null : dirtyStart.length > 0,
  head,
  at: new Date(startedAt).toISOString(),
  totalMs,
  steps: results.map((r) => ({ step: r.label, status: r.status, ms: r.ms })),
});
try {
  writeFileSync(path.join(repoRoot, ".verify-chain.code"),
    `${exitCode}\nmode=${mode} pass=${counts.pass} fail=${counts.fail} skip=${counts.skip} scoped_skip=${counts.scoped} not_run=${counts.notRun} tree=${treeMoved ? "moved" : String(fpEnd ?? "?").slice(0, 12)}\n`);
} catch { /* 同 .verify-exit.code:落盘失败不改变退出语义 */ }

process.exit(exitCode);

