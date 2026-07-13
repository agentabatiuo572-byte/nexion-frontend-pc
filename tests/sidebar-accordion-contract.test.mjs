import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const store = readFileSync(new URL("../lib/store/admin-ui.ts", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../app/components/shell/sidebar.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../app/components/shell/console-shell.tsx", import.meta.url), "utf8");
const e2e = readFileSync(new URL("./e2e/sidebar-accordion.spec.ts", import.meta.url), "utf8");

test("sidebar starts with every domain group collapsed", () => {
  assert.match(store, /DEFAULT_EXPANDED_GROUPS:\s*string\[\]\s*=\s*\[\]/);
  assert.match(shell, /const expanded = mounted \? expandedRaw : DEFAULT_EXPANDED_GROUPS/);
  assert.doesNotMatch(store, /expandedGroups:\s*\["B"\]/);
});

test("opening one domain closes every other domain", () => {
  assert.match(store, /return current\.includes\(code\) \? \[\] : \[code\]/);
  assert.match(store, /expandedGroups:\s*nextExpandedGroups\(s\.expandedGroups, code\)/);
  assert.doesNotMatch(store, /:\s*\[\.\.\.s\.expandedGroups, code\]/);
  assert.match(sidebar, /const isOpen = !collapsed && expanded\[0\] === d\.code/);
});

test("route selection does not override the operator's manual expansion state", () => {
  assert.doesNotMatch(sidebar, /const activeDomainCode = domains\.find/);
  assert.doesNotMatch(sidebar, /setExpanded\(activeDomainCode \? \[activeDomainCode\] : \[\]\)/);
});

test("old v2 persisted expansion state is migrated and expansion is not persisted", () => {
  assert.match(store, /version:\s*3/);
  assert.match(store, /expandedGroups:\s*\[\.\.\.DEFAULT_EXPANDED_GROUPS\]/);
  assert.match(store, /partialize:\s*\(\{ expandedGroups: _expandedGroups, \.\.\.persistedState \}\) => persistedState/);
  assert.match(e2e, /version:\s*2/);
  assert.match(e2e, /expect\(persistedUi\.version\)\.toBe\(3\)/);
});
