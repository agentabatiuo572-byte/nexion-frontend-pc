import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("../app/components/domain-views/i-tabs/i4-trust.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/i-client.ts", import.meta.url), "utf8");
const highOps = readFileSync(new URL("../lib/admin/high-ops-registry.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../lib/admin/registry/i.ts", import.meta.url), "utf8");
const backendService = readFileSync(
  "D:/workspace/nexion-backend/src/main/java/ffdd/opsconsole/content/application/OpsTrustDisclosureService.java",
  "utf8",
);
const backendGateMapper = readFileSync(
  "D:/workspace/nexion-backend/src/main/java/ffdd/opsconsole/content/mapper/DisclosureGateActionMapper.java",
  "utf8",
);
const appApi = readFileSync("D:/workspace/NX1.0/src/api/risk-disclosure-api.ts", "utf8");
const appPage = readFileSync("D:/workspace/NX1.0/src/pages/me/risk-disclosure.vue", "utf8");

test("I5 summary follows the backend jurisdiction catalog instead of a stale fixed count", () => {
  assert.match(registry, /按法域 × 7 章节/);
  assert.doesNotMatch(registry, /4 个法域/);
});

test("I5 jurisdiction mapping uses backend country and disclosure version catalogs", () => {
  assert.match(client, /countryOptions/);
  assert.match(view, /countryOptions/);
  assert.match(view, /publishedVersionsByJurisdiction/);
  assert.match(view, /compareDisclosureVersionsDesc/);
  assert.match(view, /\.sort\(compareDisclosureVersionsDesc\)/);
  assert.match(form, /spec\.countryOptions/);
  assert.match(form, /spec\.publishedVersionsByJurisdiction/);
  assert.match(form, /type="checkbox"/);
  assert.doesNotMatch(form, /name="status"/);
});

