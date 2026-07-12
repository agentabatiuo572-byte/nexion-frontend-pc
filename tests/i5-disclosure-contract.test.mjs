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
  const entry = highOps.slice(highOps.indexOf('op: "i4_disclosure_publish"'), highOps.indexOf('op: "i4_gate_adjust"'));
  assert.match(view, /发布只读取服务器已经保存的草稿/);
  assert.match(entry, /jurisdiction:\s*String\(ctx\.jurisdiction\)/);
  assert.match(entry, /version:\s*String\(ctx\.version\)/);
  assert.doesNotMatch(entry, /\b(?:zh|vi|en|chapters):/);
});

test("I5 chapter authoring selects one backend version instead of mixing chapter snapshots", () => {
  assert.match(view, /chapter\.version === version/);
  assert.match(view, /chapterPayload\(form, jurisdiction, version\)/);
});

test("I5 operations are permission-gated and visible states are Chinese", () => {
  assert.match(view, /content_i4_write/);
  assert.match(view, /content_i4_disclosure_publish/);
  assert.match(view, /content_i4_gate_adjust/);
  assert.match(view, /已被新版取代/);
  assert.doesNotMatch(view, />\s*superseded\s*</);
});
