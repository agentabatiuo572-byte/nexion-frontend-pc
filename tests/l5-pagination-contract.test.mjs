import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { clampL5Page, l5PageCount } from "../app/components/domain-views/l-tabs/l5-pagination.ts";

test("L5 page clamps when a filtered total shrinks", () => {
  assert.equal(l5PageCount(9, 8), 2);
  assert.equal(clampL5Page(2, 3, 8), 1);
  assert.equal(clampL5Page(0, 0, 8), 1);
});

test("L5 task list clears the stale page and rereads the clamped page", async () => {
  const source = await readFile(new URL("../app/components/domain-views/l-tabs/l5-export.tsx", import.meta.url), "utf8");
  assert.match(source, /const clampedPage = clampL5Page\(taskPageNum, page\.total, page\.pageSize\)/);
  assert.match(source, /setTaskPage\(null\);[\s\S]{0,100}setTaskPageNum\(clampedPage\);[\s\S]{0,100}return;/);
  assert.match(source, /fetchL5ExportTasks\(filterStatus, taskPageNum, 8\)/);
});
