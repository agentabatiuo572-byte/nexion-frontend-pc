import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the real response normalizer and its pure helpers, without network/auth mocks.
const client = readFileSync(new URL("../lib/admin/d-client.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("d-client.ts", client, ts.ScriptTarget.Latest, true);
const names = new Set(["d1Invalid", "d1Object", "d1String", "d1Number", "d1Array",
  "d1OptionalText", "d1NullableNumber", "normalizeD1VietQrOverview"]);
const code = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
  .map(node => node.getText(parsed)).join("\n");
const context = { formatAdminApiError: (message) => message };
vm.runInNewContext(ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, context);
const normalize = context.normalizeD1VietQrOverview;

function row(overrides = {}) {
  return { id: -1, reconciliationNo: "HDPAY-VQR-1", intentNo: "VQR-1", userId: 7,
    viewType: "MATCHED", status: "CREDITED", payableVnd: 870870, receivedVnd: 870870,
    lockedFxRateVndPerUsdt: 26390, creditedUsdt: 33, version: 1,
    createdAt: "2026-09-15T15:47:50", updatedAt: "2026-09-15T15:50:01", ...overrides };
}

function overview(items) {
  return { view: "matched", config: { id: 1, rotationStrategy: "ROUND_ROBIN", toleranceVnd: 0,
    graceMinutes: 30, perTxLimitUsd: 5000, trc20Confirmations: 1, erc20Confirmations: 1,
    bep20Confirmations: 1, version: 0 }, accounts: [],
    page: { pageNum: 1, pageSize: 20, total: items.length, items },
    pendingUnverifiedDepositUsdt: 0, source: "nx_vietqr_reconciliation", asOf: "2026-09-15T16:00:00" };
}

test("real D1 normalizer accepts credited HDPay read-only rows alongside ordinary receipts", () => {
  const result = normalize(overview([row(), row({ id: 10, reconciliationNo: "MANUAL-1" })]));
  assert.equal(result.page.items.length, 2);
  assert.equal(result.page.items[0].id, -1);
  assert.equal(result.page.items[0].creditedUsdt, 33);
  assert.equal(result.page.items[1].id, 10);
});

test("negative ids cannot masquerade as mutable/manual rows or a different intent", () => {
  for (const changes of [{ status: "OPEN" }, { status: "RETURN_PENDING" }, { viewType: "ORPHAN" },
    { reconciliationNo: "MANUAL-1" }, { intentNo: "VQR-2" }, { intentNo: "" },
    { creditedUsdt: 0 }, { receivedVnd: null }]) {
    assert.throws(() => normalize(overview([row(changes)])), /D1_RESPONSE_INVALID/);
  }
});

test("zero, fractional, unsafe ids and malformed amounts remain fail-closed", () => {
  for (const changes of [{ id: 0 }, { id: -1.5 }, { id: Number.MIN_SAFE_INTEGER - 1 },
    { creditedUsdt: -1 }, { lockedFxRateVndPerUsdt: 0 }, { version: -1 }]) {
    assert.throws(() => normalize(overview([row(changes)])), /D1_RESPONSE_INVALID/);
  }
});
