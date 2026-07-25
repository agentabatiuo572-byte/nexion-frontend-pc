import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/components/domain-views/d-tabs/d4-ledger.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/d-client.ts", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../app/api/admin/bills/[[...path]]/route.ts", import.meta.url), "utf8");
const l5 = readFileSync(new URL("../app/components/domain-views/l-tabs/l5-export.tsx", import.meta.url), "utf8");

test("D4 exposes the exact seven canonical BillTypes and all four filters", () => {
  for (const type of ["swap", "topup", "withdraw", "earning", "commission", "refund", "bonus"]) {
    assert.match(page, new RegExp(`\\[\\"${type}\\"`));
  }
  for (const field of ["userId", "status", "from", "to"]) assert.match(page, new RegExp(field));
  assert.doesNotMatch(page, /\["ADJUSTMENT"|\["CHARGEBACK"/);
});

test("D4 contains user-wide category totals, running-balance breaks, masked export and fail-closed resets", () => {
  assert.match(page, /categoryTotals/);
  assert.match(page, /breakDetected/);
  assert.match(page, /downloadD4BillsCsv/);
  assert.match(page, /setBills\(EMPTY_PAGE\)/);
  assert.match(page, /setUserLedger\(null\)/);
  assert.match(page, /setRunningBalance\(null\)/);
  assert.match(page, /setLoading\(true\);\s*setBills\(\{ total: 0, pageNum: page, pageSize, records: \[\] \}\)/s);
  assert.match(page, /disabled=\{!canExport \|\| loading \|\| Boolean\(error\)\}/);
  assert.match(page, /重试/);
});

test("D4 global bill results cannot overwrite the independent user-ledger selection", () => {
  const globalEffectStart = page.indexOf("  useEffect(() => {");
  const userEffectStart = page.indexOf("  useEffect(() => {", globalEffectStart + 1);
  assert.ok(globalEffectStart >= 0 && userEffectStart > globalEffectStart);
  const globalEffect = page.slice(globalEffectStart, userEffectStart);
  assert.doesNotMatch(globalEffect, /setSelectedUserId|setUserInput|setUserLedger|setRunningBalance|userRequest/);
  assert.match(globalEffect, /\[applied, canGlobalRead, deepBizNo, page, pageSize, reloadKey, type\]/);
});

test("D4 client rejects malformed financial facts and uses the canonical read-only proxy", () => {
  assert.match(client, /D4_RESPONSE_INVALID/);
  assert.match(client, /D4_BILL_TYPES/);
  assert.match(client, /apiRequest<.*>\("bills"/s);
  assert.match(proxy, /\/api\/admin\/bills/);
  assert.doesNotMatch(proxy, /export async function (POST|PUT|PATCH|DELETE)/);
});

test("D4 masked seven-type export is available from the L5 regulatory export surface", () => {
  assert.match(l5, /downloadD4BillsCsv/);
  assert.match(l5, /导出七类账单明细/);
  assert.doesNotMatch(l5, /D4 的七类账单明细.*留到跨模块验收/);
});
