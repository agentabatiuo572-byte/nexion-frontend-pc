import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./e2e/d-domain-permission-fixtures-20260728.spec.ts", import.meta.url), "utf8");

test("D no-menu fixture follows the final unassigned fail-closed contract", () => {
  assert.match(source, /test\("no-menu：D 菜单和直接路由不可见，D1–D6 读写均拒绝/);
  assert.match(source, /await assertSessionShape\(page, \{ hasDRead: false, hasDMenus: false \}\)/);
  assert.match(source, /expect\(read\.status, `no-menu \$\{module\.id\} 读接口`\)\.toBe\(403\)/);
  assert.doesNotMatch(source, /no-menu \$\{module\.id\} 读取必须包含服务端权威 data/);
  assert.match(source, /expect\(reloginRead\.status\)\.toBe\(403\)/);
  assert.match(source, /logoutRelogin: \{ menu: "DENIED", read: reloginRead\.status, write: reloginWrite\.status \}/);
});
