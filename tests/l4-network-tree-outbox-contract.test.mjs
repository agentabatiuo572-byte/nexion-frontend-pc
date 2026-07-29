import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("L4 network-tree export publishes the canonical admin.report_exported event", async () => {
  const backend = await readFile(
    "D:/workspace/nexion-backend/src/main/java/ffdd/opsconsole/bi/application/OpsBiService.java",
    "utf8",
  );
  const start = backend.indexOf("private ApiResult<Map<String, Object>> exportNetworkTreeOnce(");
  const end = backend.indexOf("private ApiResult<Map<String, Object>> operationsSection(", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const method = backend.slice(start, end);

  assert.match(method, /reportRepository\.publishReportExported\(created\.reportId\(\), linked\(/);
  for (const field of [
    "reportId",
    "exportType",
    "scope",
    "rowCount",
    "containsPii",
    "maskingPolicy",
    "operator",
    "reason",
    "format",
  ]) {
    assert.match(method, new RegExp(`"${field}"`));
  }
});
