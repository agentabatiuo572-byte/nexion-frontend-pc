import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

assert.equal(process.platform, "linux");
const bindings = JSON.parse(process.argv[2]);
assert.ok(Array.isArray(bindings) && bindings.length > 0);
assert.equal(new Set(bindings.map(binding => binding.port)).size, bindings.length, "Duplicate listener bindings");
for (const { port, paths } of bindings) {
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  assert.ok(Array.isArray(paths) && paths.length > 0 && paths.every(path => typeof path === "string" && path.length > 0));
}
const clock = spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8" });
assert.equal(clock.status, 0, "Cannot measure Linux clock ticks");
assert.match(clock.stdout.trim(), /^[1-9]\d*$/);
const ticksPerSecond = BigInt(clock.stdout.trim());
const boot = readFileSync("/proc/stat", "utf8").match(/^btime (\d+)$/m);
assert.ok(boot, "Cannot measure Linux boot time");
const bootMilliseconds = BigInt(boot[1]) * 1000n;
const gone = error => error.code === "ENOENT" || error.code === "ESRCH";

function listeners() {
  const sockets = new Map(bindings.map(({ port }) => [port, new Set()]));
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try { text = readFileSync(file, "utf8"); }
    catch (error) { if (file.endsWith("tcp6") && error.code === "ENOENT") continue; throw error; }
    for (const line of text.trim().split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields[3] !== "0A") continue;
      const port = Number.parseInt(fields[1].split(":").at(-1), 16);
      if (sockets.has(port)) {
        assert.match(fields[9], /^[1-9]\d*$/, "Listener socket inode unavailable");
        sockets.get(port).add(fields[9]);
      }
    }
  }
  const owners = new Map([...sockets.values()].flatMap(inodes => [...inodes]).map(inode => [inode, new Set()]));
  for (const pid of readdirSync("/proc").filter(name => /^\d+$/.test(name))) {
    let files;
    try { files = readdirSync(`/proc/${pid}/fd`); }
    catch (error) { if (gone(error)) continue; throw error; }
    for (const fd of files) {
      let link;
      try { link = readlinkSync(`/proc/${pid}/fd/${fd}`); }
      catch (error) { if (gone(error)) continue; throw error; }
      const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1];
      if (owners.has(inode)) owners.get(inode).add(Number(pid));
    }
  }
  return bindings.map(({ port }) => {
    const inodes = [...sockets.get(port)].sort();
    assert.ok(inodes.length > 0, `No live listener for port ${port}`);
    assert.ok(inodes.every(inode => owners.get(inode).size > 0), `Unresolved listener owner for port ${port}`);
    const pids = new Set(inodes.flatMap(inode => [...owners.get(inode)]));
    assert.equal(pids.size, 1, `Listener ownership is ambiguous for port ${port}`);
    return { port, inodes, pid: [...pids][0] };
  });
}

function fingerprint(pid, paths) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  assert.ok(stat.startsWith(`${pid} (`), "Listener process identity unavailable");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
  assert.match(fields[19], /^\d+$/, "Listener start time unavailable");
  const startTicks = BigInt(fields[19]);
  const startMilliseconds = bootMilliseconds + startTicks * 1000n / ticksPerSecond;
  assert.ok(startMilliseconds <= BigInt(Number.MAX_SAFE_INTEGER));
  const command = readFileSync(`/proc/${pid}/cmdline`);
  assert.ok(command.length > 0, "Listener command is unreadable");
  const executable = readlinkSync(`/proc/${pid}/exe`);
  assert.ok(executable.length > 0, "Listener executable is unreadable");
  const commandText = command.toString("utf8").split("\0").filter(Boolean).join(" ");
  return {
    startTicks: startTicks.toString(), executable,
    row: {
      pid, processStartTime: new Date(Number(startMilliseconds)).toISOString(),
      commandLineHash: createHash("sha256").update(command).digest("hex"),
      references: paths.map(path => commandText.includes(path)),
      commandLineReadable: true, executablePathReadable: true,
    },
  };
}

const before = listeners();
const measured = before.map(({ pid }, index) => fingerprint(pid, bindings[index].paths));
const after = listeners();
assert.deepEqual(after, before, "Listener changed during ownership collection");
after.forEach(({ pid }, index) => {
  assert.deepEqual(fingerprint(pid, bindings[index].paths), measured[index],
    "Listener process changed during ownership collection");
});
process.stdout.write(JSON.stringify(measured.map(value => value.row)));
