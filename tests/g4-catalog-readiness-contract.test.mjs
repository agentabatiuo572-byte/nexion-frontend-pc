import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const client = strip(read("../lib/admin/g4-client.ts"));
const view = strip(read("../app/components/domain-views/g-tabs/g4-genesis.tsx"));
const proxy = strip(read("../app/api/admin/market/[...path]/route.ts"));
const manifest = JSON.parse(read("../docs/ops-actions.manifest.json"));

test("catalog readiness is normalized fail-closed and controls reopening", () => {
  assert.match(client, /catalogAvailable:\s*toBool\(data\?\.catalogAvailable, false\)/);
  assert.match(client, /seriesSetupRequired:\s*toBool\(data\?\.seriesSetupRequired, false\)/);
  assert.match(view, /next === "open" && !overview\.catalogAvailable/);
  assert.match(view, /marketClosed && !overview\.catalogAvailable/);
  assert.match(view, /catalogBlockText\(overview\.tradeBlockedReason\)/);
  assert.match(view, /GENESIS_TIERS_SUPPLY_MISMATCH:\s*"报价档位总量与 ACTIVE 系列总量不一致"/);
});

test("missing ACTIVE series has a permission-gated, stable-idempotency initialization action", () => {
  assert.match(client, /export async function initializeG4GenesisSeries\(/);
  assert.match(client, /"\/nex\/genesis\/series\/initialize"/);
  assert.match(client, /"g4-series-initialize"/);
  assert.match(proxy, /parts\[2\] === "series" && parts\[3\] === "initialize"/);
  assert.match(view, /overview\.seriesSetupRequired && allowed\("finprod_g4_write"\)/);
  assert.match(view, /总量与首档报价由当前有效阶梯档位派生/);
  assert.match(view, /初始化并发布系列/);
  const claim = manifest.rows.filter((row) =>
    [row.restAction, ...(row.restActions ?? [])].includes("initializeG4GenesisSeries"));
  assert.equal(claim.length, 1);
  assert.equal(claim[0].id, "OPS-G-07");
});
