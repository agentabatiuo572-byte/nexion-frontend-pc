import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("../app/components/domain-views/i-tabs/i4-trust.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/i-client.ts", import.meta.url), "utf8");
const highOps = readFileSync(new URL("../lib/admin/high-ops-registry.ts", import.meta.url), "utf8");

test("I5 jurisdiction mapping uses backend country and disclosure version catalogs", () => {
  assert.match(client, /countryOptions/);
  assert.match(view, /countryOptions/);
  assert.match(view, /versionOptions:\s*disclosureVersions/);
  assert.match(form, /spec\.countryOptions/);
  assert.match(form, /spec\.versionOptions/);
  assert.match(form, /type="checkbox"/);
  assert.doesNotMatch(form, /name="status"/);
});

test("I5 publish command identifies persisted draft and does not carry mutable bodies", () => {
  const entry = highOps.slice(highOps.indexOf('op: "i5_disclosure_publish"'), highOps.indexOf('op: "i5_gate_adjust"'));
  assert.match(view, /发布只读取服务器已经保存的草稿/);
  assert.match(entry, /jurisdiction:\s*String\(ctx\.jurisdiction\)/);
  assert.match(entry, /version:\s*String\(ctx\.version\)/);
  assert.doesNotMatch(entry, /\b(?:zh|vi|en|chapters):/);
});

test("I5 chapter authoring selects one backend version instead of mixing chapter snapshots", () => {
  assert.match(view, /chapter\.version === version/);
  assert.match(view, /chapterPayload\(form\)/);
  assert.doesNotMatch(view, /form\?\.\[`chapter\.\$\{index\}\.zhBody`\] \|\| chapter\.zhBody/);
});

test("I5 operations are permission-gated and visible states are Chinese", () => {
  assert.match(view, /content_i5_write/);
  assert.match(view, /content_i5_disclosure_publish/);
  assert.match(view, /content_i5_gate_adjust/);
  assert.match(view, /已被新版取代/);
  assert.doesNotMatch(view, />\s*superseded\s*</);
});

test("I5 review-pending status is rendered in Chinese", () => {
  assert.match(view, /pending_review:\s*"待发布复核"/);
  assert.match(view, /PENDING_REVIEW:\s*"待发布复核"/);
});

test("I5-only readers are not blocked by unrelated I-domain overview failures", () => {
  assert.match(client, /Promise\.allSettled/);
  assert.match(client, /trustDisclosure:\s*trustDisclosure\.status === "fulfilled"/);
  assert.doesNotMatch(client, /await Promise\.all\(\[\s*apiRequest<CopyAbOverview>/);
});

test("I5 draft authoring uses the server next version and loads the selected snapshot", () => {
  assert.match(client, /nextDisclosureVersion/);
  assert.match(client, /fetchI5DisclosureVersion/);
  assert.match(view, /actions\.fetchI5DisclosureVersion\(jurisdiction, currentVersion\)/);
  assert.match(form, /onBusinessSelectionChange/);
  assert.doesNotMatch(view, /zh:\s*CHAPTER_BODY_ZH/);
  assert.doesNotMatch(view, /versionOptions:\s*disclosureVersions,\s*\n\s*languageScopes/);
});

test("I5 renders real jurisdiction-version rows and complete draft CRUD controls", () => {
  assert.match(client, /disclosureVersionItems/);
  assert.match(client, /createI5DisclosureVersion/);
  assert.match(client, /updateI5DisclosureVersion/);
  assert.match(client, /deleteI5DisclosureVersion/);
  assert.match(view, /I5_VERSION_ROWS\.map/);
  assert.match(view, /新建版本/);
  assert.match(view, /编辑版本/);
  assert.match(view, /删除草稿/);
});

test("I5 matrix and publish review use authoritative catalogs and structured safety checks", () => {
  assert.match(client, /jurisdictionCatalog/);
  assert.match(form, /select\("jurisdictionCode"/);
  assert.match(form, /data-business-form="disclosure-publish-review"/);
  assert.match(form, /七章中越双语核对/);
  assert.match(form, /受影响用户/);
  assert.match(form, /受限动作影响/);
});

test("I5 refreshes independently and shows canonical pending re-ack counts", () => {
  assert.match(view, /if \(view !== "disclosures"\) return;/);
  assert.match(view, /pendingAck/);
  assert.match(view, />待确认</);
});

test("I5 new jurisdictions get an editable seven-chapter scaffold and re-ack cannot be disabled", () => {
  assert.match(view, /Array\.from\(\{ length: 7 \}/);
  assert.match(form, /requiresReack:\s*"true"/);
  assert.match(form, /\["true"\],\s*\{ true: "是（新版本发布后强制重新确认）" \}/);
  assert.doesNotMatch(form, /"是否要求重新确认",\s*\["true",\s*"false"\]/);
  assert.match(view, /languageScope:\s*snapshot\?\.languageScope/);
  assert.match(form, /languageScope:\s*spec\.languageScope\s*\?\?/);
});

test("I5 matrix mutations require publish-level permission and published mappings cannot be archived", () => {
  assert.match(view, /canPublishDisclosure && <button className="l-btn sm" onClick=\{\(\) => configMatrix\(\)\}>新增映射/);
  assert.match(view, /canPublishDisclosure && j\.status\.toLowerCase\(\) === "draft"/);
  assert.doesNotMatch(view, /canDraftDisclosure && j\.status\.toLowerCase\(\) !== "archived" && \(\s*<button[^>]*>归档/);
});

test("I5 matrix mutations and publish concurrency checks go through A2", () => {
  assert.match(highOps, /op: "i5_matrix_configure"/);
  assert.match(highOps, /op: "i5_matrix_archive"/);
  assert.match(view, /findHighOp\("i5_matrix_configure"\)/);
  assert.match(view, /findHighOp\("i5_matrix_archive"\)/);
  assert.match(highOps, /expectedRevision/);
  assert.match(highOps, /contentHash/);
});
