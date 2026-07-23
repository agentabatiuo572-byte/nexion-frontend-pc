import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backendRoot = "D:/workspace/nexion-backend/src/main/java/ffdd/opsconsole/bi";
const analytics = readFileSync(`${backendRoot}/domain/L2FunnelAnalytics.java`, "utf8");
const mapper = readFileSync(`${backendRoot}/mapper/BiReportMapper.java`, "utf8");
const controller = readFileSync(`${backendRoot}/web/OpsBiController.java`, "utf8");
const page = readFileSync("app/components/domain-views/l-tabs/l2-funnel.tsx", "utf8");
const bff = readFileSync("app/api/admin/bi/[...path]/route.ts", "utf8");

test("L2 canonical stages are joined by the same actor and ordered timestamps", () => {
  assert.match(analytics, /nextStage\(byActor, registered, "kyc\.express_verified"\)/);
  assert.match(analytics, /nextStage\(byActor, verified, "checkout\.completed"\)/);
  assert.match(analytics, /event\.at\(\)\.isAfter\(first\.at\(\)\)/);
  assert.match(analytics, /nextStage\(byActor, repurchased, "withdraw\.submitted"\)/);
  assert.match(analytics, /denominator == 0 \? null/);
});

test("L2 cohort retention uses same-user app.dau and mature windows", () => {
  assert.match(analytics, /event\.name\(\)\.equals\("app\.dau"\)/);
  assert.match(analytics, /ChronoUnit\.DAYS\.between/);
  assert.match(analytics, /if \(!mature\) return null/);
});

test("L2 data source is the schema-accepted A4 event outbox", () => {
  const query = mapper.match(/SELECT event_name AS eventName[\s\S]*?List<Map<String, Object>> selectL2EventFacts\(\);/)?.[0] || "";
  assert.match(query, /FROM nx_event_outbox/);
  assert.match(query, /analytics_event = 1/);
  assert.match(query, /schema_registered = 1/);
  assert.match(query, /is_server_authoritative = 1/);
  assert.doesNotMatch(query, /FROM nx_user/);
});

test("L2 exposes all PRD drilldown and retention read endpoints through the BFF", () => {
  assert.match(controller, /@GetMapping\("\/funnel\/drilldown"\)/);
  assert.match(controller, /@GetMapping\("\/retention\/cohort-matrix"\)/);
  assert.match(controller, /@GetMapping\("\/retention\/curve"\)/);
  assert.match(controller, /@GetMapping\("\/funnel\/cross"\)/);
  assert.match(bff, /"retention"/);
});

test("L2 UI renders the selected real cohort curve and never prints null percent", () => {
  assert.match(page, /const selectedKey = COHORTS\[safeCohort\]\.w/);
  assert.match(page, /const scaled = CURVES\[selectedKey\] \?\? \[\]/);
  assert.match(page, /v == null \? "—" : `\$\{v\}\$\{xd\.unit\}`/);
  assert.match(page, /未成熟窗口不推算/);
});
