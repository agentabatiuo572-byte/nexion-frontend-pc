import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const pcRoot = "D:/workspace/nexion-ops-console";
const backendRoot = "D:/workspace/nexion-backend";
const appRoot = resolveNexionAppRoot({ adminRoot: pcRoot });
const read = (root, path) => readFileSync(`${root}/${path}`, "utf8");

test("App trust center renders only the public server snapshot and fails visibly", () => {
  const api = read(appRoot, "src/api/trust-section-api.ts");
  const runtime = read(appRoot, "src/api/runtime.ts");
  const page = read(appRoot, "src/pages/trust/trust.vue");

  assert.match(api, /path:\s*"\/api\/content\/trust\/sections\/current"[\s\S]*authenticated:\s*false/);
  assert.match(api, /path:\s*`\/api\/content\/trust\/sections\/\$\{encodeURIComponent\(validSectionKey\(sectionKey\)\)\}\/view`/);
  assert.match(api, /TRUST_SECTION_DUPLICATE/);
  assert.match(api, /TRUST_SECTION_FIELD_DUPLICATE/);
  assert.match(runtime, /export const trustSectionApi = createTrustSectionApi\(apiClient\)/);
  assert.match(page, /await trustSectionApi\.current\(\)/);
  assert.doesNotMatch(page, /SECTION_META|FIELD_LABELS/);
  assert.match(api, /description:\s*text\(row\.description\)/);
  assert.match(api, /structure:\s*text\(row\.structure\)/);
  assert.match(page, /\{\s*\.\.\.field,\s*href:\s*safeHref\(field\)\s*\}/);
  assert.match(page, /trustSectionApi\.recordView\(section\.sectionKey,\s*language\.value\)/);
  assert.match(page, /void Promise\.allSettled/);
  assert.match(page, /trust\\\/nex\|market\\\/market/);
  assert.match(page, /!parsed\.username\s*&&\s*!parsed\.password/);
  assert.match(page, /plusRuntime\.openURL\(href\)/);
  assert.match(page, /pageCopy\.value\.openFailed/);
  assert.match(page, /v-else-if="error"/);
  assert.match(page, /页面不会用本地旧内容冒充最新事实/);
  assert.doesNotMatch(page, /\$4\.87M|Marina K\.|Bybit|CertiK/);
});

test("PC I4 commands bind the visible section snapshot and draft revision", () => {
  const page = read(pcRoot, "app/components/domain-views/i-tabs/i4-trust.tsx");
  const registry = read(pcRoot, "lib/admin/high-ops-registry.ts");
  const client = read(pcRoot, "lib/admin/i-client.ts");

  assert.match(page, /expectedSectionVersion:\s*sectionSnapshot\.v/);
  assert.match(page, /expectedSectionStatus:\s*sectionSnapshot\.status/);
  assert.match(page, /deleteI4TrustSectionDraft\([\s\S]*draft\.revision/);
  assert.match(page, /action:\s*"publish"[\s\S]*expectedVersion:\s*s\.v[\s\S]*expectedStatus:\s*s\.status/);
  assert.match(page, /action:\s*"rollback"[\s\S]*expectedVersion:\s*s\.v[\s\S]*expectedStatus:\s*s\.status/);
  assert.match(page, /action:\s*"archive"[\s\S]*expectedVersion:\s*s\.v[\s\S]*expectedStatus:\s*s\.status/);
  assert.match(page, /section\.status\.toLowerCase\(\)\s*===\s*"archived"/);
  assert.match(page, /isArchived\s*\?\s*"恢复上线"\s*:\s*"回滚历史版"/);
  assert.match(page, /createA2CommandKey\("i4-trust-section"\)/);
  assert.match(page, /commandAttempts\.resolve\(slot, fingerprint, \(\) => createA2CommandKey\("i4-trust-section"\)\)/);
  assert.match(page, /await propose\(toast,\s*\{\s*\.\.\.spec,\s*commandKey\s*\}\)/);
  assert.match(page, /error instanceof A2OutcomeUncertainError/);
  assert.match(page, /return proposeTrustSection\(`\$\{s\.key\}:publish`/);
  assert.match(page, /return proposeTrustSection\(`\$\{s\.key\}:rollback`/);
  assert.match(page, /return proposeTrustSection\(`\$\{s\.key\}:archive`/);
  assert.match(registry, /expectedVersion:\s*ctx\.expectedVersion/);
  assert.match(registry, /expectedStatus:\s*ctx\.expectedStatus/);
  assert.match(client, /deleteI4TrustSectionDraft:[\s\S]*withReason\(\{\s*expectedRevision\s*\},\s*reason\)/);
});

test("backend I4 mutations are row-locked, CAS-safe, durable-idempotent and restorable", () => {
  const service = read(
    backendRoot,
    "src/main/java/ffdd/opsconsole/content/application/OpsTrustDisclosureService.java",
  );
  const repository = read(
    backendRoot,
    "src/main/java/ffdd/opsconsole/content/domain/TrustDisclosureRepository.java",
  );
  const mybatis = read(
    backendRoot,
    "src/main/java/ffdd/opsconsole/content/infrastructure/MybatisTrustDisclosureRepository.java",
  );

  for (const scope of [
    "I4_TRUST_SECTION_PUBLISH",
    "I4_TRUST_SECTION_ROLLBACK",
    "I4_TRUST_SECTION_DRAFT_CREATE",
    "I4_TRUST_SECTION_DRAFT_UPDATE",
    "I4_TRUST_SECTION_DRAFT_DELETE",
    "I4_TRUST_SECTION_ARCHIVE",
  ]) assert.match(service, new RegExp(`"${scope}"`));
  assert.match(service, /TRUST_SECTION_SNAPSHOT_REQUIRED/);
  assert.match(service, /TRUST_SECTION_SNAPSHOT_CONFLICT/);
  assert.match(service, /TRUST_SECTION_REVISION_REQUIRED/);
  assert.match(service, /TRUST_SECTION_REVISION_CONFLICT/);
  assert.match(service, /withTrustSectionOperator\(request,\s*actor\)/);
  assert.match(service, /"operator",\s*actor/);
  assert.match(service, /restoresArchivedVersion/);
  assert.match(repository, /lockTrustSection\(String sectionKey\)/);
  assert.match(repository, /lockTrustSectionVersion\(String sectionKey,\s*String version\)/);
  assert.match(mybatis, /void lockTrustSection\(String sectionKey\)[\s\S]*FOR UPDATE/);
  assert.match(mybatis, /void lockTrustSectionVersion\(String sectionKey,\s*String version\)[\s\S]*FOR UPDATE/);
  assert.match(service, /str\(p,\s*"expectedVersion"\)/);
  assert.match(service, /str\(p,\s*"expectedStatus"\)/);
});
