import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`./e2e/${name}`, import.meta.url), "utf8");

test("A003 binds the active lifecycle carrier to the locked Final7 manifest and its normal-MFA actors", () => {
  const source = read("a003-account-lifecycle-runtime.spec.ts");
  assert.match(source, /final7-fixture-refresh\/final7-a-fixture-manifest\.json/);
  assert.doesNotMatch(source, /a-auto-002\/manifest\.json/);
  assert.match(source, /value\.actors\.maker/);
  assert.match(source, /value\.actors\.checker/);
  assert.match(source, /value\.actors\.cleanup/);
  assert.match(source, /A003 base URL must use loopback 3002/);
  assert.match(source, /A003_MFA_SECRET_REQUIRED/);
  assert.match(source, /getByLabel\("一次性验证码"\)/);
});

for (const name of ["a5-live-reacceptance.spec.ts", "a6-a8-live-reacceptance.spec.ts"]) {
  test(`${name} uses the restricted locked maker and visible normal-MFA verification`, () => {
    const source = read(name);
    assert.match(source, /final7-fixture-refresh\/final7-a-fixture-manifest\.json/);
    assert.match(source, /loadLockedMaker/);
    assert.match(source, /totpSecret/);
    assert.match(source, /getByLabel\("一次性验证码"\)/);
    assert.match(source, /\/api\/admin\/auth\/mfa\/verify/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_ADMIN_AUTH_BYPASS/);
    assert.doesNotMatch(source, /Admin@123456/);
  });
}
