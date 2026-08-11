import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "app/components/domain-views/i-tabs/i2-nova.tsx"), "utf8");
const client = fs.readFileSync(path.join(root, "lib/admin/i-client.ts"), "utf8");
const contract = fs.readFileSync(path.join(root, "lib/admin/i-overview-contract.ts"), "utf8");

test("dynamic Nova channel creation selects a server-declared runtime source", () => {
  assert.match(client, /runtimeSourceOptions/);
  assert.match(contract, /runtimeSourceOptions/);
  assert.match(page, /服务端真实事实源/);
  assert.match(page, /runtimeSourceOptions/);
  assert.doesNotMatch(page, /DEFAULT_TRIGGER_DESCRIPTION/);
});
