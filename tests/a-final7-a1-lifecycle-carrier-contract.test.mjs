import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./e2e/a-final7-a1-lifecycle.spec.ts", import.meta.url), "utf8");

test("Final7 A1 carrier binds only to the Final7 fixture manifest and injects every secret through required environment variables", () => {
  assert.match(source, /required\("A_FINAL7_MANIFEST_PATH"\)/);
  assert.match(source, /required\("A_FINAL7_BASE_URL"\)/);
  for (const name of [
    "A_FINAL7_WRITE_TOKEN",
    "A_FINAL7_MAKER_PASSWORD",
    "A_FINAL7_MAKER_TOTP_SECRET",
    "A_FINAL7_CHECKER_PASSWORD",
    "A_FINAL7_CHECKER_TOTP_SECRET",
    "A_FINAL7_CLEANUP_PASSWORD",
    "A_FINAL7_CLEANUP_TOTP_SECRET",
    "A_FINAL7_DB_PASSWORD",
  ]) assert.match(source, new RegExp(name));
  assert.match(source, /password: required\(actorSecretKeys\[kind\]\.password\)/);
  assert.match(source, /totpSecret: required\(actorSecretKeys\[kind\]\.totpSecret\)/);
  assert.match(source, /final7-a-fixture-manifest\.json/);
  assert.doesNotMatch(source, /final6-a002-manifest\.json/);
  assert.match(source, /const actor = manifest\.actors\[kind\]/);
  assert.match(source, /const maker = credentials\("maker"\)/);
  assert.match(source, /const checker = credentials\("checker"\)/);
  assert.match(source, /const cleanup = credentials\("cleanup"\)/);
  assert.doesNotMatch(source, /Admin@[0-9]{6,}|A123456789Z|NZOOCZ|CHUD7K|OMIVU3/);
});

test("Final7 A1 carrier starts at visible login/A1/A2/A4 and covers CAS, replay, unknown result, A2 evidence, A4 health and exact cleanup", () => {
  assert.match(source, /input\[autocomplete="username"\]/);
  assert.match(source, /platform\\\/rbac/);
  assert.match(source, /platform\\\/audit/);
  assert.match(source, /platform\\\/events/);
  assert.match(source, /事件目录 · 6 个 family × domain 注册表/);
  assert.match(source, /A4 数据校验失败\|A4 接口读取失败/);
  assert.match(source, /Promise\.all\(\[/);
  assert.match(source, /ACCOUNT_VERSION_STALE/);
  assert.match(source, /same-key replay/);
  assert.match(source, /idempotency key payload mismatch/i);
  assert.match(source, /outcome-unknown/);
  assert.match(source, /nx_audit_log/);
  assert.doesNotMatch(source, /nx_event_outbox/);
  assert.match(source, /DELETE FROM nx_admin_role_relation/);
  assert.match(source, /DELETE FROM nx_admin_account_state/);
  assert.match(source, /DELETE FROM nx_admin WHERE/);
  assert.match(source, /residual.*0/i);
});

test("Final7 A1 carrier keeps credential and authorization material out of code and persisted evidence", () => {
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^)]*(?:password|totp|authorization|token)/i);
  assert.doesNotMatch(source, /JSON\.stringify\([^;]*(?:password|totp|authorization|token)/i);
  assert.doesNotMatch(source, /Authorization/);
  assert.doesNotMatch(source, /localStorage\.setItem/);
});
