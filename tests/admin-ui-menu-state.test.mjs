import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EXPANDED_GROUPS,
  nextExpandedGroups,
} from "../lib/store/admin-ui.ts";

test("sidebar groups are collapsed by default", () => {
  assert.deepEqual(DEFAULT_EXPANDED_GROUPS, []);
});

test("opening one sidebar group closes every other group", () => {
  assert.deepEqual(nextExpandedGroups(["B"], "C"), ["C"]);
  assert.deepEqual(nextExpandedGroups(["A", "B"], "C"), ["C"]);
});

test("clicking the only open sidebar group collapses it", () => {
  assert.deepEqual(nextExpandedGroups(["C"], "C"), []);
});

test("legacy multi-open state cannot survive another selection", () => {
  assert.deepEqual(nextExpandedGroups(["A", "C"], "C"), []);
});
