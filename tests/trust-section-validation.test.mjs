import test from "node:test";
import assert from "node:assert/strict";
import {
  isOptionalTrustLinkField,
  validateTrustSectionTrilingualFields,
} from "../lib/admin/trust-section-validation.ts";

test("trust links may be intentionally empty", () => {
  assert.equal(isOptionalTrustLinkField("leader1Url"), true);
  assert.equal(isOptionalTrustLinkField("document.href"), true);
  assert.equal(isOptionalTrustLinkField("summary.zh"), false);
});

test("publish requires complete Chinese, Vietnamese and English groups", () => {
  assert.deepEqual(validateTrustSectionTrilingualFields([
    { key: "summary.zh", value: "中文" },
    { key: "summary.vi", value: "Tiếng Việt" },
    { key: "summary.en", value: "English" },
    { key: "documentUrl", value: "" },
  ]), { valid: true, missing: [] });
  assert.deepEqual(validateTrustSectionTrilingualFields([
    { key: "summary.zh", value: "中文" },
    { key: "summary.vi", value: "Tiếng Việt" },
  ]), { valid: false, missing: ["summary"] });
  assert.deepEqual(validateTrustSectionTrilingualFields([
    { key: "reserve", value: "128%" },
  ]), { valid: false, missing: ["至少一组 .zh/.vi/.en 字段"] });
});
