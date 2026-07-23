import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parseA2FilterQuery } from "../lib/admin/a2-policy.ts";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("A2 consumes a safe I4 domain/object deep link", () => {
  assert.deepEqual(parseA2FilterQuery("?domain=I&object=leadership"), {
    domain: "I",
    object: "leadership",
  });
  assert.deepEqual(parseA2FilterQuery("?domain=Z&object=%20%20"), {});

  const page = read("app/components/domain-views/a-tabs/a2-audit.tsx");
  assert.match(page, /parseA2FilterQuery\(window\.location\.search\)/);
  assert.match(page, /setAppliedFilter\(routeFilter\)/);
});

test("A2 pending workbench excludes terminal tickets while history stays intact", () => {
  const page = read("app/components/domain-views/a-tabs/a2-audit.tsx");
  const queue = page.slice(page.indexOf("const filteredQ"), page.indexOf("const qTotal"));
  assert.match(queue, /operationQueue\.filter\(\(w\) => w\.status === "pending"\)/);
  assert.match(page, /useDataListPager\(operationHistory/);
});

test("I4 deep-links its single pending section and states which version remains live", () => {
  const view = read("app/components/domain-views/i-tabs/i4-trust.tsx");
  assert.match(view, /domain=I&object=/);
  assert.match(view, /当前版仍生效/);
});

test("non-financial trust publish does not render a misleading data-source field", () => {
  const designKit = read("app/components/domain-views/design-kit.tsx");
  assert.match(designKit, /spec\.requireDataSource\s*&&\s*input\("dataSource"/);
});
