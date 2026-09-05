import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F1 promotion and payout histories expose and consume server cursors", () => {
  const client = read("lib/admin/f1-client.ts");
  const shell = read("app/components/domain-views/f-view.tsx");
  const view = read("app/components/domain-views/f-tabs/f1-vrank.tsx");
  assert.match(client, /interface F1PromotionFilters[\s\S]*cursor\?: string/);
  assert.ok((client.match(/nextCursor: asText\(data\?\.nextCursor\)/g) ?? []).length >= 2);
  assert.match(view, /promotionNextCursor/);
  assert.match(view, /payoutNextCursor/);
  assert.ok((view.match(/加载更早记录/g) ?? []).length >= 2);
  assert.match(shell, /fetchF1PromotionLog\(\)/);
  assert.doesNotMatch(shell, /currentMonthStart/);
});
