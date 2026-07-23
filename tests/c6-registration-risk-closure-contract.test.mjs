import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const c6 = readFileSync(new URL("../app/components/domain-views/c-tabs/c6-regrisk.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/user360-client.ts", import.meta.url), "utf8");

test("C6 rejects malformed success payloads and fails closed with an explicit retry", () => {
  assert.match(client, /function requireC6Overview/);
  assert.match(client, /C6_RESPONSE_INVALID/);
  assert.match(c6, /setOverview\(null\)/);
  assert.match(c6, /重新加载/);
  assert.match(c6, /if \(!overview\)/);
});

test("C6 lock editing uses structured bounded numeric fields", () => {
  assert.match(c6, /kind: "multi-field"/);
  assert.match(c6, /inputKind: "number"/);
  assert.match(c6, /min: toNumber\(param\.min/);
  assert.match(c6, /max: toNumber\(param\.max/);
  assert.match(c6, /secondaryMin/);
  assert.match(c6, /secondaryMax/);
  assert.doesNotMatch(c6, /edit: \{ kind: "text", current: currentValue \}/);
});

test("C6 sends optimistic version and uses backend absolute CAPTCHA deadline", () => {
  assert.match(client, /expectedVersion/);
  assert.match(c6, /overview\.configVersion/);
  assert.match(c6, /formatCaptchaRestoreAt/);
  assert.match(client, /captchaRestoreAt/);
  assert.doesNotMatch(c6, /到点自动开回[^\n]*captchaOff/);
});

test("C6 client generates one stable command key per submitted mutation", () => {
  assert.match(client, /commandKey/);
  assert.match(client, /stableIdempotencyKey/);
  assert.match(client, /c6-registration-risk-param/);
});

test("C6 presents fact sources and audit outcomes in operator language", () => {
  assert.match(c6, /function sourceLabel/);
  assert.match(c6, /\.map\(sourceLabel\)\.join/);
  assert.doesNotMatch(c6, /配置变更产 <b>admin\.auth_config_changed<\/b>/);
});

test("C6 keeps read-only roles out of its mutation flow", () => {
  assert.match(c6, /useAdminAuth/);
  assert.match(c6, /authorities\.includes\("user_c6_write"\)/);
  assert.match(c6, /disabled=\{!canWrite \|\| busy \|\| !key \|\| !!param\.readOnly\}/);
  assert.match(c6, /disabled=\{!canWrite \|\| busy\}/);
  assert.match(c6, /当前账号只有 C6 读取权限/);
});
