import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("H8 renders the effective timestamp and pages settlement history", () => {
  const client = read("lib/admin/h-client.ts");
  const view = read("app/components/domain-views/h-tabs/h8-referral-rewards.tsx");

  assert.match(client, /settlementHasMore/);
  assert.match(client, /settlementNextCursor/);
  assert.match(client, /cursor=\$\{encodeURIComponent\(cursor\)\}/);
  assert.match(view, /生效时间/);
  assert.match(view, /加载更早记录/);
  assert.match(view, /load\(data\.settlementNextCursor, true\)/);
});
