import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backend = new URL("../../nexion-backend/", import.meta.url);

test("L4 mapper accepts canonical snake/camel event keys and exposes commission source attribution", async () => {
  const mapper = await readFile(new URL("src/main/java/ffdd/opsconsole/bi/mapper/BiReportMapper.java", backend), "utf8");
  assert.match(mapper, /event_id AS eventId[\s\S]*?selectL4EventFacts/);
  assert.match(mapper, /\$\.user_id[\s\S]*?\$\.userId/);
  assert.match(mapper, /\$\.source_user_id[\s\S]*?\$\.sourceUserId[\s\S]*?AS sourceActorId/);
});

test("L4 backend fixes business timezone, replay deduplication, source attribution and strict query validation", async () => {
  const analytics = await readFile(new URL("src/main/java/ffdd/opsconsole/bi/domain/L4OperationsAnalytics.java", backend), "utf8");
  const service = await readFile(new URL("src/main/java/ffdd/opsconsole/bi/application/OpsBiService.java", backend), "utf8");
  assert.match(analytics, /ZoneOffset\.ofHours\(8\)/);
  assert.match(analytics, /duplicateEventsIgnored/);
  assert.match(analytics, /orderedSourceActors[\s\S]*?item\.sourceActor\(\)/);
  assert.match(service, /L4_PERIOD_INVALID/);
  assert.match(service, /L4_PHASE_INVALID/);
  assert.match(service, /L4_CUSTOM_RANGE_INVALID/);
});

test("L4 network tree export uses the same rolling day/week/month windows as the visible report", async () => {
  const mapper = await readFile(new URL("src/main/java/ffdd/opsconsole/bi/mapper/BiReportMapper.java", backend), "utf8");
  assert.match(mapper, /WHEN 'day' THEN DATE_SUB\(NOW\(\), INTERVAL 1 DAY\)/);
  assert.match(mapper, /WHEN 'month' THEN DATE_SUB\(NOW\(\), INTERVAL 30 DAY\)/);
});
