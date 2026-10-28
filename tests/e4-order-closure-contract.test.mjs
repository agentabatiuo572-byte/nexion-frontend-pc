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
  assert.match(view, /「标记失败结果」不会退款/);
});

test("E4 detail and refund proposal carry real evidence and refund channel", async () => {
  const client = await read("lib/admin/e4-client.ts");
  const shell = await read("app/components/domain-views/e-view.tsx");
  const registry = await read("lib/admin/high-ops-registry.ts");
  const proxy = await read("app/api/admin/devices/[...path]/route.ts");
  assert.match(client, /fetchE4OrderDetail/);
  assert.match(proxy, /const isOrderItem = parts\[0\] === "orders" && parts\.length === 2/);
  assert.match(proxy, /&& !isOrderItem/);
  assert.match(shell, /充值记录、账单和累计充值一起冲回/);
  assert.match(shell, /coverageProjected/);
  assert.match(shell, /canRefundE4/);
  assert.match(registry, /refundChannel: String\(ctx\.refundChannel/);
});

test("E4 refund requires a user-visible reason that reaches the A2 command", async () => {
  const client = await read("lib/admin/e4-client.ts");
  const shell = await read("app/components/domain-views/e-view.tsx");
  const registry = await read("lib/admin/high-ops-registry.ts");
  assert.match(client, /E4_REFUND_REASONS = \["USER_REQUEST", "DUPLICATE_PAYMENT", "DELIVERY_UNAVAILABLE", "ORDER_EXCEPTION", "OTHER"\]/);
  assert.match(shell, /key: "refundReasonCode", label: "退款原因（用户可见）", current: ""/);
  assert.match(shell, /if \(!\(E4_REFUND_REASONS as readonly string\[\]\)\.includes\(refundReasonCode\)\) \{ throw new Error\("请选择退款原因"\); \}/);
  assert.match(shell, /def\.buildCommand\(\{ orderNo: mc\.orderId, refundChannel, refundReasonCode \}\)/);
  assert.match(registry, /refundReasonCode: String\(ctx\.refundReasonCode\)/);
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
