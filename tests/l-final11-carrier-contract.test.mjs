import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("L6 cross-domain carrier follows the current App service and lifecycle import", () => {
  const carrier = read("./l6-cross-domain-closure-contract.test.mjs");
  assert.match(carrier, /appText\("src\/services\/behavior-analytics\.ts"\)/);
  assert.match(carrier, /appText\("src\/App\.vue"\)/);
  assert.doesNotMatch(carrier, /src\/api\/behavior-analytics-api\.ts/);
});

test("L fixture setup uses visible MFA for a protected root without a bypass", () => {
  const source = read("./e2e/l-domain-permission-fixture-setup-20260728.spec.ts");
  assert.match(source, /ADMIN_E2E_TOTP_SECRET/);
  assert.match(source, /getByLabel\("一次性验证码"\)/);
  assert.match(source, /\/api\/admin\/auth\/mfa\/verify/);
  assert.match(source, /platform_a1_write/);
  assert.match(source, /platform_a6_role_grants_update/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_ADMIN_AUTH_BYPASS/);
  assert.doesNotMatch(source, /ADMIN_E2E_TOTP_SECRET[^\n]*(?:console\.log|writeFileSync|JSON\.stringify)/);
});

test("L Final11 fixture root waits for the OTP challenge and retries only with a fresh bounded TOTP step", () => {
  const source = read("./e2e/l-domain-permission-fixture-setup-20260728.spec.ts");
  const rootLogin = source.slice(
    source.indexOf("async function loginRootWithMfa"),
    source.indexOf("async function loginWithMfa"),
  );
  assert.match(rootLogin, /otp\.waitFor\(\{ state: "visible", timeout: MFA_CHALLENGE_TIMEOUT_MS \}\)/);
  assert.doesNotMatch(rootLogin, /otp\.isVisible\(\{ timeout: 10_000 \}\)/);
  const freshCode = rootLogin.indexOf("const code = await freshTotp(totpSecret)");
  const responseWait = rootLogin.indexOf("const response = page.waitForResponse");
  assert.ok(freshCode >= 0 && freshCode < responseWait, "a fresh TOTP must finish before the finite listener starts");
  assert.match(rootLogin, /MFA_CODE_REPLAYED|MFA_CHALLENGE_EXPIRED/);
  assert.match(rootLogin, /expect\(result\.status\(\), "root MFA verification"\)\.toBe\(200\)/);
  assert.match(source, /L_FINAL11_TOTP_FRESH_TIMEOUT/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^)]*(?:password|totp|secret|code)/i);
});

test("L Final11 carrier proves the repaired visible MFA step with a restricted no-write fixture actor", () => {
  const source = read("./e2e/l-domain-permission-fixture-setup-20260728.spec.ts");
  assert.match(source, /L Final11 carrier executes visible MFA with the controlled checker fixture without writes/);
  assert.match(source, /L_PERMISSION_CARRIER_EVIDENCE/);
  assert.match(source, /test\.use\(\{ trace: "off", video: "off", screenshot: "off" \}\)/);
  assert.match(source, /assertRestrictedCarrierPath\(testInfo\.outputDir, "L Playwright output"\)/);
  assert.match(source, /carrier-mfa-readonly\.json/);
  const carrier = source.slice(
    source.indexOf("L Final11 carrier executes visible MFA"),
    source.indexOf("test(\"创建、独立批准"),
  );
  assert.doesNotMatch(carrier, /JSON\.stringify\([^;]*(?:password|totpSecret|secret|code)/i);
});
