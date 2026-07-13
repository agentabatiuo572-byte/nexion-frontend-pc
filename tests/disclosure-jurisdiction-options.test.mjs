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
    /jurisdictionOptions\?:\s*\{\s*value:\s*string;\s*label:\s*string\s*\}\[\]/,
  );
  assert.match(
    designKitSource,
    /select\("jurisdiction",\s*"法域",\s*\(spec\.jurisdictionOptions\s*\?\?\s*\[\]\)\.map\(\(item\)\s*=>\s*item\.value\)/,
  );
  assert.doesNotMatch(
    designKitSource,
    /input\("jurisdiction",\s*"法域"/,
  );
  assert.match(
    disclosureSource,
    /const jurisdictionCatalog:[^=]+\=\s*data\?\.jurisdictionCatalog\s*\?\?\s*\[\]/,
  );
  assert.match(
    disclosureSource,
    /const activeJurisdictionOptions\s*=\s*jurisdictionCatalog[\s\S]*?\.filter\(\(item\)\s*=>\s*item\.status\.toLowerCase\(\)\s*===\s*"active"\)/,
  );
  assert.match(
    disclosureSource,
    /jurisdictionOptions:\s*mode\s*===\s*"edit"\s*\?\s*jurisdictionOptions\.filter/,
  );
});
