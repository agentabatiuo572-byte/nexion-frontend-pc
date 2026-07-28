import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("B4 owns an independent fail-closed client and exact phase proxy", () => {
  const client = read("lib/admin/b4-client.ts");
  const route = read("app/api/admin/phase/[[...path]]/route.ts");

  assert.match(client, /\/api\/admin\/phase\/overview/);
  assert.match(client, /\/api\/admin\/phase\/distribution\/export/);
  assert.match(client, /B4_BACKEND_UNAVAILABLE|B4_PHASE_LOAD_FAILED/);
  assert.match(client, /resetAdminSession/);
  assert.doesNotMatch(client, /useBDomainDashboard|localStorage|mock/i);
  assert.match(route, /overview/);
  assert.match(route, /distribution/);
  assert.match(route, /export/);
  assert.match(route, /jump/);
  assert.match(route, /ADMIN_AUTH_REQUIRED/);
  assert.match(route, /B4_ROUTE_NOT_FOUND/);
});

test("B4 page renders the PRD read-only workflow and exact permission gates", () => {
  const page = read("app/_console/overview/rhythm/page.tsx");

  assert.match(page, /分布粒度/);
  assert.match(page, /Phase 粒度/);
  assert.match(page, /月粒度/);
  assert.match(page, /8-dial/);
  assert.match(page, /V1 生效状态/);
  assert.match(page, /距下一月粒度拐点/);
  assert.match(page, /本月被推动的杠杆组合/);
  assert.match(page, /overview_b4_export/);
  assert.match(page, /overview_b4_jump/);
  assert.match(page, /Phase 效果归因/);
  assert.match(page, /data\.attributionLinks/);
  assert.doesNotMatch(page, /Premium|NEXv2|NEX v2/);
  assert.doesNotMatch(page, /调 Phase dial/);
});

test("B4 backend contract is H1-canonical, audited and exact-RBAC", () => {
  const controller = read("../nexion-backend/src/main/java/ffdd/opsconsole/overview/web/OpsPhaseController.java");
  const service = read("../nexion-backend/src/main/java/ffdd/opsconsole/overview/application/OpsPhaseOverviewService.java");
  const migration = read("../nexion-backend/scripts/migrations/20260723_b4_phase_overview.sql");

  assert.match(controller, /\/phase/);
  assert.match(controller, /\/overview/);
  assert.match(controller, /\/distribution\/export/);
  assert.match(controller, /overview_b4_read/);
  assert.match(controller, /overview_b4_export/);
  assert.match(controller, /overview_b4_jump/);
  assert.match(service, /GrowthRhythmFacade/);
  assert.match(service, /admin\.phase_overview_viewed/);
  assert.match(service, /admin\.phase_h1_jump_opened/);
  assert.match(service, /admin\.report_exported/);
  assert.match(service, /recordRequired/);
  assert.match(service, /B3 转化归因/);
  assert.match(service, /B1 全局资金健康/);
  assert.match(service, /B2 全局到期与资金池/);
  assert.doesNotMatch(service, /Premium|NEXv2|NEX v2/);
  assert.match(migration, /SUPER_ADMIN/);
  assert.match(migration, /GROWTH/);
  assert.match(migration, /FINANCE/);
  assert.match(migration, /AUDITOR/);
});

test("H1 attribution returns to the canonical B4 rhythm route", () => {
  const h1 = read("app/components/domain-views/h-tabs/h1-phase.tsx");

  assert.match(h1, /href="\/overview\/rhythm"[^>]*>去 B4 节奏看板/);
  assert.doesNotMatch(h1, /href="\/risk\/health-monitor"[^>]*>去 B4 节奏看板/);
  assert.match(h1, /params\.get\("from"\) === "B4"/);
  assert.match(h1, /B4 定位/);
});
