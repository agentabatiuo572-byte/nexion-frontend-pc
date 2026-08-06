import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./e2e/e-domain-permission-fixtures-20260728.spec.ts", import.meta.url), "utf8");

test("E permission fixture accepts the current shared account keys and legacy E keys", () => {
  assert.match(source, /\["readonly", "readonly", "e_readonly"\]/);
  assert.match(source, /\["menu-no-write", "nowrite", "e_no_write"\]/);
  assert.match(source, /fixtureAccount\("nomenu", "e_no_menu"\)/);
});

test("E nomenu fixture is unassigned and fails closed at navigation, routes, reads, and writes", () => {
  assert.match(source, /await assertSession\(page, false\)/);
  assert.match(source, /expect\(read\.status, `no-menu \$\{module\.id\} 读取`\)\.toBe\(403\)/);
  assert.match(source, /const reloginRead = await browserApi\(page, "GET", MODULES\[0\]\.readPath\)/);
  assert.match(source, /expect\(reloginRead\.status\)\.toBe\(403\)/);
  assert.match(source, /logoutRelogin: \{ menu: "DENIED", read: 403, write: 403 \}/);
});
