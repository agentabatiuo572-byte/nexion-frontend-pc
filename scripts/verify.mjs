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

run("[1/4] typecheck", npxCmd, ["--no-install", "tsc", "--noEmit"]);
run("[2/4] runtime mock import guard", "node", ["scripts/check-runtime-mock-imports.mjs"]);
run("[3/4] kill-switch sentinel", "node", ["scripts/kill-switch-count-sentinel.mjs"]);
run("[3/4] rhythm sentinel", "node", ["scripts/rhythm-single-source-sentinel.mjs"]);
run("[4/4] production build", npmCmd, ["run", "build"]);

console.log("verify OK");
