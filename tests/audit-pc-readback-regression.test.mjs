import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const pcRoot = path.resolve(import.meta.dirname, "..");
const backendRoot = path.resolve(pcRoot, "..", "nexion-backend");
const appRoot = path.resolve(pcRoot, "..", "NX1.0-UniApp");

const read = (root, relative) => readFileSync(path.join(root, relative), "utf8");
const pc = (relative) => read(pcRoot, relative);
const backend = (relative) => read(backendRoot, relative);
const app = (relative) => read(appRoot, relative);

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return source.slice(from, to);
}

function sourceTree(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceTree(absolute);
    return /\.(?:vue|ts)$/.test(entry.name) ? [readFileSync(absolute, "utf8")] : [];
  });
}

test("I6 readback derives namespace/message totals and names the course selected by the live featured id", () => {
  const i6 = pc("app/components/domain-views/i-tabs/i6-i18n.tsx");

  assert.doesNotMatch(i6, /30\+\s*命名空间|768\s*词条|全站\s*~?770/,
    "I6 must not present an audit-era namespace/message total as current data");
  assert.match(i6, /NAMESPACES\.length/, "I6 must derive the namespace total from the overview payload");
  assert.match(i6, /MESSAGES\.length/, "I6 must derive the message total from the overview payload");

  assert.doesNotMatch(i6, /当前固定第\s*1\s*课[「\"]What is Nexion\s*[·.]\s*5 分钟速成[」\"]/,
    "the recommendation panel must not retain the old hard-coded first-course title");
  assert.match(i6, /COURSES\.find\(\(course\)\s*=>\s*course\.id\s*===\s*TUTORIAL_FEATURED_DEFAULT\)/,
    "the PC readback must resolve the current featured id against returned course data");
  assert.match(i6, /featuredCourse\?\.title/, "the PC must display the resolved featured course title, not an id or legacy label");
});

test("a missing featured flag remains unconfigured; it never silently promotes the first published course", () => {
  const service = backend("src/main/java/ffdd/opsconsole/content/application/OpsI18nLearningService.java");
  const featured = section(service, "private String featuredCourseId", "private ApiResult<Void> requireCoursePayload");

  assert.match(featured, /filter\(LearningCourseView::featured\)/,
    "only a course explicitly marked featured may populate featuredCourseId");
  assert.match(featured, /\.orElse\(\"\"\)/,
    "no true featured course must be returned as an explicit empty selection");
  assert.doesNotMatch(featured, /orElseGet|\.filter\(row\s*->\s*"published"\.equals\(row\.status\(\)\)\)/,
    "falling back to the first published course fabricates a recommendation");
});

test("App home and learning center select a recommendation exclusively from the server featured flag", () => {
  const learningApi = app("src/api/learning-api.ts");
  const learningCenter = app("src/pages/learn/courses.vue");
  const homeAndLearningSurfaces = [
    learningCenter,
    app("src/pages/index/index.vue"),
    ...sourceTree(path.join(appRoot, "src", "components", "home")),
  ].join("\n");

  assert.match(learningApi, /featured:\s*boolean/,
    "the App contract must retain the server-owned featured flag");
  assert.match(learningCenter, /featuredCourse\s*=\s*computed\([\s\S]*?\.find\(\(course\)\s*=>\s*course\.featured\)/,
    "the learning center must choose only an explicitly featured course");
  assert.match(learningCenter, /featuredCourse\?\.title/,
    "the learning-center recommendation card must render the selected server course");
  assert.match(homeAndLearningSurfaces, /\.find\(\(course\)\s*=>\s*course\.featured\)/,
    "the home recommendation card must consume the same featured flag");
  assert.doesNotMatch(homeAndLearningSurfaces, /courses\s*\[\s*0\s*\]/,
    "neither recommendation surface may fabricate a fallback from the first course");
});

test("F2 exposes no writable controls for parameters that have no settlement consumer, and the backend fails their writes closed", () => {
  const f2 = pc("app/components/domain-views/f-tabs/f2-rates.tsx");
  const teamService = backend("src/main/java/ffdd/opsconsole/team/application/OpsTeamService.java");
  const updateConfig = section(teamService, "private ApiResult<Map<String, Object>> updateConfigInternal", "private ApiResult<Map<String, Object>> updateUiConfig");
  const updateUiConfig = section(teamService, "private ApiResult<Map<String, Object>> updateUiConfig", "private Long bumpLeadershipPoolConfigVersion");
  const replayUiConfig = section(teamService, 'case "f_ui_config"', 'case "f_config_batch"');

  const visible = f2.match(/const F2_VISIBLE_PARAM_KEYS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(visible, "F2 needs a bounded list of controls that are actually supported");
  for (const key of ["F.royalty.minPayout", "F.peer.rate"]) {
    assert.ok(!visible[1].includes(key), `${key} has no settlement consumer and must not have an editable PC control`);
  }
  assert.match(f2, /未接入实际结算/, "F2 must disclose why these values are unavailable");
  assert.match(f2, /不可调整/, "F2 must not imply that an unavailable value is operationally writable");

  for (const key of ["F.royalty.minPayout", "F.peer.rate"]) {
    assert.match(teamService, new RegExp(`(?:Set|List)\\.of\\([\\s\\S]{0,400}?"${key.replaceAll(".", "\\.")}"`),
      `${key} must be part of the explicit backend rejection policy`);
  }
  assert.match(updateConfig, /F2_[A-Z_]*(?:UNAVAILABLE|NOT_CONSUMED|UNSUPPORTED)|(?:UNAVAILABLE|NOT_CONSUMED|UNSUPPORTED)[A-Z_]*F2/,
    "writes for unconsumed F2 parameters need a stable fail-closed reason");
  assert.match(updateConfig, /ApiResult\.fail\(/,
    "the F2 rejection must be a controlled API response rather than a silently accepted UI preference");
  assert.match(replayUiConfig, /return updateUiConfig\(/,
    "A2's f_ui_config replay path must enter the same fail-closed writer");
  assert.match(updateUiConfig,
    /rejectUnconsumedF2(?:Parameter|Key)\(key\)|Set\.of\(\s*"F\.royalty\.minPayout",\s*"F\.peer\.rate"\s*\)\.contains\(key\)/,
    "A2 f_ui_config must reject the two unconsumed F2 keys too; it must not bypass updateConfigInternal");
});

test("the home recommendation drops stale responses across visibility, account, locale, and runtime-revision changes", () => {
  const card = app("src/components/home/featured-learning-card.vue");

  assert.match(card, /let visible = false/, "a hidden home must not accept a late recommendation response");
  assert.match(card, /let generation = 0/, "the card needs a request generation fence");
  assert.match(card, /const ownGeneration = \+\+generation/, "each refresh must invalidate older requests");
  for (const scopeFact of ["app.accountKey", "app.accountBindingEpoch", "language.value", "captureRuntimeRevision().epoch"]) {
    assert.ok(card.includes(scopeFact), `the accepted response must include ${scopeFact} in its authority scope`);
  }
  assert.match(card, /visible && ownGeneration === generation && scope ===/, "only the current visible request may populate the card");
  assert.match(card, /onHide\(hide\).*onUnmounted\(hide\)/s, "hide and unmount must invalidate pending requests");
  assert.match(card, /watch\(\(\) => \[app\.accountKey, app\.accountBindingEpoch, language\.value\]/,
    "account and locale changes must force a fresh server read");
});
