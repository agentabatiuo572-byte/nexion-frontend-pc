import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../lib/admin/e5-client.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../app/components/domain-views/e-tabs/e5-ops.tsx", import.meta.url), "utf8");

test("E5 shows in-flight deactivation as pending settlement instead of unbound", () => {
  assert.match(client, /pendingDeactivate\) return "pending-deactivate"/);
  assert.match(view, /"pending-deactivate": "待任务结算后停用"/);
  assert.match(view, /结算后自动停用/);
  assert.match(view, /<option value="pending-deactivate">待任务结算后停用<\/option>/);
});
