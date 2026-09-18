import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { normalizeOutboxDiagnostics, outboxDiagnosticsQuery } from "../lib/admin/a4-outbox-diagnostics.ts";

const sample = () => ({ total: 188, unresolved: 6, oldestSeconds: 851807, groupsTruncated: false,
  groups: [{ eventType: "ADMIN_USER_PROFILE_VIEWED", status: "PENDING", count: 6, oldestAt: "2026-09-08T10:00:00", unresolved: 6 },
    { eventType: "ADMIN_USER_LIST_EXPORTED", status: "PENDING", count: 182, oldestAt: "2026-09-08T10:00:00", unresolved: 0 }],
  rows: [{ eventId: "12345678123456781234567812345678", eventType: "ADMIN_USER_PROFILE_VIEWED", status: "PENDING", retryCount: 0,
    createdAt: "2026-09-08T10:00:00", nextRetryAt: null, errorCode: null, auditLinkUnresolved: true, receipts: [] }],
  nextCursor: null, hasMore: false });

test("diagnostics keeps unresolved visible and no-receipt distinct from success", () => {
  const result = normalizeOutboxDiagnostics(sample());
  assert.equal(result.total, 188); assert.equal(result.unresolved, 6);
  assert.deepEqual(result.rows[0].receipts, []);
});
test("missing or malformed response is never rendered as empty success", () => {
  for (const value of [null, {}, { ...sample(), rows: null }, { ...sample(), hasMore: true }]) {
    assert.throws(() => normalizeOutboxDiagnostics(value));
  }
});
test("known-field projection rejects raw error text and drops extra PII", () => {
  const value = sample(); value.rows[0].payload = "SECRET";
  assert.ok(!JSON.stringify(normalizeOutboxDiagnostics(value)).includes("SECRET"));
  value.rows[0].errorCode = "private email alice@example.com";
  assert.throws(() => normalizeOutboxDiagnostics(value));
});
test("query is bounded and uses explicit exact filters and cursor", () => {
  const result = outboxDiagnosticsQuery({ eventType: "ADMIN_USER_PROFILE_VIEWED", status: "FAILED", unresolvedOnly: true }, "42");
  assert.equal(result.get("pageSize"), "25"); assert.equal(result.get("afterId"), "42");
  assert.equal(result.get("unresolvedOnly"), "true");
});
test("global aggregates cannot contradict nonzero total or silently truncate", () => {
  for (const value of [{ ...sample(), groups: [] }, { ...sample(), groups: sample().groups.slice(0, 1) },
    { ...sample(), groupsTruncated: true }, { ...sample(), unresolved: 5 }]) assert.throws(() => normalizeOutboxDiagnostics(value));
  const filteredEmpty = { ...sample(), rows: [] };
  assert.equal(normalizeOutboxDiagnostics(filteredEmpty).total, 188);
});
test("binding waits and long cursors preserve their actual meanings", () => {
  const value = sample(); value.rows[0].receipts = [{ status: "PENDING_BINDING", count: 1 }];
  value.hasMore = true; value.nextCursor = "9007199254740993";
  assert.equal(normalizeOutboxDiagnostics(value).nextCursor, "9007199254740993");
  assert.equal(normalizeOutboxDiagnostics(value).rows[0].receipts[0].status, "PENDING_BINDING");
});
test("actual platform proxy rejects every diagnostic write before auth or upstream access", async () => {
  const source = readFileSync(new URL("../app/api/admin/platform/[...path]/route.ts", import.meta.url),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={}; let reads=0;
  const require=()=>new Proxy({}, {get(){ reads++; throw new Error("unexpected auth/upstream dependency"); }});
  new Function("exports","require",compiled)(exports,require);
  for(const method of ["POST","PUT","PATCH","DELETE"]) {
    const response=await exports[method](new Request("http://localhost/api/admin/platform/events/outbox-diagnostics",{method}),{params:Promise.resolve({path:["events","outbox-diagnostics"]})});
    assert.equal(response.status,405);
  }
  assert.equal(reads,0);
});
