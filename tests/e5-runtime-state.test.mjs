import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register("./e5-client-test-loader.mjs", import.meta.url);
const { mapE5Device } = await import("../lib/admin/e5-client.ts");
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