import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register("./e5-client-test-loader.mjs", import.meta.url);
const { mapE5Device, e5HeartbeatLagMinutes } = await import("../lib/admin/e5-client.ts");
for (const [status, runtimeStatus, expected] of [
  ["ACTIVE", "ONLINE", "active"], ["ACTIVE", "OFFLINE", "offline"],
  ["ACTIVE", null, "unknown"], ["ONLINE", "OFFLINE", "offline"],
  ["BUSY", "ONLINE", "busy"], ["BUSY", "OFFLINE", "offline"],
  ["ACTIVE", "ERROR", "abnormal"], ["DEACTIVATED", "ONLINE", "unbound"],
  ["INVENTORY", "ONLINE", "inventory"], ["ACTIVE", "garbage", "unknown"],
  ["INACTIVE", "ONLINE", "inventory"], ["garbage", "ONLINE", "unknown"],
]) test(`${status}/${runtimeStatus} maps to ${expected}`, () => {
  const row = mapE5Device({id:42,userId:7,status,runtimeStatus,activatedAt:"2026-09-01T12:00:00",activeDevicesForUser:2});
  assert.equal(row.state, expected);
  assert.equal(row.rawStatus, status);
  assert.equal(row.activeDevicesForUser, 2);
});
test("pending deactivation retains priority", () => {
  assert.equal(mapE5Device({id:42,userId:7,status:"ACTIVE",runtimeStatus:"ONLINE",pendingDeactivate:true}).state,"pending-deactivate");
});

test("online runtime cannot invent activation or revive an ended activation", () => {
 assert.equal(mapE5Device({id:42,userId:7,status:"ACTIVE",runtimeStatus:"ONLINE",activatedAt:null}).state,"unknown");
 assert.equal(mapE5Device({id:42,userId:7,status:"ACTIVE",runtimeStatus:"ONLINE",activatedAt:"2026-09-01T12:00:00",deactivatedAt:"2026-09-02T12:00:00"}).state,"unknown");
});

test("newly delivered INACTIVE without activation time remains ordinary inventory", () => {
  assert.equal(mapE5Device({id:42,userId:7,status:"INACTIVE",runtimeStatus:null,activatedAt:null}).state,"inventory");
});
test("lifecycle values copied into telemetry cannot manufacture online proof", () => {
  for (const status of ["ACTIVE","BUSY","RUNNING"]) {
    assert.equal(mapE5Device({id:42,userId:7,status,runtimeStatus:status,activatedAt:"2026-09-01T12:00:00"}).state,"unknown");
  }
});

test("E5 displays effective offline state without letting lastSeenAt invent a heartbeat", () => {
  const device = mapE5Device({ id: 42, userId: 7, status: "BUSY", runtimeStatus: "OFFLINE",
    activatedAt: "2026-09-01T12:00:00", lastSeenAt: "2026-09-30T12:00:00",
    heartbeatAt: null, heartbeatAgeSeconds: null });
  assert.equal(device.state, "offline");
  assert.equal(device.rawStatus, "BUSY");
  assert.equal(device.heartbeatAt, "—");
  assert.equal(device.heartbeatAgeSeconds, null);
});

test("heartbeat freshness uses exact database age without browser clock or minute rounding", () => {
  for (const [age, expected] of [[0, 0], [600, 10], [600.000001, 600.000001 / 60], [600.001, 600.001 / 60], [601, 601 / 60]]) {
    const device = mapE5Device({ id: 42, userId: 7, heartbeatAgeSeconds: String(age) });
    assert.equal(e5HeartbeatLagMinutes(device.heartbeatAgeSeconds), expected);
    assert.equal(e5HeartbeatLagMinutes(device.heartbeatAgeSeconds) <= 10, age <= 600);
  }
  for (const age of [null, undefined, "", "bad", -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const device = mapE5Device({ id: 42, userId: 7, heartbeatAgeSeconds: age });
    assert.equal(device.heartbeatAgeSeconds, null);
    assert.equal(e5HeartbeatLagMinutes(device.heartbeatAgeSeconds), null);
  }
  assert.deepEqual([null, -1, 600, 600.001].map(e5HeartbeatLagMinutes).filter((value) => value != null),
    [10, 600.001 / 60]);
});
