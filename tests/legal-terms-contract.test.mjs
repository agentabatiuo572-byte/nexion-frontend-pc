import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLegalTermsDateTime } from "../lib/admin/legal-terms-contract.ts";

test("normalizes datetime-local values to the backend LocalDateTime contract", () => {
  assert.equal(normalizeLegalTermsDateTime("2026-08-18T02:23"), "2026-08-18 02:23:00");
  assert.equal(normalizeLegalTermsDateTime("2026-08-18T02:23:35"), "2026-08-18 02:23:35");
  assert.equal(normalizeLegalTermsDateTime("2026-08-18 02:23:35"), "2026-08-18 02:23:35");
});

test("rejects an empty or malformed effective time instead of sending a body the backend cannot bind", () => {
  assert.throws(() => normalizeLegalTermsDateTime(""), /LEGAL_TERMS_EFFECTIVE_AT_INVALID/);
  assert.throws(() => normalizeLegalTermsDateTime("not-a-date"), /LEGAL_TERMS_EFFECTIVE_AT_INVALID/);
});
