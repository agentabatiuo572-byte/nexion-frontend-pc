import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("../app/components/domain-views/e-view.tsx", import.meta.url), "utf8");
const ops = readFileSync(new URL("../app/components/domain-views/e-tabs/e5-ops.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/e5-client.ts", import.meta.url), "utf8");

test("E5 maker-only Growth can see force and unbind proposal actions without direct mutation access", () => {
  assert.match(view, /session\?\.role === "growth"[\s\S]{0,180}platform_a2_proposal_create/);
  assert.match(view, /canForceActivateE5 = hasForceActivateE5 \|\| canProposeE5/);
  assert.match(view, /canUnbindE5 = hasUnbindE5 \|\| canProposeE5/);
  assert.match(ops, /isActivatable\(d\.state\) && \(ctx\.canWriteE5 \|\| ctx\.canForceActivateE5\)/);
  assert.match(ops, /ctx\.canWriteE5 && d\.state === "inventory"/);
  assert.match(ops, /isDeactivatable\(d\.state\) && \(ctx\.canWriteE5 \|\| ctx\.canUnbindE5\)/);
  assert.match(ops, /ctx\.canWriteE5 && <button[\s\S]{0,350}>取消激活<\/button>/);
});

test("E5 canonical UNBOUND state renders as unbound and cannot expose active-device actions", () => {
  assert.match(client, /\["RECYCLED", "DEACTIVATED", "RETIRED", "UNBOUND"\]\.includes\(status\)/);
  assert.match(ops, /return state === "active" \|\| state === "busy" \|\| state === "offline" \|\| state === "abnormal"/);
  assert.doesNotMatch(ops, /isDeactivatable[\s\S]{0,180}state === "unbound"/);
});

test("E5 datacenter delete copy matches the backend cross-domain hard guard", () => {
  assert.match(view, /服务端会硬阻断仍被 E5 设备、E4 待履约订单或 E1 SKU 引用的数据中心/);
  assert.match(view, /三类引用计数全部为 0 后才允许删除/);
  assert.doesNotMatch(view, /系统不做跨域硬阻断/);
  assert.doesNotMatch(view, /孤儿引用/);
});
