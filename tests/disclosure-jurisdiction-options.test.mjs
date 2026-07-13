import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const designKitSource = readFileSync(
  new URL("../app/components/domain-views/design-kit.tsx", import.meta.url),
  "utf8",
);
const disclosureSource = readFileSync(
  new URL("../app/components/domain-views/i-tabs/i4-trust.tsx", import.meta.url),
  "utf8",
);

test("disclosure jurisdiction is selected from backend jurisdiction options", () => {
  assert.match(
    designKitSource,
    /\{\s*kind:\s*"version-authoring";[^}]*jurisdictionOptions\?:\s*string\[\]/s,
  );
  assert.match(
    designKitSource,
    /select\("jurisdiction",\s*"法域 jurisdiction",\s*spec\.jurisdictionOptions\s*\?\?\s*\[\]/,
  );
  assert.doesNotMatch(
    designKitSource,
    /input\("jurisdiction",\s*"法域 jurisdiction"/,
  );
  assert.match(
    disclosureSource,
    /jurisdictionOptions:\s*JURISDICTIONS\.map\(\(jurisdiction\)\s*=>\s*jurisdiction\.code\)/,
  );
});
