import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const client = fs.readFileSync("lib/admin/a2-client.ts", "utf8");
const modal = fs.readFileSync("app/components/domain-views/design-kit.tsx", "utf8");
const route = fs.readFileSync("app/api/admin/platform/[...path]/route.ts", "utf8");

test("A2 operation confirmation consumes the authenticated server policy and fails closed", () => {
  assert.match(client, /export async function fetchA2ReasonPolicy/);
  assert.match(client, /sourceKey\s*!==\s*["']admin\.a2\.reason_min_chars["']/);
  assert.match(route, /reason-policy/);
  assert.match(modal, /reason\.normalize\(["']NFC["']\)/);
  assert.match(modal, /\\p\{Cf\}/);
  assert.match(modal, /fetchA2ReasonPolicy/);
  assert.match(modal, /reasonPolicyReady/);
  assert.match(modal, /!reasonPolicyReady/);
});

test("audit rows expose the schema version while retaining a legacy marker", () => {
  assert.match(client, /schemaVersion\?: string/);
  assert.match(client, /schemaVersion:\s*asText\(log\.schemaVersion,\s*["']legacy["']\)/);
});
