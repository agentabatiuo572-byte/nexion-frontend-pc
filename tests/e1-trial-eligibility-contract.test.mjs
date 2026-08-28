import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("E1 owns trialEligible and H2 never offers an unmarked product", () => {
  const types = read("lib/admin/platform-types.ts");
  const client = read("lib/admin/e1-client.ts");
  const editor = read("app/components/domain-views/e-view.tsx");
  const h2 = read("app/components/domain-views/h-tabs/h2-trial.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");
  const errors = read("lib/admin/error-messages.ts");
  const prd = read("docs/PRD/Nexion_运营控制后台PRD_v1.md");

  assert.match(types, /trialEligible\?: boolean/);
  assert.match(client, /trialEligible/);
  assert.match(editor, /允许试用/);
  assert.match(h2, /明确开启“允许试用”/);
  assert.match(h2, /const disabledProductOptions/);
  assert.match(h2, /disabledOptions: isProduct \? disabledProductOptions/);
  assert.match(designKit, /disabledOptions\?: string\[\]/);
  assert.match(errors, /TRIAL_PRODUCT_OUT_OF_STOCK/);
  assert.match(prd, /trialProductId.*仅影响新 trial/);
  assert.doesNotMatch(prd, /trialProductId` 为\*\*只读 schema 治理项/);
});
