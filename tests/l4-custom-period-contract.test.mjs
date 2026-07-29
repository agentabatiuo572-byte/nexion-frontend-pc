import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(
  new URL("../app/components/domain-views/l-view.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../app/components/domain-views/l-tabs/l4-ops.tsx", import.meta.url),
  "utf8",
);

test("L4 incomplete custom-period draft does not erase the last authoritative snapshot", () => {
  assert.match(
    view,
    /tab === "L4"[\s\S]*l4Query\.period === "custom"[\s\S]*\(!l4Query\.from \|\| !l4Query\.to\)[\s\S]*return/,
  );
});

test("L4 validates custom date order before applying the server query", () => {
  assert.match(page, /if \(from > to\)[\s\S]*开始日期不能晚于结束日期[\s\S]*return/);
});
