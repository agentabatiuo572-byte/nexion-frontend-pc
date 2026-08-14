import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseE5Observability } from "../lib/admin/e5-observability-contract.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("OPS-E-16 reads the fleet observability and durable activity endpoints", () => {
  const client = read("lib/admin/e5-client.ts");
  const page = read("app/components/domain-views/e-tabs/e5-ops.tsx");
  const proxy = read("app/api/admin/devices/[...path]/route.ts");

  assert.match(client, /fetchE5Observability/);
  assert.match(client, /\/observability/);
  assert.match(page, /fetchE5Observability/);
  assert.match(proxy, /parts\[0\] === "observability"/);
  assert.doesNotMatch(page, /等待后端运维事件接口返回真实事件/);
  assert.doesNotMatch(page, /后端未返回运维活动数据/);
  assert.doesNotMatch(page, /过去 24h 自动重连<\/span><span className="v">—/);
  assert.doesNotMatch(page, /调度延迟 P95<\/span><span className="v">—/);
  assert.match(client, /parseE5Observability/);
  assert.match(page, /舰队可观测数据不可用/);
  assert.match(page, /data-observability-state=/);
});

test("OPS-E-16 keeps the global online KPI and heartbeat-card metric semantics aligned", () => {
  const page = read("app/components/domain-views/e-tabs/e5-ops.tsx");

  assert.match(page, /k: "在线设备\(全网\)", v: fmtCount\(onlineDevices\)/);
  assert.match(page, /className="hb-num">\{fmtCount\(totalDevices\)\}<\/div>/);
  assert.match(page, /className="hb-lbl">设备总数 · 最近状态同步<\/div>/);
  assert.doesNotMatch(page, /className="hb-lbl">[\s\S]*在网设备/);
});

const valid = () => ({
  telemetry: {
    heartbeatLost1h: 0,
    reconnectEvents24h: 2,
    persistentOffline1h: 0,
    activeTasks: 7,
    avgGpuUsagePct: null,
    avgGpuPowerW: 120.5,
    avgCpuUsagePct: 42,
    dispatchLatencyP95Ms: 18,
    dispatchLatencySampleCount: 12,
    latestRuntimeAt: "2026-08-11T01:02:03Z",
  },
  activity: [{
    eventType: "device.reconnected",
    aggregateType: "DEVICE",
    aggregateId: "DEV-1",
    occurredAt: "2026-08-11T01:01:00Z",
  }],
  sources: ["nx_device_runtime"],
  missingMetrics: [],
});

test("OPS-E-16 accepts the complete observability schema without coercion", () => {
  assert.deepEqual(parseE5Observability(valid()), valid());
});

test("OPS-E-16 rejects malformed telemetry instead of coercing it to healthy zero", () => {
  const payload = valid();
  payload.telemetry.heartbeatLost1h = "broken";
  assert.throws(() => parseE5Observability(payload), /E5_OBSERVABILITY_SCHEMA_INVALID/);
  assert.throws(() => parseE5Observability({ activity: [] }), /E5_OBSERVABILITY_SCHEMA_INVALID/);
});

test("OPS-E-16 rejects a single malformed durable activity row instead of dropping it", () => {
  const payload = valid();
  payload.activity.push({
    eventType: "",
    aggregateType: "DEVICE",
    aggregateId: "DEV-2",
    occurredAt: "not-a-time",
  });
  assert.throws(() => parseE5Observability(payload), /E5_OBSERVABILITY_SCHEMA_INVALID/);
});
