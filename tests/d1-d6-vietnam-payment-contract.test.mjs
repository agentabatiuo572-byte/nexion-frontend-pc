import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const d1 = readFileSync(new URL("../app/components/domain-views/d-tabs/d1-recon.tsx", import.meta.url), "utf8");
const d3 = readFileSync(new URL("../app/components/domain-views/d-tabs/d3-treasury.tsx", import.meta.url), "utf8");
const d6 = readFileSync(new URL("../app/components/domain-views/d-tabs/d6-fx.tsx", import.meta.url), "utf8");
const dView = readFileSync(new URL("../app/components/domain-views/d-view.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/d-client.ts", import.meta.url), "utf8");
const financeProxy = readFileSync(new URL("../app/api/admin/finance/[...path]/route.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../lib/admin/registry/d.ts", import.meta.url), "utf8");
const errors = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");

test("D1 bank rail is real-API backed and has all five operational views plus an empty state", () => {
  for (const label of ["在途意向单", "已匹配", "孤儿队列", "差额队列", "过期后到账", "收款账户池"]) {
    assert.match(d1, new RegExp(label));
  }
  assert.match(d1, /loadD1VietQrOverview/);
  assert.match(d1, /当前视图暂无银行轨记录/);
  assert.doesNotMatch(d1, /lib\/mock\/admin\/bank-rail/);
});

test("D1 and D6 writes use real finance proxy routes with idempotency and optimistic concurrency", () => {
  for (const endpoint of ["/vietqr/overview", "/vietqr/config", "/vietqr/accounts", "/fx-quote"]) {
    assert.ok(client.includes(endpoint) || financeProxy.includes(endpoint), `missing ${endpoint}`);
  }
  assert.match(client, /Idempotency-Key/);
  assert.match(client, /expectedVersion/);
  assert.match(financeProxy, /vietqr/);
  assert.match(financeProxy, /fx-quote/);
});

test("D6 derives quote from base plus spread, renders history from the server, and fails closed", () => {
  assert.match(d6, /基准价/);
  assert.match(d6, /买入点差/);
  assert.match(d6, /锁价窗/);
  assert.match(d6, /调价不影响在途单/);
  assert.match(d6, /loadD6FxQuote/);
  assert.match(d6, /updateD6FxQuote/);
  assert.match(d6, /setData\(null\)/);
  assert.doesNotMatch(d6, /lib\/mock\//);
  assert.match(dView, /D6:\s*"D6"/);
  assert.match(dView, /tab === "D6" && <D6Fx/);
});

test("D3 exposes nine canonical liabilities and the bank suspense source", () => {
  assert.match(d3, /应付负债 · 9 类科目/);
  assert.match(client, /unverified_deposit/);
  assert.match(client, /D3_LIABILITY_KEYS\.length !== 9|D3_LIABILITY_KEYS\.length != 9/);
  assert.doesNotMatch(d3, /应付负债 · 8 类科目/);
  assert.doesNotMatch(registry, /固定 8 类应付负债/);
  assert.match(registry, /path: "\/finance\/fx-rate"/);
});

test("D1 and D6 translate concurrency and validation failures into actionable operator guidance", () => {
  for (const code of [
    "VIETQR_RECONCILIATION_ALREADY_TERMINAL",
    "VIETQR_RECONCILIATION_VERSION_CONFLICT",
    "VIETQR_BANK_ACCOUNT_VERSION_OR_STATE_CONFLICT",
    "VIETQR_CONFIG_VERSION_CONFLICT",
    "FX_QUOTE_VERSION_CONFLICT",
    "FX_BASE_RATE_OUT_OF_RANGE",
  ]) {
    assert.match(errors, new RegExp(`${code}:`), `missing operator message for ${code}`);
  }
});
