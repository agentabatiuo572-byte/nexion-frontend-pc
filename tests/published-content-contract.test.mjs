import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("PC exposes structured managers for developer docs and rank policy", () => {
  const editor = read("app/components/domain-views/published-content-editor.tsx");
  const client = read("lib/admin/published-content-client.ts");
  const developerProxy = read("app/api/admin/developer/[...path]/route.ts");
  const teamsProxy = read("app/api/admin/teams/[...path]/route.ts");
  assert.match(editor, /developerDocs/); assert.match(editor, /rankHow/);
  assert.doesNotMatch(editor, /localesJson|JSON\.parse/);
  assert.match(editor, /DeveloperLocaleEditor/); assert.match(editor, /RankLocaleEditor/);
  assert.match(editor, /变更理由/); assert.match(editor, /变更预览/); assert.match(editor, /保存并回读/);
  assert.match(client, /\/api\/admin\/developer\/docs/); assert.match(client, /\/api\/admin\/teams\/rank-policy/);
  assert.match(client, /expectedRevision/); assert.match(client, /reason/);
  assert.match(developerProxy, /parts\[0\] === "docs"/); assert.match(developerProxy, /export async function PUT/);
  assert.match(teamsProxy, /parts\[0\] === "rank-policy"/);
});
