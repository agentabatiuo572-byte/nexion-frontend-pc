import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const client = fs.readFileSync("lib/admin/e2-client.ts", "utf8");
const view = fs.readFileSync("app/components/domain-views/e-tabs/e2-tasks.tsx", "utf8");
const shell = fs.readFileSync("app/components/domain-views/e-view.tsx", "utf8");
const registry = fs.readFileSync("lib/admin/high-ops-registry.ts", "utf8");

test("E2 onboarding yield client consumes the canonical config projection", () => {
  assert.match(client, /onboarding-yield|comparisonConfig|yieldComparison/i);
  assert.match(client, /dailyUsdt/);
  assert.match(client, /dailyNex/);
});

test("E2 UI exposes structured editable comparison rows", () => {
  assert.match(view, /收益对比|comparison/i);
  assert.match(view, /调 USDT|dailyUsdt/);
  assert.match(view, /调 NEX|dailyNex/);
  assert.match(shell, /fetchE2PhoneTiers/);
});

test("E2 writes roundtrip canonical revisions and preserve decimal boundaries", () => {
  assert.match(client, /expectedRevision:\s*before\.revision/);
  assert.match(client, /expectedRevision:\s*row\.revision/);
  assert.match(client, /positiveDecimal18x6/);
  assert.match(shell, /normalizePositiveDecimal18x6/);
  assert.match(shell, /expectedRevision:\s*currentTier\.revision/);
  assert.match(shell, /expectedRevision:\s*comparison\.revision/);
  assert.match(registry, /onboarding_yield_comparison/);
  assert.match(registry, /expectedRevision:\s*Number\(ctx\.expectedRevision\)/);
});
