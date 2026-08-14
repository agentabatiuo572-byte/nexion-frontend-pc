import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("A4 lifecycle mutation never sends a client-selected operator", () => {
  const client = readFileSync(new URL("../lib/admin/a4-client.ts", import.meta.url), "utf8");
  const component = readFileSync(new URL("../app/components/domain-views/a-tabs/a4-events.tsx", import.meta.url), "utf8");
  const lifecycle = client.slice(client.indexOf("export async function transitionA4Lifecycle"));
  assert.doesNotMatch(lifecycle, /operator\s*:/);
  assert.doesNotMatch(lifecycle.split("}\n", 1)[0] ?? lifecycle, /operator\s*:\s*string/);
  assert.doesNotMatch(component, /transitionA4Lifecycle\([^\n]*reason,\s*operator/);
});

test("A4 sampling parameter accepts and submits the backend-supported zero percent", () => {
  const component = readFileSync(new URL("../app/components/domain-views/a-tabs/a4-events.tsx", import.meta.url), "utf8");
  assert.match(component, /percent\s*<\s*0\s*\|\|\s*percent\s*>\s*100/);
  assert.doesNotMatch(component, /percent\s*<\s*1\s*\|\|\s*percent\s*>\s*100/);
  assert.match(component, /updateParam\(["']sampling["'],\s*String\(percent\)/);
  assert.match(component, /浏览\/会话\s*0[–-]100%/);
});
