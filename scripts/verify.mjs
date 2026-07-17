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

run("[1/12] typecheck", npxCmd, ["--no-install", "tsc", "--noEmit"]);
run("[2/12] runtime mock import guard", "node", ["scripts/check-runtime-mock-imports.mjs"]);
run("[3/12] kill-switch sentinel", "node", ["scripts/kill-switch-count-sentinel.mjs"]);
run("[4/12] rhythm sentinel", "node", ["scripts/rhythm-single-source-sentinel.mjs"]);
run("[5/12] J1 contract", "node", ["--test", "tests/j1-killswitch-contract.test.mjs"]);
run("[6/12] J2 contract", "node", ["--test", "tests/j2-geoblock-contract.test.mjs"]);
run("[7/12] K2 contract", "node", ["--test", "tests/k2-arbitrage-contract.test.mjs"]);
run("[8/12] K3 contract", "node", ["--test", "tests/k3-withdraw-rules-contract.test.mjs"]);
run("[9/12] K4 contract", "node", ["--test", "tests/k4-scoring-contract.test.mjs"]);
run("[10/12] K5 contract", "node", ["--test", "tests/k5-kyc-review-contract.test.mjs"]);
run("[11/12] A2 coverage sentinel", "node", ["scripts/a2-audit-coverage-sentinel.mjs"]);
run("[12/12] production build", npmCmd, ["run", "build"]);

console.log("verify OK");
