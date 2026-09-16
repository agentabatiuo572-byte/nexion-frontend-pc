import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const appRoot = resolveNexionAppRoot({ adminRoot: "D:/workspace/nexion-ops-console" });
const read = (path) => readFileSync(`${appRoot}/${path}`, "utf8");

test("I5 risk acknowledgement uses the current jurisdiction snapshot and fails closed", () => {
  const store = read("src/store/risk-disclosure.ts");
  const page = read("src/pages/me/risk-disclosure.vue");

  assert.match(store, /riskDisclosureApi\.current\(\)/);
  assert.match(store, /riskDisclosureApi\.acknowledge\(/);
  assert.match(store, /accepted\.value\s*=\s*snapshot\?\.acknowledged \?\? false/);
  const requestIsCurrentGate = /function requestIsCurrent\(request: ReturnType<typeof remoteAccountScope\.snapshot>, generation: number\) \{\s*return requestGeneration === generation && remoteAccountScope\.isCurrent\(request\);\s*\}/;
  assert.match(store, requestIsCurrentGate);
  assert.match(store, /if \(requestIsCurrent\(request, generation\)\) apply\(snapshot\)/);
  // A generation check alone is not enough: switching accounts must still invalidate the response.
  assert.doesNotMatch(store.replace(" && remoteAccountScope.isCurrent(request)", ""), requestIsCurrentGate);
  assert.match(page, /await risk\.refresh\(\)/);
  assert.match(page, /await risk\.accept\(\)/);
  assert.match(page, /v-else-if="loadError"/);
  assert.doesNotMatch(store, /writeAccountRow/);
});

test("I6 tutorial center consumes the learning API for course, quiz, completion and rewards", () => {
  const api = read("src/api/learning-api.ts");
  const list = read("src/pages/learn/courses.vue");
  const detail = read("src/pages/learn/course.vue");
  const pages = read("src/pages.json");

  assert.match(api, /path:\s*`\/api\/content\/learning\/courses\?language=/);
  assert.match(api, /\/start/);
  assert.match(api, /\/quiz/);
  assert.match(api, /\/complete/);
  assert.match(list, /learningApi\.courses/);
  assert.match(list, /GEO_COUNTRY_UNRESOLVED/);
  assert.match(detail, /learningApi\.start/);
  assert.match(detail, /learningApi\.submitQuiz/);
  assert.match(detail, /learningApi\.complete/);
  assert.match(detail, /rewardGranted/);
  assert.match(pages, /pages\/learn\/courses/);
  assert.match(pages, /pages\/learn\/course/);
});

test("I4 displays only published trust fields and fails closed without a snapshot", () => {
  const page = read("src/pages/trust/trust.vue");
  const consumer = read("src/composables/use-published-trust.ts");
  assert.match(page, /usePublishedTrust\(\)/);
  assert.match(consumer, /trustSectionApi\.current\(\)/);
  assert.match(page, /activeDevicesText = computed\(\(\) => trustFieldValue\(financialSection\.value\?\.fields \?\? \[\], "devicesOnlineValue"\) \?\? "—"\)/);
  assert.doesNotMatch(page, /publicStatsHealth|cfg\.config\.publicStats/);
  assert.match(page, /v-else-if="hasError"/);
  assert.match(consumer, /sections\.value = \[\];\s*status\.value = "error"/);
  assert.match(consumer, /if \(generation !== authorityGeneration\) return false/);
});
