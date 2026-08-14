import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pc = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = (path) => readFileSync(`D:/workspace/NX1.0-UniApp/${path}`, "utf8");
const backend = (path) => readFileSync(`D:/workspace/nexion-backend/${path}`, "utf8");

test("OPS-L-08 and OPS-L-09 expose only real registered attribution routes", () => {
  const l1 = pc("app/components/domain-views/l-tabs/l1-kpi.tsx");
  const l2 = pc("app/components/domain-views/l-tabs/l2-funnel.tsx");
  const routes = pc("app/components/domain-views/l-tabs/l-attribution-routes.ts");

  for (const href of [
    "/analytics/funnel-cohort",
    "/analytics/operations",
    "/analytics/financial",
    "/overview/rhythm",
    "/growth/phase",
    "/content/copy-ab",
    "/network/commissions",
  ]) assert.match(routes, new RegExp(href.replaceAll("/", "\\/")));
  assert.match(l1, /assertL1AttributionLinks/);
  assert.doesNotMatch(l1, /跨域归因入口\(原型占位\)/);
  assert.match(l2, /L2_ATTRIBUTION_LINKS\.map/);
  assert.doesNotMatch(l2, /原型占位/);
});

test("OPS-L-10 starts and stops the authenticated remote analytics source", () => {
  const appVue = app("src/App.vue");
  assert.match(appVue, /configureBehaviorAnalyticsContext/);
  assert.match(appVue, /startBehaviorAnalytics\(\)/);
  assert.match(appVue, /pauseBehaviorAnalytics\(\)/);
  assert.match(appVue, /enabled:\s*remoteApiEnabled\s*&&\s*auth\.isAuthenticated/);
  assert.match(appVue, /subject:\s*auth\.accountId/);
});

test("OPS-L-10 has an explicit server-side fixture with no implicit activation", () => {
  const fixture = backend("src/main/java/ffdd/opsconsole/bi/application/BehaviorAnalyticsFixtureInitializer.java");
  assert.match(fixture, /nexion\.analytics\.fixture\.enabled:false/);
  assert.match(fixture, /L6_FIXTURE_USER_ID_REQUIRED/);
  assert.match(fixture, /app\.page_viewed/);
  assert.match(fixture, /app\.element_clicked/);
  assert.match(fixture, /service\.ingest/);
});
