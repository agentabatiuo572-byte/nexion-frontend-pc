import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("M5 fails closed when template data or lead-level write authority is unavailable", () => {
  const client = read("lib/admin/m-client.ts");
  const page = read("app/components/domain-views/m-tabs/m5-scripts.tsx");

  assert.match(client, /sessionTemplatesAvailable: boolean/);
  assert.match(client, /"I\.session\.templatesAvailable": data\.sessionTemplatesAvailable \? "1" : "0"/);
  assert.match(page, /service_m5_write/);
  assert.match(page, /canWriteM5/);
  assert.match(page, /isSupportSupervisor/);
  assert.match(page, /话术与模板后端当前不可用/);
  assert.match(page, /当前账号只有查看权限/);
});

test("M5 waits for backend truth before success feedback or closing dialogs", () => {
  const page = read("app/components/domain-views/m-tabs/m5-scripts.tsx");

  assert.match(page, /const commitM5Write = async/);
  assert.match(page, /const succeeded = await setParam/);
  assert.match(page, /if \(succeeded\) toast/);
  assert.match(page, /return succeeded/);
  assert.match(page, /disabled=\{writePending\}/);
  assert.doesNotMatch(page, /setParam\([^;]+;\s*\n\s*toast\(/s);
});

test("M5 exposes only backend-provided audience choices and blocks an empty selector", () => {
  const page = read("app/components/domain-views/m-tabs/m5-scripts.tsx");
  const service = read("../nexion-backend/src/main/java/ffdd/opsconsole/content/application/OpsSessionTemplateService.java");

  assert.match(page, /audienceOptions\.length > 0/);
  assert.match(page, /暂无可用受众/);
  assert.match(page, /disabled=\{!canWriteM5 \|\| !sessionTemplatesAvailable \|\| writePending \|\| audienceOptions\.length === 0\}/);
  assert.match(service, /DEFAULT_AUDIENCE_OPTIONS/);
  assert.match(service, /case "audience"/);
});

test("M5 uses the PRD 8-200 reason boundary and keeps archived as a terminal state", () => {
  const page = read("app/components/domain-views/m-tabs/m5-scripts.tsx");
  const client = read("lib/admin/m-client.ts");
  const data = read("app/components/domain-views/m-tabs/data.ts");

  assert.match(page, /reasonMin: 8/);
  assert.match(page, /reasonMax: 200/);
  assert.match(page, /reason\.trim\(\)\.length >= 8/);
  assert.match(data, /"published" \| "draft" \| "archived"/);
  assert.match(client, /value === "archived" \? "archived"/);
  assert.match(page, /已归档/);
});

test("M5 sends expected old values for stale-page conflict detection", () => {
  const client = read("lib/admin/m-client.ts");
  const view = read("app/components/domain-views/m-view.tsx");

  assert.match(client, /expectedEnabled/);
  assert.match(client, /expectedValue/);
  assert.match(client, /expectedStatus/);
  assert.match(client, /expectedAudience/);
  assert.match(view, /legacyParams\[key\]/);
});

test("M5 preserves one idempotency key across a failed command retry", () => {
  const client = read("lib/admin/m-client.ts");
  const view = read("app/components/domain-views/m-view.tsx");

  // 命令号落共享持久化 store(sessionStorage):刷新后重试仍是同一号,后端才能去重。
  assert.doesNotMatch(view, /pendingIdempotencyKeys/);
  assert.match(view, /mCommands = createPendingMutationStore<MCommandRecord>\(\{/);
  assert.match(view, /records\.find\(\(record\) => record\.paramFingerprint === fingerprint\)\?\.commandKey/);
  assert.match(view, /mCommands\.forget\(commandSlot\(commandFingerprint\)\)/);
  assert.match(view, /pendingMCommandMetadata/);
  assert.match(view, /\{ \.\.\.meta, \.\.\.stableMetadata, idempotencyKey \}/);
  assert.match(client, /headers: idempotencyKey \? \{ "Idempotency-Key": idempotencyKey \}/);
});

test("M5 create retries keep a stable command snapshot and temporary reply-template id", () => {
  const page = read("app/components/domain-views/m-tabs/m5-scripts.tsx");
  const view = read("app/components/domain-views/m-view.tsx");

  assert.match(page, /pendingReplyTemplateDraftIds = useRef\(new Map<string, string>\(\)\)/);
  assert.match(page, /pendingReplyTemplateDraftIds\.current\.get\(commandKey\)/);
  assert.match(page, /commandKey: `m5:create-script:/);
  assert.match(page, /commandKey: `m5:create-reply-template:/);
  assert.doesNotMatch(page, /id: `RT-\$\{Date\.now\(\)\}`/);
  assert.match(view, /const stableValue = attempt\?\.value \?\? value/);
});

test("M5 reveals newly created rows when a paged list grows", () => {
  const page = read("app/components/domain-views/m-tabs/m5-scripts.tsx");

  assert.match(page, /setScriptPage\(totalPages\(scriptTotal \+ 1, SCRIPT_PAGE_SIZE\)\)/);
  assert.match(page, /setReplyTemplatePage\(totalPages\(replyTemplateTotal \+ 1, REPLY_TEMPLATE_PAGE_SIZE\)\)/);
});

test("M5 rejects malformed successful responses instead of enabling writes against fallback data", () => {
  const client = read("lib/admin/m-client.ts");

  assert.match(client, /requireSessionTemplateOverview/);
  assert.match(client, /M5_SESSION_TEMPLATE_PROTOCOL_INVALID/);
  assert.match(client, /new Set\(categories\.map\(\(row\) => row\.type\)\)/);
  assert.match(client, /sessionTemplatesAvailable = sessionTemplates !== null/);
});

test("M5 publication is gated by published I6 locale mirrors and emits A4 governance facts", () => {
  const service = read("../nexion-backend/src/main/java/ffdd/opsconsole/content/application/OpsSessionTemplateService.java");
  const page = read("app/components/domain-views/m-tabs/m5-scripts.tsx");
  const migration = read("../nexion-backend/scripts/migrations/20260727_m5_conversation_governance_closure.sql");

  assert.match(service, /I18nLearningRepository/);
  assert.match(service, /requirePublishedLocalizedCopy/);
  assert.match(service, /SESSION_TEMPLATE_I18N_NOT_PUBLISHED/);
  assert.match(service, /EventOutboxService/);
  assert.match(service, /admin\.conversation_script_published/);
  assert.match(service, /admin\.conversation_template_published/);
  assert.match(page, /conversation\.script\./);
  assert.match(page, /conversation\.template\./);
  assert.match(page, /href="\/content\/i18n"/);
  assert.match(migration, /admin\.conversation_category_toggled/);
  assert.match(migration, /admin\.conversation_autopush_toggled/);
  assert.match(migration, /admin\.conversation_autopush_changed/);
  assert.match(migration, /admin\.conversation_script_published/);
  assert.match(migration, /admin\.conversation_template_published/);
});
