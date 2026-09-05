import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../lib/admin/g1-client.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/components/domain-views/g-tabs/g1-staking.tsx", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../app/api/admin/market/[...path]/route.ts", import.meta.url), "utf8");

test("G1 tier restoration uses the J1-authorized restore route and never the kill route", () => {
  assert.match(client, /killed\s*\?\s*`\/staking\/pools\/\$\{encodeURIComponent\(tierKey\)\}\/kill-status`\s*:\s*`\/staking\/pools\/\$\{encodeURIComponent\(tierKey\)\}\/restore`/);
  assert.match(page, /authorities\.includes\("emergency_j1_gate_resume"\)/);
  assert.doesNotMatch(page, /缺少 finprod_g1_kill_toggle 权限"\} onClick=\{\(\) => resumeTier/);
  assert.match(proxy, /parts\[3\] === "restore"/);
  assert.match(proxy, /return `\/api\/admin\/market\/staking\/pools\/\$\{encodeURIComponent\(parts\[2\]\)\}\/restore`/);
  assert.match(client, /g1OverviewMutation\(\s*path,\s*"PATCH"/);
});
