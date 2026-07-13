import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const store = readFileSync(new URL("../lib/store/admin-ui.ts", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../app/components/shell/sidebar.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../app/components/shell/console-shell.tsx", import.meta.url), "utf8");

test("sidebar starts with every domain group collapsed", () => {
  assert.match(store, /expandedGroups:\s*\[\]/);
  assert.match(shell, /const expanded = mounted \? expandedRaw : \[\]/);
  assert.doesNotMatch(store, /expandedGroups:\s*\["B"\]/);
});

test("opening one domain closes every other domain", () => {
  assert.match(store, /expandedGroups:\s*s\.expandedGroups\[0\] === code\s*\? \[\]\s*:\s*\[code\]/);
  assert.doesNotMatch(store, /:\s*\[\.\.\.s\.expandedGroups, code\]/);
  assert.match(sidebar, /const isOpen = !collapsed && expanded\[0\] === d\.code/);
});

test("route selection opens only its owning domain and home closes all groups", () => {
  assert.match(sidebar, /const activeDomainCode = domains\.find/);
  assert.match(sidebar, /setExpanded\(activeDomainCode \? \[activeDomainCode\] : \[\]\)/);
  assert.match(sidebar, /onClick=\{\(\) => setExpanded\(\[\]\)\}/);
});

test("old persisted multi-open state is migrated to the collapsed default", () => {
  assert.match(store, /version:\s*2/);
  assert.match(store, /expandedGroups:\s*\[\]/);
});
