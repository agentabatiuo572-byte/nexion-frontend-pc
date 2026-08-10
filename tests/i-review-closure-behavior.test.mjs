import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const app = resolveNexionAppRoot({ adminRoot: "D:/workspace/nexion-ops-console" });
const read = (path) => readFileSync(`${app}/${path}`, "utf8");

test("I5 requires a uni scroll-to-lower event and never opens reading proof by fallback", () => {
  const page = read("src/pages/me/risk-disclosure.vue");
  assert.match(page, /<scroll-view[\s\S]*@scrolltolower="onScrollToLower"/);
  assert.match(page, /function onScrollToLower\(\)/);
  assert.doesNotMatch(page, /IntersectionObserver|scrolledToBottom\.value\s*=\s*true;\s*return;/);
});

test("I3 follows cursor pages, retries failures and navigates only by canonical CTA route", () => {
  const store = read("src/store/notifications.ts");
  const page = read("src/pages/me/notifications.vue");
  assert.match(store, /nextCursor/);
  assert.match(store, /loadMoreRemote/);
  assert.match(store, /new Set<string>\(\)/);
  assert.match(store, /notificationApi\.recordAction/);
  assert.match(store, /notification-cta-/);
  assert.match(page, /await notifs\.recordCta/);
  assert.match(page, /notifs\.retryRemote/);
});

test("I6 applies the fetched runtime bundle at startup and locale changes, with bundled fallback", () => {
  const main = read("src/main.ts");
  const useT = read("src/i18n/use-t.ts");
  const runtime = read("src/store/i18n-runtime.ts");
  assert.match(main, /useI18nRuntime\(pinia\)/);
  assert.match(main, /runtimeI18n\.refresh\(locale\.code\)/);
  assert.match(main, /watch\(\(\) => locale\.code/);
  assert.match(useT, /useI18nRuntime\(\)/);
  assert.match(useT, /runtime\.messages\(locale\.code\)/);
  assert.match(useT, /bundled fallback/);
  assert.match(runtime, /status\.value\[locale\]\s*===\s*"ready"/);
});

test("I6 quiz mutations carry a stable idempotency key and recover authoritative state", () => {
  const api = read("src/api/learning-api.ts");
  const page = read("src/pages/learn/course.vue");
  const backend = "D:/workspace/nexion-backend/src/main/java/ffdd/opsconsole/content";
  const controller = readFileSync(`${backend}/web/AppLearningController.java`, "utf8");
  const service = readFileSync(`${backend}/application/AppLearningService.java`, "utf8");
  const dto = readFileSync(`${backend}/dto/AppLearningQuizSubmitRequest.java`, "utf8");
  assert.match(api, /submitQuiz\(courseId: string, answers: number\[\], idempotencyKey: string\)/);
  assert.match(api, /idempotencyKey:\s*key\(idempotencyKey\)/);
  assert.match(page, /quizKey\.value/);
  assert.match(page, /submitQuiz\(course\.value\.id, answers\.value, quizKey\.value\)/);
  assert.match(page, /await recoverAuthoritative\(\)/);
  assert.match(page, /course\.value\.version/);
  assert.match(controller, /@RequestHeader\(value = OpsAdminApi\.IDEMPOTENCY_KEY_HEADER/);
  assert.match(dto, /List<Integer> answers, String idempotencyKey/);
  assert.match(service, /AdminIdempotencyService/);
  assert.match(service, /APP_LEARNING_QUIZ:/);
  assert.match(service, /AppLearningQuizResult\.class/);
});
