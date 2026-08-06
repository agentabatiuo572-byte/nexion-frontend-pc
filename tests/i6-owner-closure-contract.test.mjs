import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const backendService = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/content/application/OpsI18nLearningService.java", import.meta.url),
  "utf8",
);
const backendRepository = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/content/infrastructure/MybatisI18nLearningRepository.java", import.meta.url),
  "utf8",
);
const appRoot = resolveNexionAppRoot({ adminRoot: process.cwd() });
const appRuntime = readFileSync(resolve(appRoot, "src/store/i18n-runtime.ts"), "utf8");
const appTranslations = readFileSync(resolve(appRoot, "src/i18n/use-t.ts"), "utf8");
const appLocaleStore = readFileSync(resolve(appRoot, "src/store/locale.ts"), "utf8");

test("I6 locks version rows and rejects stale draft, publish and archive commands", () => {
  assert.match(backendRepository, /LIMIT 1 FOR UPDATE/);
  assert.match(backendService, /findMessagePairForUpdate/);
  assert.match(backendService, /findPublishedMessagePairForUpdate/);
  assert.match(backendService, /I18N_MESSAGE_VERSION_CONFLICT/);
  assert.match(backendService, /I18N_DRAFT_VERSION_CONFLICT/);
});

test("I6 keeps immutable version history and restores an archived snapshot as a new version", () => {
  assert.match(backendRepository, /listMessageVersions/);
  assert.match(backendRepository, /restoreMessageVersion/);
  assert.match(backendRepository, /setVersionNo\(value\(current\.getVersionNo\(\)\) \+ 1\)/);
  assert.match(backendService, /rollbackLocalizedMessage/);
  assert.match(backendService, /I6_I18N_MESSAGE_ROLLED_BACK/);
});

test("I6 publishes required A4 governance facts and rejects raw HTML", () => {
  assert.match(backendService, /admin\.i18n_published/);
  assert.match(backendService, /admin\.i18n_rolledback/);
  assert.match(backendService, /HTML_TAG_PATTERN/);
});

test("App consumes server-canonical language bundles with cache and bundled fallback", () => {
  assert.match(appRuntime, /i18nApi\.all/);
  assert.match(appRuntime, /CACHE_MAX_AGE_MS/);
  assert.match(appRuntime, /status\.value\[locale\] = bundles\.value\[locale\] \? "stale" : "fallback"/);
  assert.match(appTranslations, /applyRuntimeMessages/);
  assert.match(appLocaleStore, /LOCALES\.some\(\(locale\) => locale\.code === saved\.code\)/);
});
