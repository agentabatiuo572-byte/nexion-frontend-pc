import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("published how content has one structured PC editor and CAS API", () => {
const client = read("lib/admin/published-content-client.ts");
const contentBff = read("app/api/admin/content/[...path]/route.ts");
  const editor = read("app/components/domain-views/published-how-content-editor.tsx");
  assert.match(client, /\/api\/admin\/content\/how-it-works/);
  assert.match(contentBff, /"how-it-works"/);
  assert.match(client, /expectedRevision/);
  for (const key of ["genesis-how", "wallet-exchange-how", "wallet-repurchase-how", "team-binary-how", "team-commissions-how", "team-unilevel-how"]) {
    assert.match(editor, new RegExp(key));
  }
  assert.match(editor, /ruleRef/);
  assert.match(editor, /canonical/);
});
