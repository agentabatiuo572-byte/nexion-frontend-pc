import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("A4 schema registration sends the complete structured business object", () => {
  const client = read("lib/admin/a4-client.ts");
  const page = read("app/components/domain-views/a-tabs/a4-events.tsx");

  for (const field of [
    "eventName",
    "ownerDomain",
    "producer",
    "consumer",
    "propertyName",
    "propertyType",
    "isServerAuthoritative",
    "samplingPolicy",
    "expectedVersion",
    "reason",
  ]) {
    assert.match(client, new RegExp(field));
  }
  assert.match(page, /registerA4Schema\(\{/);
  assert.doesNotMatch(client, /registerA4Schema\(value: string/);
  assert.doesNotMatch(client, /operator/);
  assert.match(page, /platform_a4_write/);
  assert.match(page, /stableKey/);
  assert.match(page, /throw error/);
  assert.match(read("app/components/domain-views/design-kit.tsx"), /"consumer"/);
});

test("A4 overview normalization fails closed on malformed or incomplete data", () => {
  const client = read("lib/admin/a4-client.ts");

  assert.match(client, /A4_OVERVIEW_INVALID/);
  assert.match(client, /schemaRegistrations/);
  assert.doesNotMatch(client, /schemaVersion:\s*text\(stats\.schemaVersion,\s*"v3"\)/);
  assert.doesNotMatch(client, /todayEvents:\s*text\(stats\.todayEvents,\s*"0"\)/);
  assert.match(client, /requiredNonEmptyRows/);
  assert.match(client, /stats\.businessCounts/);
});

test("A4 parameter editors block invalid values before opening a write request", () => {
  const page = read("app/components/domain-views/a-tabs/a4-events.tsx");

  assert.match(page, /A4_DAY0_VALUE_INVALID/);
  assert.match(page, /A4_EVENT_RETENTION_INVALID/);
  assert.match(page, /A4_PROTECTED_EVENT_SAMPLING_INVALID/);
  assert.match(page, /disabled=\{!canWrite \|\| !overview \|\| !!loadError/);
});

test("A4 provides an A2-governed manual retention trigger with read-back status", () => {
  const client = read("lib/admin/a4-client.ts");
  const page = read("app/components/domain-views/a-tabs/a4-events.tsx");
  assert.match(client, /\/events\/retention-runs\/latest/);
  assert.match(client, /\/events\/retention-runs/);
  assert.match(page, /runA4RetentionNow\(reason, commandKey\)/);
  assert.match(page, /platform_a2_write/);
  assert.match(page, /最近执行:.*锁/);
});

test("A4 accepts PRD canonical single-token actions and JSON schema properties", () => {
  const page = read("app/components/domain-views/a-tabs/a4-events.tsx");

  assert.match(page, /\(\?:_\[a-z0-9\]\+\)\*\$\/\.test\(value\)/);
  assert.match(page, /"json"/);
});

test("A4 schema owner selector includes only registrable dynamic extension domains", () => {
  const page = read("app/components/domain-views/a-tabs/a4-events.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");

  assert.match(page, /SCHEMA_OWNER_DOMAINS/);
  assert.match(page, /extension\.state === "inprogress" \|\| extension\.state === "registered"/);
  assert.match(page, /\.flatMap\(\(extension\) => extension\.newDomains/);
  assert.match(page, /ownerDomains:\s*SCHEMA_OWNER_DOMAINS/);
  assert.doesNotMatch(page, /ownerDomains:\s*PENDING_DOMAINS/);
  assert.ok(designKit.includes("/^[a-z][a-z0-9_]*\\.[a-z0-9]+(?:_[a-z0-9]+)*$/"));
  assert.ok(!designKit.includes("/^[a-z0-9]+\\.[a-z0-9_]+$/i"));
});
