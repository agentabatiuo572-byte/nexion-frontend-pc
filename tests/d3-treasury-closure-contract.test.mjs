import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatReserveCoverDays } from "../lib/admin/treasury-cover-days.ts";

const page = readFileSync(new URL("../app/components/domain-views/d-tabs/d3-treasury.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/d-client.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/admin/treasury/[...path]/route.ts", import.meta.url), "utf8");

test("D3 binds every canonical read/config/export endpoint", () => {
  for (const endpoint of ["/reserve", "/liabilities?breakdown=true", "/maturity-forecast", "/net-exposure", "/forecast-config", "/reserve-injection", "/reconciliation/export", "/liabilities/export"]) {
    assert.ok(client.includes(endpoint) || route.includes(endpoint), `missing ${endpoint}`);
  }
});

test("D3 page is water-level oriented and does not calculate or edit B1 coverage", () => {
  for (const copy of ["资金水位分级", "真实储备明细", "应付负债 · 9 类科目", "到期负债预测", "净敞口曲线"]) {
    assert.ok(page.includes(copy), `missing ${copy}`);
  }
  assert.doesNotMatch(page, /覆盖率阈值调整|saveThresholds|coverageSeries/);
});

test("D3 injection requires an explicit voucher and exact authority", () => {
  assert.doesNotMatch(page, /D3-\$\{Date\.now\(\)\}/);
  assert.match(page, /finance_d3_injection_create/);
  assert.match(page, /voucherNo\.trim\(\)/);
});

test("D3 config and exports are gated by their exact authorities", () => {
  assert.match(page, /finance_d3_write/);
  assert.match(page, /finance_d3_export/);
  assert.match(page, /forecastWindow/);
  assert.match(page, /stakingInterestMode/);
});

test("D3 response normalizers fail closed on required canonical fields", () => {
  assert.match(client, /D3_RESPONSE_INVALID/);
  assert.match(client, /D3_LIABILITY_KEYS/);
  assert.match(client, /D3_WATER_TIERS/);
  assert.match(client, /liabilities\.invariants/);
  assert.match(client, /maturity\.cumulativeUsdt/);
  assert.match(client, /exposure\.series\[\$\{index\}\]\.arithmetic/);
  assert.doesNotMatch(client, /genesisUsd:\s*num\(/);
});

test("D3 load failures clear stale financial facts and config writes use optimistic concurrency", () => {
  assert.match(page, /setData\(null\)/);
  assert.match(page, /setDraft\(null\)/);
  assert.match(page, /updateD3ForecastConfig\(values, draft\.version/);
  assert.match(client, /expectedVersion/);
  assert.match(page, /trialShadowStressUsdt/);
});

test("D3 discards a superseded read response instead of overwriting a newer authoritative snapshot", () => {
  assert.match(page, /const loadGeneration = useRef\(0\)/);
  assert.match(page, /const generation = \+\+loadGeneration\.current/);
  assert.match(page, /if \(generation !== loadGeneration\.current\) return;/);
});

test("treasury proxy supports PUT and preserves CSV response headers", () => {
  assert.match(route, /export async function PUT/);
  assert.match(route, /Content-Disposition/);
});

test("D3 treats the server 999 cover-days sentinel as no calculation when the current window has no due amount", () => {
  const copy = formatReserveCoverDays(0, 999);

  assert.equal(copy, "当前窗口无到期兑付，不计算覆盖天数");
  assert.doesNotMatch(copy, /999|可覆盖/);
  assert.match(page, /formatReserveCoverDays\(data\.maturity\.cumulativeUsdt,\s*water\?\.reserveCoverDays \?\? 0\)/);
  assert.doesNotMatch(page, /可覆盖 \{water\?\.reserveCoverDays \?\? 0\} 天/);
});

test("D3 translates storage identifiers into operator-facing source labels", () => {
  assert.match(page, /function treasurySourceLabel/);
  assert.match(page, /treasurySourceLabel\(row\.source\)/);
  assert.match(page, /map\(treasurySourceLabel\)/);
  assert.doesNotMatch(page, />\{row\.source\}<\//);
  assert.match(page, /D3 权威事实来源：\{sourceText/);
});
