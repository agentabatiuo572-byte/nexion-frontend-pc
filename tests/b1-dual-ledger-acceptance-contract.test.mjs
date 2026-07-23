import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(
  new URL("../app/_console/overview/dual-ledger/page.tsx", import.meta.url),
  "utf8",
);
const dClient = await readFile(new URL("../lib/admin/d-client.ts", import.meta.url), "utf8");
const bClient = await readFile(new URL("../lib/admin/b-client.ts", import.meta.url), "utf8");

test("B1 presents the canonical reserve-minus-liability formula and server trend windows", () => {
  assert.match(page, /fmtUsdCompact\(reserveUsd\)\}\s*−\s*\{fmtUsdCompact\(liabilitiesUsd\)/);
  assert.match(page, /\(\["7d",\s*"30d",\s*"90d"\]\s+as const\)/);
  assert.match(page, /\/api\/admin\/treasury\/net-exposure\?window=\$\{exposureWindow\}/);
  assert.match(page, /不使用前端模拟序列/);
});

test("B1 closes threshold, D3 injection, reconciliation export, and advisory-only boundaries", () => {
  assert.match(page, /redlinePct:\s*String\(redline\),\s*healthyPct:\s*String\(healthy\)/);
  assert.match(page, /红线必须在 80%–150%/);
  assert.match(page, /黄线必须在 100%–200%/);
  assert.match(page, /createD3Injection\(/);
  assert.match(page, /downloadD3Csv\("reconciliation"\)/);
  assert.match(page, /B1 只给出水位、告警与建议，不自动执行提现收紧或全局熔断/);
  assert.doesNotMatch(page, /jEmergencyActions|emergencyDisableJ1|触发全局熔断/);
});

test("D3 reserve injection is an inbound reserve action, not an amplified cash-outflow action", () => {
  assert.match(page, /amplifies=\{mc\.kind === "threshold"\}/);
  assert.doesNotMatch(
    page,
    /amplifies=\{mc\.kind === "threshold"\s*\|\|\s*mc\.kind === "injection"\}/,
  );
});

test("B1 mutations preserve one command idempotency key across result-unknown retries", () => {
  assert.match(page, /idempotencyKey:\s*`b1-\$\{kind\}-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(page, /updateD3Thresholds\([\s\S]*current\.idempotencyKey/);
  assert.match(page, /createD3Injection\([\s\S]*current\.idempotencyKey/);
  assert.match(page, /acknowledgeBDomainAlert\(ALERT_ID,\s*reason,\s*operator,\s*current\.idempotencyKey\)/);
  assert.match(dClient, /createD3Injection\([\s\S]*idempotencyKey\?: string[\s\S]*idempotencyKey,/);
  assert.match(dClient, /updateD3Thresholds\([\s\S]*idempotencyKey\?: string[\s\S]*idempotencyKey,/);
  assert.match(bClient, /acknowledgeBDomainAlert\([\s\S]*idempotencyKey\?: string[\s\S]*idempotencyKey \|\| nextId/);
});
