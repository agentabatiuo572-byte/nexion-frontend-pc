import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./e2e/m-domain-permission-fixtures-20260728.spec.ts", import.meta.url), "utf8");

test("M permission fixture accepts the current shared account keys and legacy M keys", () => {
  for (const [canonical, legacy] of [
    ["readonly", "m_readonly"],
    ["nowrite", "m_no_write"],
    ["nomenu", "m_no_menu"],
  ]) {
    assert.match(source, new RegExp(`${canonical}: requiredFixtureAccount\\(fixture\\.accounts, "${canonical}", "${legacy}"\\)`));
  }
});

test("M nomenu fixture has no M authority or menu and is fail-closed at routes and APIs", () => {
  assert.match(source, /await assertSessionShape\(page, false\)/);
  assert.match(source, /expect\(read\.status, `\$\{module\.id\} read`\)\.toBe\(403\)/);
  assert.match(source, /expect\(\(await browserApi\(page, "GET", MODULES\[0\]\.readPath\)\)\.status\)\.toBe\(403\)/);
});
