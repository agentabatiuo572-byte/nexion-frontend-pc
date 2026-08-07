import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backendRoot = "D:/workspace/nexion-backend/src/main/java/ffdd/opsconsole/bi";
const analytics = readFileSync(`${backendRoot}/domain/L2FunnelAnalytics.java`, "utf8");
const mapper = readFileSync(`${backendRoot}/mapper/BiReportMapper.java`, "utf8");
const controller = readFileSync(`${backendRoot}/web/OpsBiController.java`, "utf8");
const service = readFileSync(`${backendRoot}/application/OpsBiService.java`, "utf8");
const repository = readFileSync(`${backendRoot}/infrastructure/MybatisBiReportRepository.java`, "utf8");
const artifactStore = readFileSync(`${backendRoot}/infrastructure/BiReportArtifactStore.java`, "utf8");
const page = readFileSync("app/components/domain-views/l-tabs/l2-funnel.tsx", "utf8");
const client = readFileSync("lib/admin/l-client.ts", "utf8");
const bff = readFileSync("app/api/admin/bi/[...path]/route.ts", "utf8");

test("L2 canonical stages are joined by the same actor and ordered timestamps", () => {
  assert.match(analytics, /nextStage\(byActor, registered, "checkout\.completed"\)/);
  assert.match(analytics, /event\.at\(\)\.isAfter\(first\.at\(\)\)/);
  assert.match(analytics, /nextStage\(byActor, repurchased, "withdraw\.submitted"\)/);
  assert.match(analytics, /denominator == 0 \? null/);
});

test("L2 cohort retention uses same-user app.dau and mature windows", () => {
  assert.match(analytics, /event\.name\(\)\.equals\("app\.dau"\)/);
  assert.match(analytics, /ChronoUnit\.DAYS\.between/);
  assert.match(analytics, /if \(!mature\) return null/);
  assert.match(analytics, /BUSINESS_TIME_OFFSET = ZoneOffset\.ofHours\(8\)/);
  assert.match(analytics, /lateArrivals", "included_on_next_query"/);
});

test("L2 data source is the schema-accepted A4 event outbox", () => {
  const query = mapper.match(/SELECT event_name AS eventName[\s\S]*?List<Map<String, Object>> selectL2EventFacts\(\);/)?.[0] || "";
  assert.match(query, /FROM nx_event_outbox/);
  assert.match(query, /analytics_event = 1/);
  assert.match(query, /schema_registered = 1/);
  assert.match(query, /is_server_authoritative = 1/);
  assert.doesNotMatch(query, /OR event_name = 'trial\./);
  assert.doesNotMatch(query, /FROM nx_user/);
});

test("L2 exposes all PRD drilldown and retention read endpoints through the BFF", () => {
  assert.match(controller, /@GetMapping\("\/funnel\/drilldown"\)/);
  assert.match(controller, /@GetMapping\("\/retention\/cohort-matrix"\)/);
  assert.match(controller, /@GetMapping\("\/retention\/curve"\)/);
  assert.match(controller, /@GetMapping\("\/funnel\/cross"\)/);
  assert.match(bff, /"retention"/);
  assert.match(client, /fetchL2FunnelDrilldown/);
  assert.match(client, /fetchL2RetentionMatrix/);
  assert.match(client, /fetchL2RetentionCurve/);
  assert.match(client, /fetchL2Cross/);
});

test("L2 UI renders the selected real cohort curve and never prints null percent", () => {
  assert.match(page, /const selectedKey = COHORTS\[safeCohort\]\.w/);
  assert.match(page, /const scaled = CURVES\[selectedKey\] \?\? \[\]/);
  assert.match(page, /v == null \? "—" : `\$\{v\}\$\{xd\.unit\}`/);
  assert.match(page, /未成熟窗口不推算/);
  assert.match(page, /isStrictL2Dashboard/);
  assert.match(page, /L2 响应协议错误/);
});

test("L2 filters and exports are computed server-side from the registration actor set", () => {
  assert.match(repository, /L2FunnelAnalytics\.calculate\(\s*mapper\.selectL2EventFacts\(\), cohort, phase, locale, ref\)/);
  assert.match(service, /reportRepository\.l2Dashboard\(/);
  assert.match(service, /reportCsv\(created, request\)/);
  assert.match(service, /trimOrDefault\(request\.cohort\(\), ""\)/);
  assert.match(service, /trimOrDefault\(request\.phase\(\), ""\)/);
  assert.match(service, /trimOrDefault\(request\.locale\(\), ""\)/);
  assert.match(service, /trimOrDefault\(request\.ref\(\), ""\)/);
  assert.match(page, /应用切片/);
  assert.doesNotMatch(page, /固定四个渠道样本/);
});

test("L2 export reuses the visible fallback, rejects empty snapshots, and binds artifact evidence", () => {
  assert.match(service, /hasL2Filters\(request\)\s*\?\s*reportRepository\.l2Dashboard\(/);
  assert.match(service, /:\s*reportRepository\.dashboard\("L2"\)/);
  assert.match(service, /L2_EXPORT_EMPTY/);
  assert.match(service, /"artifactSha256",\s*snapshot\.sha256\(\)/);
  assert.match(service, /"artifactSizeBytes",\s*snapshot\.sizeBytes\(\)/);
  assert.match(service, /"rowCount",\s*created\.rowCount\(\)/);
  assert.match(artifactStore, /objectStorage\.put\(objectKey,\s*CONTENT_TYPE,\s*new ByteArrayInputStream\(bytes\),\s*bytes\.length\)/);
  assert.match(artifactStore, /mapper\.upsertArtifact\([\s\S]*?bytes\.length,\s*sha256\(bytes\)\)/);
  assert.match(page, /liveStages\.length > 0/);
});
