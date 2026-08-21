import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nav = readFileSync(new URL("../lib/nav/console-nav.ts", import.meta.url), "utf8");
const domain = readFileSync(new URL("../app/components/domain-views/i-view.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("../app/components/domain-views/i-tabs/i4-trust.tsx", import.meta.url), "utf8");
const designKit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const highOps = readFileSync(new URL("../lib/admin/high-ops-registry.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/i-client.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../lib/admin/registry/i.ts", import.meta.url), "utf8");
const paramsRegistryPage = readFileSync(new URL("../app/_console/platform/params-registry/page.tsx", import.meta.url), "utf8");
const paramsRegistryClient = readFileSync(new URL("../app/_console/platform/params-registry/params-registry-client.tsx", import.meta.url), "utf8");

test("I4 and I5 have independent routes and render modes", () => {
  assert.match(nav, /id:\s*"I4",\s*name:\s*"信任中心",\s*path:\s*"\/content\/trust"/);
  assert.match(nav, /id:\s*"I5",\s*name:\s*"风险披露",\s*path:\s*"\/content\/disclosures"/);
  assert.match(domain, /I5:\s*"I5"/);
  assert.match(domain, /<I4Trust\s+ctx=\{ctx\}\s+view="trust"/);
  assert.match(domain, /<I4Trust\s+ctx=\{ctx\}\s+view="disclosures"/);
  assert.match(view, /view:\s*"trust"\s*\|\s*"disclosures"/);
  assert.match(view, /const pageId = view === "trust" \? "I4" : "I5"/);
});

test("I4 draft authoring saves directly without high-sensitive confirmation", () => {
  const create = view.slice(view.indexOf("const createSectionDraft"), view.indexOf("const editSectionDraft"));
  const edit = view.slice(view.indexOf("const editSectionDraft"), view.indexOf("const deleteSectionDraft"));
  assert.match(create, /setDraftEditor/);
  assert.match(edit, /setDraftEditor/);
  assert.doesNotMatch(create, /openActionConfirm/);
  assert.doesNotMatch(edit, /openActionConfirm/);
  assert.match(view, /data-trust-draft-editor="direct-save"/);
  const save = view.slice(view.indexOf("const saveSectionDraft"), view.indexOf("const deleteSectionDraft"));
  assert.match(save, /runBackend\(task,[\s\S]*?\.then\(\(saved\)/);
  assert.match(save, /if \(saved\) setDraftEditor\(null\)/);
  assert.doesNotMatch(save, /runBackend\(task,[^;]*\);\s*setDraftEditor\(null\)/);
});

test("I4 publish confirmation exposes version diff trilingual check and sensitive data source", () => {
  assert.match(view, /版本差异/);
  assert.match(view, /三语确认/);
  assert.match(view, /中文、越南语、英文/);
  assert.match(view, /财务\/NEX 数据来源/);
  assert.match(view, /dataSource/);
  assert.match(view, /currentFields:/);
  assert.match(view, /targetFields:/);
  assert.match(designKit, /新增字段/);
  assert.match(designKit, /删除字段/);
  assert.match(designKit, /旧值/);
  assert.match(designKit, /新值/);
  assert.match(highOps, /dataSourceStatement:\s*String\(ctx\.dataSourceStatement/);
  assert.match(highOps, /bilingualConfirmed:\s*ctx\.bilingualConfirmed\s*===\s*true/);
  assert.match(client, /dataSourceStatement:\s*string;\s*bilingualConfirmed:\s*true/);
});

test("I5 controls use dedicated permissions", () => {
  assert.match(view, /content_i5_write/);
  assert.match(view, /content_i5_disclosure_publish/);
  assert.match(view, /content_i5_gate_adjust/);
});

test("I4 draft and publishing controls use distinct least-privilege authorities", () => {
  assert.match(view, /content_i4_write/);
  assert.match(view, /content_i4_publish_standard/);
  assert.match(view, /content_i4_trust_section_manage/);
  assert.doesNotMatch(view, /canManageTrust/);
  assert.match(view, /canPublishTrustSection/);
  assert.match(view, /isSensitiveTrustSection\(s\)\s*\?\s*\(/);
});

test("registry and parameter ownership keep I4 trust and I5 disclosure separate", () => {
  assert.match(registry, /path:\s*"\/content\/trust"[\s\S]*?I4/);
  assert.match(registry, /path:\s*"\/content\/disclosures"[\s\S]*?I5/);
  assert.match(paramsRegistryPage, /<PlatformParamsRegistry\s*\/>/);
  assert.match(paramsRegistryClient, /href=\{row\.ownerRoute\}/);
  assert.match(paramsRegistryClient, /\{row\.ownerLabel\}/);
  assert.doesNotMatch(`${paramsRegistryPage}\n${paramsRegistryClient}`, /I4 信任中心与披露/);
});