test("I5 publish command identifies persisted draft and does not carry mutable bodies", () => {
  const entry = highOps.slice(highOps.indexOf('op: "i5_disclosure_publish"'), highOps.indexOf('op: "i5_gate_adjust"'));
  assert.match(view, /发布只审批服务器已经保存的草稿并形成不可变 7 章快照/);
  assert.match(view, /不会改变 App 当前投放或用户确认状态/);
  assert.match(view, /后续切换法域映射时才触发重新确认/);
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

test("I5 jurisdiction configuration has backend CRUD and lifecycle controls", () => {
  assert.match(view, /data\?\.jurisdictionCatalog \?\? \[\]/);
  assert.doesNotMatch(view, /jurisdictionCatalog[\s\S]{0,120}JURISDICTIONS\.map/);
  assert.match(client, /status:\s*string;[\s\S]*revision:\s*number;[\s\S]*referencedVersionCount:\s*number;[\s\S]*hasActiveMapping:\s*boolean/);
  assert.match(client, /createI5Jurisdiction/);
  assert.match(client, /updateI5Jurisdiction/);
  assert.match(client, /enableI5Jurisdiction/);
  assert.match(client, /disableI5Jurisdiction/);
  assert.match(client, /archiveI5Jurisdiction/);
  assert.match(client, /deleteI5Jurisdiction/);
  assert.match(client, /\/trust-disclosure\/disclosures\/jurisdictions/);
  assert.match(view, />法域配置\(I5\)</);
  assert.match(view, /disabled=\{item\.hasActiveMapping\}/);
  assert.match(view, /请先归档下方当前映射/);
  for (const label of ["新增法域", "编辑", "启用", "停用", "归档", "删除"]) assert.match(view, new RegExp(label));
  assert.match(form, /kind === "disclosure-jurisdiction"/);
});

test("I5 new versions only use active jurisdictions and display a readonly server version", () => {
  assert.match(view, /activeJurisdictionOptions/);
  assert.match(view, /status\.toLowerCase\(\) === "active"/);
  assert.match(view, /jurisdictionOptions:\s*mode === "edit"[\s\S]*activeJurisdictionOptions/);
  assert.match(form, /readOnly/);
  assert.match(form, /后端原子分配/);
  assert.doesNotMatch(form, /select\("version", "披露版本（后端分配）"/);
  const payload = view.slice(view.indexOf("const payload = {", view.indexOf("const draftDisclosure")), view.indexOf("const task =", view.indexOf("const draftDisclosure")));
  assert.doesNotMatch(payload, /\bversion:\s*targetVersion/);
});

test("I5 matrix versions are scoped to the selected jurisdiction and published history", () => {
  assert.match(view, /data\?\.disclosureVersionItems \?\? \[\]/);
  assert.doesNotMatch(view, /fallbackVersionRows/);
  assert.match(view, /publishedVersionsByJurisdiction/);
  assert.match(view, /\["published",\s*"superseded"\]/);
  assert.match(view, /row\.jurisdiction/);
  assert.match(form, /spec\.publishedVersionsByJurisdiction\?\.\[next\]/);
  assert.match(form, /version:\s*nextVersions\.includes/);
  assert.doesNotMatch(view, /versionOptions:\s*disclosureVersions/);
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
  assert.match(view, /const jurisdictionActive = catalogStatus === "active"/);
  assert.match(view, /const jurisdictionArchived = catalogStatus === "archived"/);
  assert.match(view, /须先启用法域/);
});

test("I5 exposes new-version creation only from the disclosure version list", () => {
  const matrixSection = view.slice(
    view.indexOf("{/* I5 披露版本 × 法域矩阵 */}"),
    view.indexOf("{/* I5 披露版本列表 */}"),
  );
  const versionSection = view.slice(
    view.indexOf("{/* I5 披露版本列表 */}"),
    view.indexOf("{/* I5 re-ack 覆盖监控 */}"),
  );

  assert.doesNotMatch(matrixSection, />新建版本</);
  assert.match(versionSection, />新建版本</);
  assert.equal((view.match(/>新建版本</g) ?? []).length, 1);
});

test("I5 matrix and publish review use authoritative catalogs and structured safety checks", () => {
  assert.match(client, /jurisdictionCatalog/);
  assert.match(form, /select\("jurisdictionCode"/);
  assert.match(form, /data-business-form="disclosure-publish-review"/);
  assert.match(form, /七章中越双语核对/);
  assert.match(form, /当前映射统计/);
  assert.match(form, /本次仅审批不可变版本，不改变 App 投放/);
  assert.match(form, /受限动作/);
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

test("I5 matrix mutations require publish-level permission and active mappings can be archived through A2", () => {
  assert.match(view, /canPublishDisclosure && <button className="l-btn sm" onClick=\{\(\) => configMatrix\(\)\}>新增映射/);
  assert.match(view, /canPublishDisclosure && j\.status\.toLowerCase\(\) !== "archived"/);
});

test("I5 matrix mutations and publish concurrency checks go through A2", () => {
  assert.match(highOps, /op: "i5_matrix_configure"/);
  assert.match(highOps, /op: "i5_matrix_archive"/);
  assert.match(highOps, /op: "i5_jurisdiction_status"/);
  assert.match(highOps, /op: "i5_jurisdiction_delete"/);
  assert.match(view, /findHighOp\("i5_matrix_configure"\)/);
  assert.match(view, /findHighOp\("i5_matrix_archive"\)/);
  assert.match(view, /findHighOp\("i5_jurisdiction_status"\)/);
  assert.match(view, /findHighOp\("i5_jurisdiction_delete"\)/);
  assert.match(highOps, /expectedRevision/);
  assert.match(highOps, /contentHash/);
  const matrixOps = highOps.slice(highOps.indexOf('op: "i5_matrix_configure"'), highOps.indexOf('op: "i5_jurisdiction_status"'));
  assert.doesNotMatch(matrixOps, /type: "disclosure_matrix"/);
  assert.match(matrixOps, /type: "disclosure_jurisdiction"/);
});

test("I5 A2 commands await a stable command key and retain it only for an unknown outcome", () => {
  assert.match(view, /const proposeDisclosure = async/);
  assert.match(view, /createA2CommandKey\("i5-disclosure"\)/);
  assert.match(view, /error instanceof A2OutcomeUncertainError/);
  assert.match(view, /return proposeDisclosure\(/);
  assert.doesNotMatch(view, /void propose\(toast,\s*\{[\s\S]{0,240}sourceDomain:\s*"I5"/);
});

test("I5 matrix, archive and gate commands carry visible-snapshot CAS through A2 replay", () => {
  const matrixOps = highOps.slice(highOps.indexOf('op: "i5_matrix_configure"'), highOps.indexOf('op: "i5_jurisdiction_status"'));
  const gateOps = highOps.slice(highOps.indexOf('op: "i5_gate_adjust"'), highOps.indexOf('op: "i7_course_reward_adjust"'));
  assert.match(matrixOps, /jurisdictionCode:\s*String\(ctx\.jurisdictionCode\)/);
  assert.match(matrixOps, /expectedVersion/);
  assert.match(matrixOps, /expectedStatus/);
  assert.match(matrixOps, /expectedCountryCodes/);
  assert.match(gateOps, /expectedScope/);
  assert.match(backendService, /String jurisdiction = str\(p, "jurisdictionCode"\)/);
  assert.match(backendService, /DISCLOSURE_MATRIX_SNAPSHOT_REQUIRED/);
  assert.match(backendService, /DISCLOSURE_MATRIX_SNAPSHOT_CONFLICT/);
  assert.match(backendService, /DISCLOSURE_GATE_SCOPE_SNAPSHOT_REQUIRED/);
  assert.match(backendService, /DISCLOSURE_GATE_SCOPE_SNAPSHOT_CONFLICT/);
  assert.match(backendService, /trustDisclosureRepository\.lockGateActions\(\)/);
  assert.match(backendGateMapper, /FOR UPDATE/);
});

test("I5 App requires exact 01-07 chapters, fail-closed scroll proof and same-version ack recovery", () => {
  assert.match(appApi, /chapters\.length !== 7/);
  assert.match(appApi, /"01,02,03,04,05,06,07"/);
  assert.match(appApi, /languageScope !== "zh\+vi"/);
  assert.match(appApi, /chapter\(entry, languageScope\.includes\("en"\)\)/);
  assert.match(appApi, /recovered\.jurisdiction === disclosure\.jurisdiction/);
  assert.match(appApi, /recovered\.version === disclosure\.version/);
  assert.match(appApi, /recovered\.acknowledged/);
  assert.match(appPage, /onReachBottom\(\(\) =>/);
  assert.match(appPage, /scrolledToBottom\.value = true/);
  assert.doesNotMatch(
    appPage,
    /if \(typeof IntersectionObserver === "undefined"\) \{\s*scrolledToBottom\.value = true/,
  );
  assert.doesNotMatch(appPage, /if \(!el\) \{\s*scrolledToBottom\.value = true/);
  assert.match(backendService, /DISCLOSURE_CHAPTER_NUMBERS_INVALID/);
});
