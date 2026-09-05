import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/components/domain-views/f-view.tsx", import.meta.url), "utf8");

test("F1-F5 ignore stale refreshes and invalidate requests on tab change or unmount", () => {
  for (const name of ["f1Generation", "f1PromotionGeneration", "f1PayoutGeneration", "f2Generation", "f3Generation", "f4Generation", "f5Generation"]) {
    assert.match(source, new RegExp(`const ${name} = useRef\\(0\\)`));
    assert.match(source, new RegExp(`${name}\\.current`));
  }
  assert.ok((source.match(/request !== f\dGeneration\.current/g) ?? []).length >= 8);
  assert.match(source, /request !== f1PromotionGeneration\.current/);
  assert.match(source, /request !== f1PayoutGeneration\.current/);
  assert.match(source, /useEffect\(\(\) => \(\) => \{/);
});

test("F1 promotion and payout queries use independent loading, error and generation state", () => {
  assert.doesNotMatch(source, /f1Flow(?:Generation|Loading|Error)/);
  assert.match(source, /const \[f1PromotionLoading, setF1PromotionLoading\]/);
  assert.match(source, /const \[f1PayoutLoading, setF1PayoutLoading\]/);
  assert.match(source, /const \[f1PromotionError, setF1PromotionError\]/);
  assert.match(source, /const \[f1PayoutError, setF1PayoutError\]/);
});
