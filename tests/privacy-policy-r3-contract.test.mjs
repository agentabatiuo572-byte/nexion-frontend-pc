import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("privacy policy administration keeps a separately permissioned CAS write path", () => {
  const client = read("lib/admin/published-content-client.ts");
  const proxy = read("app/api/admin/content/[...path]/route.ts");
  const editor = read("app/components/domain-views/published-content-editor.tsx");
  const trust = read("app/components/domain-views/i-tabs/i4-trust.tsx");

  assert.match(client, /fetchPrivacyPolicyAdmin\(\).*privacy-policy/);
  assert.match(client, /updatePrivacyPolicyAdmin[\s\S]*expectedRevision[\s\S]*reason/);
  assert.match(proxy, /"privacy-policy"/);
  assert.match(proxy, /export async function PUT/);
  assert.match(editor, /content_legal_terms_read/);
  assert.match(editor, /content_legal_terms_write/);
  assert.match(editor, /content_legal_terms_publish/);
  assert.match(editor, /UNPUBLISHED（撤下公开版本）/);
  assert.match(editor, /草稿保留当前公开版本/);
  assert.match(trust, /<PublishedContentEditor kind="privacyPolicy"/);
});
