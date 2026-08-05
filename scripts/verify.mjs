import { spawnSync } from "node:child_process";
import { resolveNexionAppRoot, resolveNexionBackendRoot } from "./lib/nexion-workspace-paths.mjs";

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";
const npxCmd = isWindows ? "npx.cmd" : "npx";

/**
 * 🔴 「环境缺件」与「真发现缺陷」必须分开处理(2026-08-05)。
 *
 * 本机没有兄弟仓 `nexion-backend` 时,依赖它的齿轮在 **import 期**就抛错;而 `run()`
 * 一遇非零退出码就 `process.exit`,于是整条链在第 14 齿断掉 —— **后面 19 个齿一次都没跑过**,
 * 而输出看起来只是「某个齿失败了」。实测:改后台代码后想验证,拿不到 15-33 齿的任何信号。
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
  if (result.status === 0) return;
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const missing = SIBLING_REPOS.find((r) => !r.ok && r.signature.test(out));
  if (missing) {
    console.log(`   ⏭  SKIPPED — 本机无兄弟仓 ${missing.name}(设 ${missing.envKey} 可指定)`);
    skipped.push({ gear: gearName, repo: missing.name });
    return;
  }
  process.exit(result.status ?? 1);
}

// 齿轮表:序号自动派生(新增/重排齿轮不再手工改 [x/N])。本机注意:channel-parity 起的后端依赖齿轮
// 硬读兄弟仓 nexion-backend,缺仓环境链在该齿断(memory: nexion-backend-not-in-workspace)。
const GEARS = [
  ["typecheck", npxCmd, ["--no-install", "tsc", "--noEmit"]],
  ["runtime mock import guard", "node", ["scripts/check-runtime-mock-imports.mjs"]],
  ["admin auth gate sentinel", "node", ["scripts/admin-auth-gate-sentinel.mjs"]],
  ["admin auth gate contract", "node", ["--test", "tests/admin-auth-password-change-gate.test.mjs"]],
  ["workspace path resolver", "node", ["--test", "scripts/nexion-workspace-paths.test.mjs"]],
  ["canon sentinel", "node", ["scripts/canon-sentinel.mjs"]],
  ["interaction audit", "node", ["scripts/admin-interaction-audit.mjs"]],
  ["M support surface audit", "node", ["scripts/admin-support-surface-audit.mjs"]],
  ["CGM field coverage", "node", ["scripts/cgm-coverage.mjs"]],
  ["no-double-sign residue", "node", ["scripts/no-double-sign-terms.mjs"]],
  ["ops-actions integrity", "node", ["scripts/ops-actions-audit.mjs"]],
  ["modal contract", "node", ["scripts/admin-modal-contract-audit.mjs"]],
  ["list capability", "node", ["scripts/admin-list-capability-audit.mjs"]],
  ["real recharge-channel parity", "node", ["scripts/channel-parity-sentinel.mjs"]],
  ["App storage-key parity", "node", ["scripts/uni-storage-key-sentinel.mjs"]],
  // H9 对外公布数据:同一份配置散在「规格 ③ / 前端 PublicStatsConfig / 后台 H9_FIELDS」三处,
  // 键少一个 = 运营改不到的死配置,值域抄错 = 前端收到自己判非法的值。tsc 一处都拦不住。
  ["H9 public-stats cross-repo parity", "node", ["scripts/h9-public-stats-parity.mjs"]],
  // H9 分位表值域**行为级**等价(真跑前端 network-rank + 后台 h9-validation,非子串):
  // 删任何一条校验(cumPct≤100 / 单调不减 / 严格升序)即红,自造更严限制同样红;
  // 附带钉 growth 代理错误文案与占位卡句号拼接。与上一齿同级硬读兄弟仓 Nexion-uniapp。
  ["H9 percentile-table behavior contract", "node", ["--test", "tests/h9-public-stats-contract.test.mjs"]],
  ["D1 channel contract", "node", ["--test", "tests/d1-channel-parity-contract.test.mjs"]],
  ["B4 cross-repository contract", "node", ["--test", "tests/b4-cross-repo-sentinel-contract.test.mjs"]],
  ["FE/BE mapping closure ratchet", "node", ["scripts/fe-be-mapping-coverage.mjs"]],
  ["kill-switch sentinel", "node", ["scripts/kill-switch-count-sentinel.mjs"]],
  ["rhythm sentinel", "node", ["scripts/rhythm-single-source-sentinel.mjs"]],
  ["J1 contract", "node", ["--test", "tests/j1-killswitch-contract.test.mjs"]],
  ["J2 contract", "node", ["--test", "tests/j2-geoblock-contract.test.mjs"]],
  ["K2 contract", "node", ["--test", "tests/k2-arbitrage-contract.test.mjs"]],
  ["K3 contract", "node", ["--test", "tests/k3-withdraw-rules-contract.test.mjs"]],
  ["K4 contract", "node", ["--test", "tests/k4-scoring-contract.test.mjs"]],
  ["K5 contract", "node", ["--test", "tests/k5-kyc-review-contract.test.mjs"]],
  ["A2 coverage sentinel", "node", ["scripts/a2-audit-coverage-sentinel.mjs"]],
  ["G4 invite-code registry contract", "node", ["--test", "tests/g4-invite-registry-contract.test.mjs"]],
  // GEN10b 市场状态开关:此前后台侧一道专属门都没有,前一版的自由输入违规就是这么溜过去的。
  ["G4 market-open-state contract", "node", ["--test", "tests/g4-market-open-state-contract.test.mjs"]],
  // 跨仓 parity 单独成齿 —— 缺 Nexion-uniapp 的机器上它整齿跳过并进台账,
  // 而上面那道后台侧契约照跑(拆分理由见该测试文件抬头)。
  ["G4 market-open-state cross-repo parity", "node", ["--test", "tests/g4-market-open-state-parity.test.mjs"]],
  ["in-memory idempotency-key sentinel", "node", ["scripts/pending-idempotency-key-sentinel.mjs"]],
  ["pending mutation store contract", "node", ["--test", "tests/pending-mutation-store-contract.test.mjs"]],
  ["pending mutation migration contract", "node", ["--test", "tests/pending-mutation-migration-contract.test.mjs"]],
  ["endpoint citation ledger", "node", ["scripts/endpoint-citation-sentinel.mjs"]],
  ["production build", npmCmd, ["run", "build"]],
];
GEARS.forEach(([label, cmd, args], index) => run(`[${index + 1}/${GEARS.length}] ${label}`, cmd, args, label));

// 🔴 收尾必须把「跳过」单独说清楚,且不能只在中间刷屏一行就算 —— 这道汇总正是为了
//   防止「verify 绿」被误读成「33 个齿全跑了」。跳过数 > 0 时,这段是最后可见的输出。
if (skipped.length > 0) {
  console.log(`\n⚠️  verify 完成,但 ${skipped.length}/${GEARS.length} 个齿轮**未运行**(环境缺件,非缺陷):`);
  for (const s of skipped) console.log(`     ⏭  ${s.gear}  ←  缺 ${s.repo}`);
  // 原因按仓分组列 —— 上一版把原因写死成 nexion-backend 一行,第二个兄弟仓加进来时
  // 台账会指着错误的仓让人去克隆(2026-08-05 独立验收 P0 的同族)。
  for (const r of SIBLING_REPOS) {
    if (r.ok || !skipped.some((s) => s.repo === r.name)) continue;
    console.log(`   原因:本机无兄弟仓 ${r.name}。要跑齐,${r.hint} 或设 ${r.envKey}。`);
  }
  console.log(`   🔴 在这台机器上「verify 通过」只覆盖 ${GEARS.length - skipped.length} 个齿,涉及跨仓契约的结论不成立。`);
  // 🔴 结论必须落到**机器可读**的信号上(2026-08-05 独立验收 P1-11)。
  //   只改人读的告警行不够:CI / 脚本 / 另一个 agent 看的是 stdout 末行与退出码,
  //   它们照旧收到「verify OK」+ exit 0,于是「26/33」被当成「33/33」继续往下走。
  //   末行改成带跳过数的形态;退出码保持 0(缺仓是环境事实,不是本仓缺陷),
  //   但要求显式确认才安静 —— 没设 NEXION_VERIFY_ALLOW_SKIP 时把它标成 DEGRADED。
  const acknowledged = process.env.NEXION_VERIFY_ALLOW_SKIP === "1";
  console.log(acknowledged
    ? `verify OK (${skipped.length} skipped, acknowledged)`
    : `verify DEGRADED (${GEARS.length - skipped.length}/${GEARS.length} gears ran, ${skipped.length} skipped) — 设 NEXION_VERIFY_ALLOW_SKIP=1 表示已知悉`);
} else {
  console.log(`\n✅ verify 完成:${GEARS.length}/${GEARS.length} 个齿轮全部运行。`);
  console.log(`verify OK (${GEARS.length}/${GEARS.length} gears)`);
}

