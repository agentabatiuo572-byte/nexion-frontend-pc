import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const ROOT = "D:/workspace";
// The acceptance App checkout is deliberately isolated from the developer's
// mutable NX1.0 worktree. NEXION_APP_ROOT selects that locked checkout.
const APP_ROOT = resolveNexionAppRoot({ adminRoot: process.cwd() });

async function text(path) {
  return readFile(`${ROOT}/${path}`, "utf8");
}

async function appText(path) {
  return readFile(`${APP_ROOT}/${path}`, "utf8");
}

test("current App produces only privacy-minimized non-authoritative L6 behavior facts", async () => {
  const [tracker, app, migration] = await Promise.all([
    appText("src/services/behavior-analytics.ts"),
    appText("src/App.vue"),
    text("nexion-backend/scripts/migrations/20260723_l6_behavior_analytics.sql"),
  ]);

  assert.match(tracker, /clientEventId/);
  assert.match(tracker, /app\.page_viewed/);
  assert.match(tracker, /app\.element_clicked/);
  assert.match(tracker, /split\(\/\[\?#\]\//);
  assert.doesNotMatch(tracker, /innerText|textContent|rawText/);
  assert.match(app, /import \{ pauseBehaviorAnalytics, startBehaviorAnalytics \} from "@\/services\/behavior-analytics"/);
  assert.match(app, /onShow\(\(\) => \{[\s\S]*?startBehaviorAnalytics\(\)/);
  assert.match(app, /onHide\(\(\) => \{[\s\S]*?pauseBehaviorAnalytics\(\)/);
  assert.match(migration, /'app\.page_viewed'.*?,0,'100%'/s);
  assert.match(migration, /'app\.element_clicked'.*?,0,'client-throttle-350ms'/s);
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

test("the 2026-07-27 catalog delta covers every current pages.json route", async () => {
  const [pagesJson, base, delta] = await Promise.all([
    appText("src/pages.json"),
    text("nexion-backend/scripts/migrations/20260723_l6_behavior_analytics.sql"),
    text("nexion-backend/scripts/migrations/20260727_l6_behavior_acceptance_hardening.sql"),
  ]);
  const pages = JSON.parse(pagesJson).pages.map((page) => `/${page.path}`);
  for (const route of pages) {
    assert.ok(base.includes(`'${route}'`) || delta.includes(`'${route}'`), `catalog missing ${route}`);
  }
  for (const removed of [
    "/pages/me/wrapped", "/pages/learn/learn", "/pages/learn/course",
    "/pages/me/replay-tour", "/pages/me/wallet-nex-v2-lock",
  ]) assert.match(delta, new RegExp(removed.replaceAll("/", "\\/")));
});
