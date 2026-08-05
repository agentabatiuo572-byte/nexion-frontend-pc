import { spawnSync } from "node:child_process";
import { resolveNexionBackendRoot } from "./lib/nexion-workspace-paths.mjs";

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
let backendPresent = true;
try {
  resolveNexionBackendRoot({ adminRoot: process.cwd() });
} catch {
  backendPresent = false;
}
/** 这些齿轮硬读兄弟仓 nexion-backend(标签精确匹配,增删齿轮时同步维护)。 */
const NEEDS_BACKEND = new Set([
  "real recharge-channel parity",
  "D1 channel contract",
  "B4 cross-repository contract",
  "FE/BE mapping closure ratchet",
  "J1 contract",
  "J2 contract",
  "K2 contract",
]);
const skipped = [];

function run(label, command, args, gearName) {
  if (!backendPresent && NEEDS_BACKEND.has(gearName)) {
    console.log(`== ${label} ==\n   ⏭  SKIPPED — 本机无兄弟仓 nexion-backend(设 NEXION_BACKEND_ROOT 可指定)`);
    skipped.push(gearName);
    return;
  }
  console.log(`== ${label} ==`);
  const executable = isWindows && command.endsWith(".cmd") ? "cmd.exe" : command;
  const finalArgs = isWindows && command.endsWith(".cmd") ? ["/d", "/s", "/c", command, ...args] : args;
  const result = spawnSync(executable, finalArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
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
  for (const name of skipped) console.log(`     ⏭  ${name}`);
  console.log(`   原因:本机无兄弟仓 nexion-backend。要跑齐,克隆该仓到 ../nexion-backend 或设 NEXION_BACKEND_ROOT。`);
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

