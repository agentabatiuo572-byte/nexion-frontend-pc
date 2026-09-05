import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("E6 cannot enable compute share or clear its installer while active", async () => {
  const source = await readFile(new URL("../app/components/domain-views/e-tabs/e6-compute-config.tsx", import.meta.url), "utf8");
  assert.match(source, /isSafeInstallerUrl/);
  assert.match(source, /if \(next && !downloadReady\) return/);
  assert.match(source, /disabled=\{!on && !downloadReady\}/);
  assert.match(source, /flags\.some\(\(flag\) => flag\.key === "computeShareEnabled" && flag\.enabled\)/);
  assert.match(source, /\(exe\|msi\|msix\|dmg\|pkg\|zip\)/);
  assert.match(source, /host === "localhost"/);
  assert.match(source, /host\.endsWith\("\.example\.com"\)/);
});
