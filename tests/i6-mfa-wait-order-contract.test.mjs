import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const specPath = new URL("./e2e/i6-nonowner-h-draft-cas-20260728.spec.ts", import.meta.url);
const source = readFileSync(specPath, "utf8");
const loginStart = source.indexOf("async function login(");
const loginEnd = source.indexOf("async function openI6(", loginStart);
const loginBody = source.slice(loginStart, loginEnd);

test("I6 MFA waits for a fresh TOTP before arming the finite response wait", () => {
  const freshCode = loginBody.indexOf("const totpCode = await freshTotp(account.totpSecret)");
  const responseWait = loginBody.indexOf("const verification = page.waitForResponse");
  const fillCode = loginBody.indexOf("await otp.fill(totpCode)");

  assert.ok(freshCode >= 0, "login must obtain the fresh TOTP into a local variable");
  assert.ok(responseWait > freshCode, "response wait must start after any TOTP-boundary sleep");
  assert.ok(fillCode > responseWait, "OTP fill and click must occur after the response listener is armed");
  assert.doesNotMatch(loginBody, /otp\.fill\(await freshTotp\(/);
});

test("I6 cleanup removes child versions before their message and verifies after quiescence", () => {
  const cleanupStart = source.indexOf("function cleanupMutableFixture(");
  const cleanupEnd = source.indexOf("function mysql(", cleanupStart);
  const cleanupBody = source.slice(cleanupStart, cleanupEnd);
  const deleteVersion = cleanupBody.indexOf("DELETE FROM nx_i18n_message_version");
  const deleteMessage = cleanupBody.indexOf("DELETE FROM nx_i18n_message WHERE");

  assert.ok(deleteVersion >= 0 && deleteMessage >= 0);
  assert.ok(deleteVersion < deleteMessage, "child version rows must be deleted before the message row");
  assert.match(cleanupBody, /DO SLEEP\(2\)/);
});
