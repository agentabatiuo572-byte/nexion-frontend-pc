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
  assert.match(client, /seriesInitializationAvailable:\s*toBool\(data\?\.seriesInitializationAvailable, false\)/);
  assert.match(client, /seriesRecoveryRequired:\s*toBool\(data\?\.seriesRecoveryRequired, false\)/);
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
  assert.match(view, /overview\.seriesInitializationAvailable && allowed\("finprod_g4_write"\)/);
  assert.match(view, /版税、每日排放率与排放公式固定以零值初始化/);
  assert.doesNotMatch(client.match(/export async function initializeG4GenesisSeries[\s\S]*?\n\}/)?.[0] ?? "", /royaltyBps|dailyEmissionRatePct|dividendBaseFormula/);
  assert.match(view, /初始化并发布系列/);
  const claim = manifest.rows.filter((row) =>
    [row.restAction, ...(row.restActions ?? [])].includes("initializeG4GenesisSeries"));
  assert.equal(claim.length, 1);
  assert.equal(claim[0].id, "OPS-G-07");
});

test("missing tiers and historical holdings have explicit fail-closed recovery paths", () => {
  assert.match(view, /创建首档报价/);
  assert.match(view, /firstTier \? "创建 Genesis 首档报价"/);
  assert.match(view, /rangeFrom = lastTier\?\.to \?\? 0/);
  assert.match(view, /历史持仓禁止覆盖初始化/);
  assert.match(view, /overview\.seriesRecoveryRequired/);
  assert.match(view, /GENESIS_SERIES_RECOVERY_REQUIRED/);
});
