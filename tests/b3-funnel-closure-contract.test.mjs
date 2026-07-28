import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/_console/overview/funnel/page.tsx", "utf8");
const client = readFileSync("lib/admin/b3-client.ts", "utf8");
const bff = readFileSync("app/api/admin/funnel/[[...path]]/route.ts", "utf8");
const controller = readFileSync(
  "D:/workspace/nexion-backend/src/main/java/ffdd/opsconsole/bi/web/OpsFunnelController.java",
  "utf8",
);
const service = readFileSync(
  "D:/workspace/nexion-backend/src/main/java/ffdd/opsconsole/bi/application/OpsFunnelService.java",
  "utf8",
);
const mapper = readFileSync(
  "D:/workspace/nexion-backend/src/main/java/ffdd/opsconsole/bi/mapper/BiReportMapper.java",
  "utf8",
);

test("B3 reads a dedicated A4-backed funnel API instead of treasury projections", () => {
  assert.match(client, /\/api\/admin\/funnel/);
  assert.doesNotMatch(page, /useBDomainDashboard|treasury\/b-domain/);
  assert.match(mapper, /selectB3EventFacts/);
  assert.match(mapper, /FROM nx_event_outbox/);
  assert.match(mapper, /schema_registered = 1/);
  assert.match(mapper, /analytics_event = 1/);
});

test("B3 exposes every PRD interaction and cross-domain link", () => {
  for (const label of ["cohort", "phase", "ref", "Day0 接入率", "Day7 留存率", "保存为视图", "导出 cohort", "归因", "L2 完整下钻"]) {
    assert.match(page, new RegExp(label));
  }
  for (const endpoint of ["/export", "/view"]) {
    assert.match(client, new RegExp(endpoint.replace("/", "\\/")));
  }
  assert.doesNotMatch(client, /\/aux-metrics|\/cohort-trend/);
  assert.match(client, /stage/);
});

test("B3 server validates filters, authorizes each operation and records audit", () => {
  assert.match(controller, /overview_b3_read/);
  assert.match(controller, /overview_b3_view_write/);
  assert.match(controller, /overview_b3_export/);
  assert.match(service, /B3_COHORT_INVALID/);
  assert.match(service, /B3_PHASE_INVALID/);
  assert.match(service, /B3_REF_INVALID/);
  assert.match(service, /admin\.funnel_view_saved/);
  assert.match(service, /admin\.report_exported/);
  assert.match(bff, /"aux-metrics"/);
  assert.match(bff, /"cohort-trend"/);
});
