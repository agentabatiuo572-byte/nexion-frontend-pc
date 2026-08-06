import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("L3 loads its server-controlled BI snapshot and never depends on generic treasury routes", async () => {
  const client = await readFile(new URL("../lib/admin/l-client.ts", import.meta.url), "utf8");
  const l3Start = client.indexOf("async function fetchL3FinanceOverview");
  const l3End = client.indexOf("\nexport ", l3Start);
  const l3 = client.slice(l3Start, l3End > l3Start ? l3End : undefined);

  assert.match(l3, /apiRequest<unknown>\("\/finance\/treasury-snapshot"\)/);
  assert.doesNotMatch(l3, /treasuryRequest|\/treasury\/|\/liabilities|\/maturity-forecast|"\/coverage"/);
  assert.match(l3, /assertL3FinanceContract/);
});
