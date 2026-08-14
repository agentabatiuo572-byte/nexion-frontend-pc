import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (url) => (existsSync(url) ? readFileSync(url, "utf8") : "");
const page = read(new URL("../app/_console/overview/liquidity/page.tsx", import.meta.url));
const client = read(new URL("../lib/admin/b2-client.ts", import.meta.url));
const controller = read(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/treasury/web/OpsTreasuryController.java", import.meta.url),
);
const permissionSeed = read(
  new URL("../../nexion-backend/scripts/rbac-classic-seed/AB.sql", import.meta.url),
);

test("B2 owns a strict client for the D3 canonical reserve, liability, maturity and config facts", () => {
  for (const endpoint of [
    "/reserve",
    "/liabilities?breakdown=true",
    "/maturity-forecast?window=",
    "/forecast-config",
    "/b2/liabilities/export",
  ]) {
    assert.ok(client.includes(endpoint), `missing ${endpoint}`);
  }
  assert.match(client, /B2_RESPONSE_INVALID/);
  assert.match(client, /B2_LIABILITY_KEYS/);
  assert.match(client, /unverified_deposit/);
  assert.match(page, /B2_LIABILITY_KEYS\.length/);
  assert.match(client, /liabilities\.invariants/);
  assert.match(client, /maturity\.cumulativeUsdt/);
});

test("B2 page uses its own authoritative client and clears stale financial facts on failures", () => {
  assert.match(page, /@\/lib\/admin\/b2-client/);
  assert.doesNotMatch(page, /@\/lib\/admin\/b-client/);
  assert.match(page, /setData\(null\)/);
  assert.match(page, /服务端响应异常/);
  assert.match(page, /重新加载/);
});

test("B2 exposes the locked 7/30 day forecast, nine-source liability detail and D3 deep link", () => {
  for (const copy of [
    "7 天",
    "30 天",
    "B2_LIABILITY_KEYS.length",
    "事实来源",
    "提现",
    "利息",
    "Genesis",
    "D3 资金池深页",
  ]) {
    assert.ok(page.includes(copy), `missing ${copy}`);
  }
  assert.match(page, /\/finance\/pool/);
});

test("B2 zero-due copy does not invent cover days or recommend scheduling zero funds", () => {
  assert.match(page, /maturity\.cumulativeUsdt === 0/);
  assert.match(page, /当前窗口无到期兑付/);
  assert.doesNotMatch(page, /Math\.max\(RW_TOTAL\s*\/\s*7,\s*1\)/);
});

test("B2 write and export controls use dedicated authorities, reason validation and optimistic concurrency", () => {
  assert.match(page, /overview_b2_write/);
  assert.match(page, /overview_b2_export/);
  assert.match(page, /8-200/);
  assert.match(client, /expectedVersion/);
  assert.match(client, /Idempotency-Key/);
  assert.match(page, /配置于下一 UTC 日 00:00 生效/);
});

test("B2 read/write/export authorities are enforced server-side without weakening D3 authorities", () => {
  for (const permission of ["overview_b2_read", "overview_b2_write", "overview_b2_export"]) {
    assert.ok(permissionSeed.includes(permission), `missing ${permission}`);
  }
  assert.match(
    controller,
    /@GetMapping\("\/liabilities"\)[\s\S]*?@PreAuthorize\("hasAnyAuthority\('finance_d3_read',\s*'overview_b2_read'\)"\)/,
  );
  assert.match(
    controller,
    /@GetMapping\("\/maturity-forecast"\)[\s\S]*?@PreAuthorize\("hasAnyAuthority\('finance_d3_read',\s*'overview_b2_read'\)"\)/,
  );
  assert.match(
    controller,
    /@PutMapping\("\/forecast-config"\)[\s\S]*?@PreAuthorize\("hasAnyAuthority\('finance_d3_write',\s*'overview_b2_write'\)"\)/,
  );
  assert.match(
    controller,
    /@GetMapping\(value = "\/b2\/liabilities\/export"[\s\S]*?@PreAuthorize\("hasAuthority\('overview_b2_export'\)"\)/,
  );
});
