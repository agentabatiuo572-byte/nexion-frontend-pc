import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";
const npxCmd = isWindows ? "npx.cmd" : "npx";

function run(label, command, args) {
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
  ["App storage-key parity", "node", ["scripts/uni-storage-key-sentinel.mjs"]],
  ["kill-switch sentinel", "node", ["scripts/kill-switch-count-sentinel.mjs"]],
  ["rhythm sentinel", "node", ["scripts/rhythm-single-source-sentinel.mjs"]],
  ["K3 contract", "node", ["--test", "tests/k3-withdraw-rules-contract.test.mjs"]],
  ["K4 contract", "node", ["--test", "tests/k4-scoring-contract.test.mjs"]],
  ["K5 contract", "node", ["--test", "tests/k5-kyc-review-contract.test.mjs"]],
  ["A2 coverage sentinel", "node", ["scripts/a2-audit-coverage-sentinel.mjs"]],
  ["A2 outcome-uncertain contract", "node", ["--test", "tests/a2-outcome-uncertain-contract.test.mjs"]],
  ["E1 acceptance contract", "node", ["--test", "tests/e1-acceptance-contract.test.mjs"]],
  ["operation-confirm error copy", "node", ["--test", "tests/operation-confirm-error-message.test.mjs"]],
  ["in-memory idempotency-key sentinel", "node", ["scripts/pending-idempotency-key-sentinel.mjs"]],
  ["pending mutation store contract", "node", ["--test", "tests/pending-mutation-store-contract.test.mjs"]],
  ["pending mutation migration contract", "node", ["--test", "tests/pending-mutation-migration-contract.test.mjs"]],
  ["F1 direct-write pending-store contract", "node", ["--test", "tests/f1-direct-pending-store-contract.test.mjs"]],
  ["E domain pending-store contract", "node", ["--test", "tests/e-pending-store-contract.test.mjs"]],
  ["H8 pending-store contract", "node", ["--test", "tests/h8-pending-store-contract.test.mjs"]],
  ["endpoint citation ledger", "node", ["scripts/endpoint-citation-sentinel.mjs"]],
  // ↓↓↓ 以下齿轮硬读兄弟仓 nexion-backend。缺仓的机器(本机即是)会在第一条硬崩,
  //     而 run() 是 fail-fast —— 所以它们必须集中排在**最后**,否则其后的本地齿全部执行不到。
  //     2026-08-06 前它们散在中段,导致其后 21 道本可运行的门在本机从未跑过。
  ["real recharge-channel parity", "node", ["scripts/channel-parity-sentinel.mjs"]],
  ["D1 channel contract", "node", ["--test", "tests/d1-channel-parity-contract.test.mjs"]],
  ["B4 cross-repository contract", "node", ["--test", "tests/b4-cross-repo-sentinel-contract.test.mjs"]],
  ["FE/BE mapping closure ratchet", "node", ["scripts/fe-be-mapping-coverage.mjs"]],
  ["J1 contract", "node", ["--test", "tests/j1-killswitch-contract.test.mjs"]],
  ["J2 contract", "node", ["--test", "tests/j2-geoblock-contract.test.mjs"]],
  ["K2 contract", "node", ["--test", "tests/k2-arbitrage-contract.test.mjs"]],
  ["production build", npmCmd, ["run", "build"]],
];
GEARS.forEach(([label, cmd, args], index) => run(`[${index + 1}/${GEARS.length}] ${label}`, cmd, args));

console.log("verify OK");
