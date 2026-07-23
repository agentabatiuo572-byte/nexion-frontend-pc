import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("../app/components/domain-views/i-tabs/i4-trust.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/i-client.ts", import.meta.url), "utf8");
const designKit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");

test("I4 trust sections expose real draft CRUD endpoints", () => {
  assert.match(client, /createI4TrustSectionDraft/);
  assert.match(client, /updateI4TrustSectionDraft/);
  assert.match(client, /deleteI4TrustSectionDraft/);
  assert.match(view, />\s*新建草稿\s*</);
  assert.match(view, />\s*编辑草稿\s*</);
  assert.match(view, />\s*删除草稿\s*</);
});

test("I4 rollback can only select backend history versions", () => {
  assert.match(view, /sectionVersionOptions/);
  assert.match(view, /kind:\s*"select"/);
  assert.doesNotMatch(view, /回滚信任版块[\s\S]{0,500}kind:\s*"text"/);
});

test("I4 renders Chinese states and structured fields", () => {
  assert.match(view, /草稿/);
  assert.match(view, /已发布/);
  assert.match(view, /已取代/);
  assert.match(view, /data-trust-draft-editor="direct-save"/);
  assert.match(view, /draftEditor\.fields\.map/);
  assert.match(view, /fields:/);
  assert.doesNotMatch(view, /目标版本.*输入/);
});

test("I4 draft validation allows optional URL fields to stay empty", () => {
  assert.match(view, /isOptionalTrustLinkField/);
  assert.match(view, /!isOptionalTrustLinkField\(field\.key\)\s*&&\s*!field\.value\.trim\(\)/);
});

test("I4 shows authoritative A2 pending state and refreshes content after status changes", () => {
  assert.match(view, /pendingTrustSectionKeys/);
  assert.match(view, /A2待确认/);
  assert.match(view, /actions\.reloadIContent\(\)/);
  assert.match(view, /setInterval/);
  assert.match(view, /const pendingA2Href = pendingTrustSectionList\.length === 1/);
  assert.match(view, /`\/platform\/audit\?domain=I&object=\$\{encodeURIComponent\(pendingTrustSectionList\[0\]\)\}`/);
  assert.match(view, /<Link[^>]+href=\{pendingA2Href\}/);
});

test("I4 publish validates real Chinese and Vietnamese field pairs", () => {
  assert.match(view, /validateTrustSectionBilingualFields/);
  assert.match(view, /中越字段不完整/);
});

test("I4 freezes all draft mutations while the A2 section lock is pending", () => {
  assert.match(view, /disabled=\{isPending\}[\s\S]{0,160}新建草稿/);
  assert.match(view, /disabled=\{isPending\}[\s\S]{0,160}编辑草稿/);
  assert.match(view, /disabled=\{isPending\}[\s\S]{0,160}删除草稿/);
});

test("I4 A2 publish command binds the exact draft revision", () => {
  assert.match(view, /expectedRevision:\s*draft\.revision/);
  assert.match(client, /expectedRevision:\s*number/);
});

test("I4 field key uniqueness follows MySQL case-insensitive collation", () => {
  assert.match(designKit, /map\(\(key\) => key\.toLowerCase\(\)\)/);
  assert.match(designKit, /字段标识不能重复（不区分大小写）/);
});

test("I4 field identifiers are inherited from the published schema and cannot be changed", () => {
  const directFieldKeyBlock = view.match(/<label>字段标识（系统固定）<\/label>([\s\S]*?)(?=<\/div>\s*<div className="field"><label>字段名称<\/label>)/);
  const genericFieldKeyBlock = designKit.match(/<span>字段标识（系统固定）<\/span>([\s\S]*?)(?=\{input\(`field\.\$\{index\}\.label`)/);

  assert.match(view, /字段标识由当前发布版字段模板固定，不可新增、删除或改名/);
  assert.ok(directFieldKeyBlock, "direct I4 draft editor must render the fixed-key block");
  assert.match(directFieldKeyBlock[1], /<div[^>]*data-trust-field-key="fixed"/);
  assert.doesNotMatch(directFieldKeyBlock[1], /<(?:input|textarea|select)\b/);
  assert.doesNotMatch(view, />添加字段</);
  assert.doesNotMatch(view, />移除字段</);
  assert.match(designKit, /字段标识由当前发布版固定/);
  assert.ok(genericFieldKeyBlock, "generic I4 draft editor must render the fixed-key block");
  assert.match(genericFieldKeyBlock[1], /<div[^>]*data-trust-field-key="fixed"/);
  assert.doesNotMatch(genericFieldKeyBlock[1], /<(?:input|textarea|select)\b/);
  assert.doesNotMatch(designKit, />\+ 添加字段</);
  assert.doesNotMatch(designKit, />移除末项</);
  assert.doesNotMatch(view, /\?\?\s*\(SECTION_FIELDS\[section\.key\]/);
  assert.match(view, /草稿字段模板已过期，请删除后基于当前发布版新建/);
});
