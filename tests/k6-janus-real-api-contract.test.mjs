import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("K6 is registered and rendered as a first-class K domain page", () => {
  const nav = read("lib/nav/console-nav.ts");
  const view = read("app/components/domain-views/k-view.tsx");
  assert.match(nav, /id:\s*"K6"[\s\S]*path:\s*"\/risk\/janus-c2"/);
  assert.match(view, /K6JanusC2/);
  assert.match(view, /tab === "K6"/);
});

test("K6 reads and writes through the authenticated Janus proxy", () => {
  const client = read("lib/admin/k6-client.ts");
  const proxy = read("app/api/admin/janus/[...path]/route.ts");
  assert.match(client, /\/api\/admin\/janus/);
  assert.match(client, /devices/);
  assert.match(client, /strategies/);
  assert.match(client, /audit/);
  assert.match(proxy, /ADMIN_AUTH_REQUIRED/);
  assert.match(proxy, /export|exports/);
  assert.match(proxy, /DELETE/);
});

test("K6 production page has no mock or browser-persistence source of truth", () => {
  const files = [
    "app/components/domain-views/k-tabs/k6-janus-c2.tsx",
    "app/components/domain-views/k-tabs/k6/dashboard.tsx",
    "app/components/domain-views/k-tabs/k6/queue.tsx",
    "app/components/domain-views/k-tabs/k6/strategy-center.tsx",
    "app/components/domain-views/k-tabs/k6/audit-log.tsx",
    "lib/store/admin/janus-c2-store.ts",
  ].map(read).join("\n");
  assert.doesNotMatch(files, /lib\/mock\/admin\/janus-c2/);
  assert.doesNotMatch(files, /localStorage|persist\s*\(/);
  assert.match(files, /hydrate|reload/);
});

test("K6 retries writes with one stable idempotency key and exports both health and funnel", () => {
  const client = read("lib/admin/k6-client.ts");
  const dashboard = read("app/components/domain-views/k-tabs/k6/dashboard.tsx");
  assert.match(client, /headers\.set\("Idempotency-Key", idempotencyKey\(\)\)/);
  assert.match(client, /response = await fetch\(`\$\{BASE\}\$\{path\}`, options\);[\s\S]*catch[\s\S]*response = await fetch\(`\$\{BASE\}\$\{path\}`, options\)/);
  assert.match(client, /"health" \| "audit" \| "funnel"/);
  assert.match(dashboard, /recordK6Export\("funnel"/);
});

test("K6 CSV exports neutralize formulas hidden behind whitespace and control characters", () => {
  const files = [
    "app/components/domain-views/k-tabs/k6/dashboard.tsx",
    "app/components/domain-views/k-tabs/k6/audit-log.tsx",
  ].map(read).join("\n");
  assert.equal((files.match(/\^\[\\s\\u0000-\\u001f\]\*\[=\+\\-@\]/g) ?? []).length, 2);
});
