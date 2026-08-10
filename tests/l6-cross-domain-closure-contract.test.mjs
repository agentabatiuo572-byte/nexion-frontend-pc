import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = "D:/workspace";
const text = (path) => readFile(`${ROOT}/${path}`, "utf8");

test("L6 stays explicitly blocked until the independent App source is integrated", async () => {
  const view = await text("nexion-ops-console/app/components/domain-views/l-tabs/l6-behavior-heatmap.tsx");
  assert.match(view, /BLOCKED_CROSS_MODULE/);
  assert.match(view, /等待跨模块接入/);
  assert.match(view, /不展示热力数值/);
  assert.match(view, /不可导出/);
});

test("backend fails closed and L6 export writes both A2 and A4", async () => {
  const [service, request, mapper, hardening] = await Promise.all([
    text("nexion-backend/src/main/java/ffdd/opsconsole/bi/application/BehaviorAnalyticsService.java"),
    text("nexion-backend/src/main/java/ffdd/opsconsole/bi/web/BehaviorEventRequest.java"),
    text("nexion-backend/src/main/java/ffdd/opsconsole/bi/mapper/BehaviorAnalyticsMapper.java"),
    text("nexion-backend/scripts/migrations/20260727_l6_behavior_acceptance_hardening.sql"),
  ]);
  for (const boundary of [
    "L6_CLIENT_EVENT_ID_INVALID", "L6_CLIENT_TIME_INVALID", "L6_EVENT_OUT_OF_ORDER",
    "L6_WINDOW_INVALID", "L6_DEPTH_INVALID", "L6_SORT_INVALID", "L6_EXPORT_EMPTY",
  ]) assert.match(service, new RegExp(boundary));
  assert.match(request, /String clientEventId/);
  assert.match(mapper, /client_event_id/);
  assert.match(mapper, /FOR UPDATE/);
  assert.match(hardening, /UNIQUE KEY uk_behavior_client_event_id/);
  assert.match(service, /auditLogService\.recordRequired/);
  assert.match(service, /outbox\.publish\("BI_REPORT", exportId, "admin\.report_exported"/);
});

test("behavior facts cannot contaminate finance, KPI/funnel main events or risk truth", async () => {
  const [l1, l2, finance, risk] = await Promise.all([
    text("nexion-backend/src/main/java/ffdd/opsconsole/bi/domain/L1KpiAnalytics.java"),
    text("nexion-backend/src/main/java/ffdd/opsconsole/bi/domain/L2FunnelAnalytics.java"),
    text("nexion-backend/src/main/java/ffdd/opsconsole/bi/mapper/L3FinanceFactMapper.java"),
    text("nexion-backend/src/main/java/ffdd/opsconsole/risk/mapper/RiskOpsMapper.java"),
  ]);
  assert.doesNotMatch(l1, /app\.page_viewed|app\.element_clicked/);
  assert.doesNotMatch(l2, /app\.page_viewed|app\.element_clicked/);
  assert.match(finance, /is_server_authoritative = 1/);
  assert.match(risk, /is_server_authoritative = 1/);
});
