import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("../app/components/domain-views/e-view.tsx", import.meta.url), "utf8");
const ops = readFileSync(new URL("../app/components/domain-views/e-tabs/e5-ops.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/e5-client.ts", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../app/api/admin/devices/[...path]/route.ts", import.meta.url), "utf8");

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

test("E5 activate and deactivate use the durable stable-command boundary", () => {
  assert.match(client, /e5StableDeviceCommand/);
  assert.match(client, /E5OutcomeUncertainError/);
  assert.doesNotMatch(client, /idempotencyPrefix:\s*"e5-device-(?:activate|deactivate)"/);
});

test("E5 proxy preserves explicit upstream uncertainty and commands reject empty success data", () => {
  assert.match(proxy, /upstream\.headers\.get\("X-Nexion-Upstream-Outcome"\)/);
  assert.match(proxy, /responseHeaders\.set\("X-Nexion-Upstream-Outcome", "unknown"\)/);
  assert.match(client, /commandKey && result\.data == null/);
  assert.match(client, /throw new E5OutcomeUncertainError\("E5_DEVICE_ACTION_OUTCOME_UNCERTAIN", commandKey\)/);
});

test("all E5 fleet and datacenter writes use the durable command boundary", () => {
  for (const name of [
    "setE5UserDevicesPaused",
    "setE5DatacenterPaused",
    "createE5Datacenter",
    "updateE5Datacenter",
    "deleteE5Datacenter",
  ]) {
    const start = client.indexOf(`export async function ${name}`);
    assert.ok(start >= 0, `${name} missing`);
    const next = client.indexOf("export async function ", start + 1);
    const body = client.slice(start, next >= 0 ? next : client.length);
    assert.match(body, /e5StableDeviceCommand\(/, `${name} bypasses the stable command boundary`);
    assert.match(body, /idempotencyKey: commandKey/, `${name} does not reuse the stable command key`);
    assert.doesNotMatch(body, /idempotencyPrefix:/, `${name} still mints a fresh key per retry`);
  }
});
