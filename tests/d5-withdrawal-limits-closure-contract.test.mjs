import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("D5 uses canonical GET/PUT proxy and strict versioned client", () => {
  const client = read("lib/admin/d-client.ts");
  const route = read("app/api/admin/withdraw/[[...path]]/route.ts");
  assert.match(client, /"withdraw", "\/limits"/);
  assert.match(client, /method: "PUT"/);
  assert.match(client, /expectedVersion/);
  assert.match(client, /D5_RESPONSE_INVALID/);
  assert.match(route, /\/api\/admin\/withdraw\/limits/);
  assert.match(route, /export async function PUT/);
});

test("D5 page fails closed and calculates direction from target values", () => {
  const page = read("app/components/domain-views/d-tabs/d5-params.tsx");
  assert.match(page, /setParams\(null\)/);
  assert.match(page, /旧值已清空，全部写操作保持冻结/);
  assert.match(page, /daily > params\.dailyLimitCount/);
  assert.match(page, /feePct \/ 100 < params\.networkFeeRatio/);
  assert.match(page, /nex > params\.nexFeeOffsetRate/);
  assert.doesNotMatch(page, /amplifies:\s*true/);
});

test("D5 displays all H1-owned read-only fields and cross-domain evidence links", () => {
  const page = read("app/components/domain-views/d-tabs/d5-params.tsx");
  for (const term of ["cooldownDays", "penaltyFeeRate", "complianceHoldEnabled", "source: phase-h1"]) {
    assert.match(page, new RegExp(term));
  }
  for (const route of ["/growth/phase", "/overview/dual-ledger", "/finance/withdrawals", "/platform/audit", "/platform/events"]) {
    assert.match(page, new RegExp(route.replaceAll("/", "\\/")));
  }
});

test("D5 network fee ratio, min and max are submitted atomically", () => {
  const page = read("app/components/domain-views/d-tabs/d5-params.tsx");
  assert.match(page, /networkFeeRatio: feePct \/ 100, networkFeeMin: feeMin, networkFeeMax: feeMax/);
  assert.match(page, /任一失败全回滚/);
});

test("D domain preserves D5 reason limits at the shared confirmation boundary", () => {
  const d5Page = read("app/components/domain-views/d-tabs/d5-params.tsx");
  const dView = read("app/components/domain-views/d-view.tsx");
  assert.match(d5Page, /reasonMin:\s*8/);
  assert.match(d5Page, /reasonMax:\s*200/);
  assert.match(dView, /reasonMin=\{mc\.reasonMin\}/);
  assert.match(dView, /reasonMax=\{mc\.reasonMax\}/);
  assert.match(dView, /completionCopy=\{mc\.completionCopy\}/);
  assert.match(d5Page, /提交成功后生效并写入审计/);
  assert.doesNotMatch(d5Page, /completionCopy:\s*"已生效 · 已记审计"/);
});
