import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const c3 = readFileSync(new URL("./e2e/c3-nonowner-b-funds-lock-20260728.spec.ts", import.meta.url), "utf8");
const cDomain = readFileSync(new URL("./e2e/c-domain-nonowner-b-20260728.spec.ts", import.meta.url), "utf8");

test("C3 accepts the current top-level checker fixture, falls back to the legacy key, and rejects a maker checker", () => {
  assert.match(c3, /fixture\.checker \?\? fixture\.accounts\?\.d_checker/);
  assert.match(c3, /checker fixture is required/);
  assert.match(c3, /checkerAccount\.username\.trim\(\)\.toLowerCase\(\) === USERNAME\.trim\(\)\.toLowerCase\(\)/);
  assert.match(c3, /checker account must differ from the maker account/);
});

test("C4-C6 combined review uses C5's current business-semantic ready marker instead of its page heading", () => {
  assert.match(cDomain, /readyText: "凭证与会话参数"/);
  assert.match(cDomain, /await expectModuleReady\(page, module\)/);
  assert.match(cDomain, /module\.readyText\s*\? page\.getByText\(module\.readyText, \{ exact: true \}\)/);
});

test("C permission review prefers the current C fixture keys and keeps the legacy keys as fallback", () => {
  for (const [canonical, legacy] of [
    ["readonly", "c_readonly"],
    ["nowrite", "c_no_write"],
    ["nomenu", "c_no_menu"],
  ]) {
    assert.match(cDomain, new RegExp(`requiredFixtureAccount\\(fixture\\.accounts, "${canonical}", "${legacy}"\\)`));
  }
  assert.match(cDomain, /function requiredFixtureAccount/);
  assert.match(cDomain, /accounts\[canonical\] \?\? accounts\[legacy\]/);
  assert.match(cDomain, /hasMenu\?: boolean/);
  // A no-menu principal is an explicit deny from the server session, not a
  // presentation-only hidden menu.  It must carry neither C read grants nor
  // C menu metadata, and all five access layers stay denied after refresh and
  // a fresh login.
  assert.match(cDomain, /assertSessionShape\(page, \{ hasCRead: false, hasMenu: false \}\)/);
  assert.match(cDomain, /aside a\[href\^="\/users\/"\]/);
  assert.match(cDomain, /await page\.goto\(MODULES\[0\]\.path, \{ waitUntil: "domcontentloaded" \}\)/);
  assert.match(cDomain, /await expect\(page\)\.not\.toHaveURL\(\/\\\/users\\\/search/);
  assert.match(cDomain, /expect\(read\.status, `no-menu \$\{module\.id\} read`\)\.toBe\(403\)/);
  assert.match(cDomain, /expect\(write\.status\)\.toBe\(403\)/);
  assert.match(cDomain, /readApi: "DENIED"/);
  assert.match(cDomain, /refresh: "DENIED"/);
  assert.match(cDomain, /relogin: "DENIED"/);
});
