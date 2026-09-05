import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./e2e/d-final7-owner-readonly.spec.ts", import.meta.url),
  "utf8",
);

test("D Final11 owner carrier uses the controlled D fixture and visible MFA without a bypass", () => {
  assert.match(source, /D_FINAL7_FIXTURE/);
  assert.match(source, /accounts\.readonly/);
  assert.match(source, /totpSecret\?: string/);
  assert.match(source, /getByLabel\("一次性验证码"\)/);
  assert.match(source, /\/api\/admin\/auth\/mfa\/verify/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_ADMIN_AUTH_BYPASS/);
  assert.doesNotMatch(source, /Admin@[0-9]{6,}|A123456789Z/);
});

test("D Final11 owner carrier fails closed when an MFA challenge has no fixture secret", () => {
  assert.match(source, /D_FINAL11_MFA_SECRET_REQUIRED/);
  assert.match(source, /MFA_REQUIRED_WITHOUT_TOTP_SECRET/);
});

test("D Final11 owner carrier obtains a fresh TOTP before its finite MFA listener and confirms shell", () => {
  const freshCode = source.indexOf("const code = await freshTotp(account.username, account.totpSecret)");
  const responseWait = source.indexOf("const verification = page.waitForResponse");
  const click = source.indexOf('await page.getByRole("button", { name: "验证并进入", exact: true }).click()');
  assert.ok(freshCode >= 0, "a local fresh TOTP must be obtained");
  assert.ok(responseWait > freshCode, "the finite listener must start after a potential TOTP-step wait");
  assert.ok(click > responseWait, "MFA submission must be observed");
  assert.match(source, /expect\(response\.status\(\), "MFA verify"\)\.toBe\(200\)/);
  assert.match(source, /authStages/);
  assert.match(source, /stage: "mfa", status: response\.status\(\)/);
  assert.match(source, /D_FINAL11_TOTP_FRESH_TIMEOUT/);
  assert.match(source, /TOTP_FRESH_TIMEOUT_MS/);
  assert.match(source, /MFA_CODE_REPLAYED/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^)]*(?:password|totp|secret|code)/i);
  assert.doesNotMatch(source, /JSON\.stringify\([^;]*(?:password|totp|secret|code)/i);
});

test("D Final11 owner carrier keeps real navigation aborts out of the product-failure signal", () => {
  assert.match(source, /function isExpectedNavigationAbort\(/);
  assert.match(source, /request\.method\(\) !== "GET"/);
  assert.match(source, /_rsc=/);
  assert.match(source, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(source, /successfulReplacement/);
  assert.match(source, /status === 200/);
  const abortHelper = source.slice(
    source.indexOf("function isExpectedNavigationAbort"),
    source.indexOf("async function visibleLogout"),
  );
  assert.doesNotMatch(abortHelper, /logout/);
});

test("D Final11 owner carrier never hides an aborted API read merely because its query includes _rsc", () => {
  assert.match(source, /D carrier records an aborted API read even when its query includes _rsc/);
  assert.match(source, /\/api\/admin\/finance\/fx-quote\?_rsc=probe/);
  assert.match(source, /D_FINAL11_API_ABORT_MUST_REMAIN_VISIBLE/);
});

test("D Final11 owner carrier behavior rejects a historical same-path 200 as an abort replacement", () => {
  assert.match(source, /D carrier keeps a same-path _rsc abort visible when its only 200 is historical/);
  assert.match(source, /D_FINAL11_HISTORICAL_200_MUST_NOT_HIDE_ABORT/);
  assert.match(source, /05-historical-200-abort-probe\.json/);
  assert.match(source, /response\.startedSequence > failure\.failedSequence/);
  assert.match(source, /response\.receivedSequence > failure\.failedSequence/);
  assert.match(source, /response\.receivedAtMs - failure\.failedAtMs <= replacementWindowMs/);
});

test("D Final11 owner carrier behavior rejects a replacement started before the failure event", () => {
  assert.match(source, /D carrier keeps an abort visible when its replacement started before failure/);
  assert.match(source, /D_FINAL11_EARLY_REPLACEMENT_MUST_NOT_HIDE_ABORT/);
  assert.match(source, /07-early-replacement-abort-probe\.json/);
});

test("D Final11 owner carrier waits a bounded interval for the visible MFA challenge", () => {
  const login = source.slice(
    source.indexOf("async function visibleLogin"),
    source.indexOf("async function freshTotp"),
  );
  assert.match(login, /otp\.waitFor\(\{ state: "visible", timeout: MFA_CHALLENGE_TIMEOUT_MS \}\)/);
  assert.doesNotMatch(login, /otp\.isVisible\(\{ timeout: 5_000 \}\)/);
  assert.match(source, /MFA_CHALLENGE_TIMEOUT_MS/);
});

test("D Final11 owner carrier disables credential-bearing Playwright artifacts and fails closed outside .restricted", () => {
  assert.match(source, /test\.use\(\{ trace: "off", video: "off", screenshot: "off" \}\)/);
  assert.match(source, /assertRestrictedRunPath\(evidenceDir, "D evidence"\)/);
  assert.match(source, /assertRestrictedRunPath\(testInfo\.outputDir, "D Playwright output"\)/);
  assert.match(source, /D_FINAL11_RESTRICTED_PATH_REQUIRED/);
  assert.match(source, /assertNoSensitiveJsonOrLogs\(evidenceDir/);
  assert.match(source, /D_FINAL11_SENSITIVE_EVIDENCE/);
});
