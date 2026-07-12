import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("../app/components/domain-views/i-tabs/i4-trust.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/i-client.ts", import.meta.url), "utf8");

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
  assert.match(view, /fieldCount/);
  assert.match(view, /fields:/);
  assert.doesNotMatch(view, /目标版本.*输入/);
});
