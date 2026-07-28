import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("E4 uses the PRD canonical order vocabulary", async () => {
  const data = await read("app/components/domain-views/e-tabs/data.ts");
  const view = await read("app/components/domain-views/e-tabs/e4-orders.tsx");
  assert.match(data, /ORDER_FLOW = \["placed", "paid", "provisioning", "activated"\]/);
  assert.match(data, /"chargeback"/);
  assert.doesNotMatch(view, /"created", "paid", "allocating", "active"/);
  assert.doesNotMatch(view, /nx_order/);
  assert.match(view, /补建失败终态不包含退款/);
});

test("E4 detail and refund proposal carry real evidence and refund channel", async () => {
  const client = await read("lib/admin/e4-client.ts");
  const shell = await read("app/components/domain-views/e-view.tsx");
  const registry = await read("lib/admin/high-ops-registry.ts");
  const proxy = await read("app/api/admin/devices/[...path]/route.ts");
  assert.match(client, /fetchE4OrderDetail/);
  assert.match(proxy, /const isOrderItem = parts\[0\] === "orders" && parts\.length === 2/);
  assert.match(proxy, /&& !isOrderItem/);
  assert.match(shell, /D1\/D4\/钱包\/累计充值同事务回退/);
  assert.match(shell, /coverageProjected/);
  assert.match(shell, /canRefundE4/);
  assert.match(registry, /refundChannel: String\(ctx\.refundChannel/);
});

test("E4 removes reverse transitions and illegal refund terminal", async () => {
  const shell = await read("app/components/domain-views/e-view.tsx");
  const data = await read("app/components/domain-views/e-tabs/data.ts");
  assert.doesNotMatch(shell, /回滚上一态/);
  assert.doesNotMatch(shell, /failed 重新置为 allocating/);
  assert.doesNotMatch(data, /TERMINAL_STATES = \[[^\]]*"refunded"/);
});

test("E4 search and manual progress fail closed around D1 D4 and E5 evidence", async () => {
  const view = await read("app/components/domain-views/e-tabs/e4-orders.tsx");
  const shell = await read("app/components/domain-views/e-view.tsx");
  const types = await read("app/components/domain-views/e-tabs/types.ts");

  assert.match(view, /aria-label="搜索订单"/);
  assert.match(types, /e4Keyword: string/);
  assert.match(shell, /keyword: e4Keyword/);
  assert.match(shell, /ORDER_PAYMENT_CONFIRMATION_REQUIRED/);
  assert.match(shell, /ORDER_PROVISIONING_EVIDENCE_REQUIRED/);
  assert.match(shell, /deviceActivatedAt/);
  assert.match(shell, /\/platform\/audit\?domain=E&object=/);
  assert.match(shell, /\/platform\/events/);
});
