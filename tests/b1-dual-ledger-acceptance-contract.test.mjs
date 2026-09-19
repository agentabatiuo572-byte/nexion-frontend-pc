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
  assert.match(page, /downloadD3Csv\("reconciliation", reason, operator, current\.idempotencyKey\)/);
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

test("B1 states equality with the red line and a zero exposure as neutral, never as headroom", () => {
  // A value that merely EQUALS the red line has zero buffer, and a zero net exposure is
  // neither a gap nor a surplus. Reporting either as "above"/"surplus" is the defect this
  // pins; the same two-way mistake was fixed in J1 (zentao #68) and reappeared here.
  assert.match(page, /bufferPct\s*=\s*round2\(coverageRatio - effRedline\)/);
  assert.match(page, /bufferPct === 0[\s\S]*?触及红线 · 缓冲 0\.0pct/);
  // The surplus claim must be gated on strictly exceeding 100%.
  assert.match(page, /round2\(coverageRatio - 100\) > 0 \? "\(超 100% 已现盈余\)"/);
  assert.match(page, /round2\(coverageRatio - 100\) === 0 \? "\(刚好覆盖 · 无盈余\)"/);
  // Net exposure: negative is a gap, positive is a surplus, zero is level.
  assert.match(page, /netExposure < 0 \? "缺口" : netExposure > 0 \? "盈余" : "持平 · 无盈余无缺口"/);
  // Neither branch may fall back to the old two-way copy.
  assert.doesNotMatch(page, /\(超 100% 已现盈余\)→ 即当前兑付覆盖率/);
  assert.doesNotMatch(page, /netExposure < 0 \? "缺口" : "盈余"/);
});
