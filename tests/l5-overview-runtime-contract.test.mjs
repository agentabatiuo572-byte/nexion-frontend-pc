import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const read = (relative) => readFile(new URL(relative, root), "utf8");

test("L5 overview rejects malformed success payloads before normalization", async () => {
  const [contract, client] = await Promise.all([
    read("lib/admin/l5-overview-contract.ts"),
    read("lib/admin/l-client.ts"),
  ]);

  assert.match(contract, /data\.module !== "L5"/);
  assert.match(contract, /data\.domain !== "L5"/);
  assert.match(contract, /data\.serverCanonical !== true/);
  assert.match(contract, /CURRENT_L5_REPORT_TYPES/);
  assert.doesNotMatch(contract, /"ON_DEMAND"|"BILL_CSV"/);
  assert.match(contract, /validateSummary\(data\.summary\)/);
  assert.match(contract, /validateReports\(data\.reports\)/);
  assert.match(contract, /validateCapabilities\(data\.capabilities\)/);
  assert.match(contract, /statusEnum\.length !== REPORT_STATUSES\.size/);
  assert.match(contract, /REQUIRED_SOURCES\.some/);
  assert.match(client, /const data = assertL5OverviewContract\(raw\)/);
});

test("L5 failure closes every authority-backed write entry", async () => {
  const view = await read("app/components/domain-views/l-tabs/l5-export.tsx");
  assert.match(
    view,
    /disabled=\{!ctx\.canExport \|\| exportTypes\.length === 0 \|\| ctx\.biLoading \|\| Boolean\(ctx\.biError\) \|\| !ctx\.biData\?\.l5\}/,
  );
  assert.match(view, /if \(!data\) return <LDataState ctx=\{ctx\} label="L5" \/>/);
});

test("backend publishes the same canonical L5 identity, state enum and source contract", async () => {
  const backend = await read("../nexion-backend/src/main/java/ffdd/opsconsole/bi/application/OpsBiService.java");
  assert.match(backend, /response\.put\("module", "L5"\)/);
  assert.match(backend, /response\.put\("domain", "L5"\)/);
  assert.match(backend, /response\.put\("serverCanonical", true\)/);
  assert.match(backend, /response\.put\("statusEnum", List\.of\(/);
  for (const source of [
    "nx_admin_fourth_batch_report",
    "nx_audit_log",
    "nx_wallet_ledger",
    "nx_admin_disclosure_jurisdiction",
    "nx_admin_disclosure_version",
  ]) {
    assert.match(backend, new RegExp(source));
  }
});

test("L4 malformed success is promoted from empty-state to backend failure", async () => {
  const [view, contract, errors] = await Promise.all([
    read("app/components/domain-views/l-view.tsx"),
    read("app/components/domain-views/l-tabs/l4-live-data.ts"),
    read("lib/admin/error-messages.ts"),
  ]);
  assert.match(contract, /export function readL4Operations/);
  assert.match(view, /tab === "L4" && !readL4Operations\(nextData\.l4\)/);
  assert.match(view, /formatAdminApiError\("L4_RESPONSE_INVALID"/);
  assert.match(errors, /L4_RESPONSE_INVALID:/);
});
