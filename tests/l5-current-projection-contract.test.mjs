import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expected = ["KPI_SERIES", "FUNNEL_COHORT", "FINANCE_AGG", "OPERATIONS_AGG", "NETWORK_TREE", "REGULATORY"];

test("L5 frontend current projection has exactly the six supported report types", async () => {
  const [contract, client] = await Promise.all([
    readFile(new URL("../lib/admin/l5-overview-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/admin/l-client.ts", import.meta.url), "utf8"),
  ]);
  for (const type of expected) assert.match(contract, new RegExp(`"${type}"`));
  assert.doesNotMatch(contract, /"BILL_CSV"|"ON_DEMAND"/);
  assert.match(client, /CURRENT_L5_REPORT_TYPES\.includes/);
});

test("L5 backend summary, totals and page queries all exclude retired types", async () => {
  const mapper = await readFile(new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/bi/mapper/BiReportMapper.java", import.meta.url), "utf8");
  assert.doesNotMatch(mapper, /BILL_CSV|ON_DEMAND/);
  for (const name of ["countTotalReports", "countSensitiveReports", "countPendingConfirm", "countReadyReports", "countReadyReportsWithoutSnapshot", "countReports", "reports"]) {
    assert.match(mapper, new RegExp(`REGULATORY[\\s\\S]{0,2000}${name}`));
  }
});
