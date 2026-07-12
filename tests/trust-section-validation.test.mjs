import test from "node:test";
import assert from "node:assert/strict";
import {
  isOptionalTrustLinkField,
  validateTrustSectionBilingualFields,
} from "../lib/admin/trust-section-validation.ts";

test("trust links may be intentionally empty", () => {
  assert.equal(isOptionalTrustLinkField("leader1Url"), true);
  assert.equal(isOptionalTrustLinkField("document.href"), true);
  assert.equal(isOptionalTrustLinkField("summary.zh"), false);
});

test("publish requires complete Chinese and Vietnamese pairs", () => {
  assert.deepEqual(validateTrustSectionBilingualFields([
    { key: "summary.zh", value: "中文" },
    { key: "summary.vi", value: "Tiếng Việt" },
    { key: "documentUrl", value: "" },
  ]), { valid: true, missing: [] });
  assert.equal(validateTrustSectionBilingualFields([
    { key: "summary.zh", value: "中文" },
  ]).valid, false);
  assert.equal(validateTrustSectionBilingualFields([
    { key: "reserve", value: "128%" },
  ]).valid, false);
});
