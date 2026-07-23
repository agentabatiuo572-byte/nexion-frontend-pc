import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("A3 only exposes server-declared values and hides writes from read-only rows", () => {
  const page = read("app/components/domain-views/a-tabs/a3-config.tsx");
  assert.doesNotMatch(page, /const FLAG_STATUS_OPTIONS/);
  assert.match(page, /options:\s*f\.allowedValues/);
  assert.match(page, /f\.writable\s*&&/);
  assert.match(page, /reasonMax:\s*200/);
  assert.match(page, /disallowCurrent:\s*true/);
  assert.match(page, /return updateA3FeatureFlag/);
  assert.doesNotMatch(page, /正在读取 \/api\/admin\/platform\/config\/overview/);
});

test("A3 client fails closed and sends the observed value for optimistic concurrency", () => {
  const client = read("lib/admin/a3-client.ts");
  assert.match(client, /allowedValues/);
  assert.match(client, /writable/);
  assert.match(client, /observedAt/);
  assert.match(client, /source/);
  assert.match(client, /stale/);
  assert.match(client, /expectedValue/);
  assert.doesNotMatch(client, /status:\s*asText\(row\.status,\s*"off"\)/);
  assert.doesNotMatch(client, /normalized === "warn" \|\| normalized === "bad" \? normalized : "ok"/);
});

test("shared confirmation rejects selecting the current value", () => {
  const kit = read("app/components/domain-views/design-kit.tsx");
  assert.match(kit, /disallowCurrent\?: boolean/);
  assert.match(kit, /spec\.disallowCurrent/);
});

test("maintenance flag has a real shell consumer refreshed after A3 writes", () => {
  const shell = read("app/components/shell/console-shell.tsx");
  const client = read("lib/admin/a3-client.ts");
  const page = read("app/components/domain-views/a-tabs/a3-config.tsx");
  const proxy = read("app/api/admin/platform/[...path]/route.ts");
  assert.match(shell, /fetchA3RuntimeFlags/);
  assert.match(shell, /a3:runtime-flags-changed/);
  assert.match(shell, /maintenanceBanner/);
  assert.match(client, /\/flags\/runtime/);
  assert.match(proxy, /flags.*runtime/);
  assert.match(page, /a3:runtime-flags-changed/);
});

test("A3 machine errors are translated into actionable Chinese messages", () => {
  const errors = read("lib/admin/error-messages.ts");
  for (const code of [
    "A3_FLAG_UNKNOWN",
    "A3_FLAG_VALUE_INVALID",
    "A3_FLAG_SAME_VALUE",
    "A3_FLAG_STALE",
    "A3_FLAG_ROLE_FORBIDDEN",
    "A3_REASON_LENGTH_INVALID",
    "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
  ]) {
    assert.match(errors, new RegExp(`${code}: \\\"[^\\\"]*[\\u4e00-\\u9fff]`));
  }
});
