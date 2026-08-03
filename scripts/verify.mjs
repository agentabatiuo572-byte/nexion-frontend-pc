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

run("[1/20] typecheck", npxCmd, ["--no-install", "tsc", "--noEmit"]);
run("[2/20] runtime mock import guard", "node", ["scripts/check-runtime-mock-imports.mjs"]);
run("[3/20] workspace path resolver", "node", ["--test", "scripts/nexion-workspace-paths.test.mjs"]);
run("[4/20] canon sentinel", "node", ["scripts/canon-sentinel.mjs"]);
run("[5/20] interaction audit", "node", ["scripts/admin-interaction-audit.mjs"]);
run("[6/20] real recharge-channel parity", "node", ["scripts/channel-parity-sentinel.mjs"]);
run("[7/20] App storage-key parity", "node", ["scripts/uni-storage-key-sentinel.mjs"]);
run("[8/20] D1 channel contract", "node", ["--test", "tests/d1-channel-parity-contract.test.mjs"]);
run("[9/20] B4 cross-repository contract", "node", ["--test", "tests/b4-cross-repo-sentinel-contract.test.mjs"]);
run("[10/20] FE/BE mapping closure ratchet", "node", ["scripts/fe-be-mapping-coverage.mjs"]);
run("[11/20] kill-switch sentinel", "node", ["scripts/kill-switch-count-sentinel.mjs"]);
run("[12/20] rhythm sentinel", "node", ["scripts/rhythm-single-source-sentinel.mjs"]);
run("[13/20] J1 contract", "node", ["--test", "tests/j1-killswitch-contract.test.mjs"]);
run("[14/20] J2 contract", "node", ["--test", "tests/j2-geoblock-contract.test.mjs"]);
run("[15/20] K2 contract", "node", ["--test", "tests/k2-arbitrage-contract.test.mjs"]);
run("[16/20] K3 contract", "node", ["--test", "tests/k3-withdraw-rules-contract.test.mjs"]);
run("[17/20] K4 contract", "node", ["--test", "tests/k4-scoring-contract.test.mjs"]);
run("[18/20] K5 contract", "node", ["--test", "tests/k5-kyc-review-contract.test.mjs"]);
run("[19/20] A2 coverage sentinel", "node", ["scripts/a2-audit-coverage-sentinel.mjs"]);
run("[20/20] production build", npmCmd, ["run", "build"]);

console.log("verify OK");
