import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./e2e/a-final6-fixture-provision.spec.ts", import.meta.url),
  "utf8",
);

test("A Final6 fixture carrier requires injected operator and database credentials", () => {
  assert.match(source, /required\("A_FINAL6_FIXTURE_OPERATOR_PASSWORD"\)/);
  assert.match(source, /required\("A_FINAL6_FIXTURE_DB_PASSWORD"\)/);
  assert.doesNotMatch(source, /Admin@[0-9]{6,}/);
  assert.doesNotMatch(source, /A123456789Z/);
});

test("A Final6 fixture carrier never logs or reports injected credential values", () => {
  assert.doesNotMatch(source, /console\.(?:log|error|warn)\([^)]*(?:password|dbPassword)/i);
  assert.doesNotMatch(source, /JSON\.stringify\([^;]*(?:password|dbPassword)/);
});
