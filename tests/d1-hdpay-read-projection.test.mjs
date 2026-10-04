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
  return { id: -1, paymentRail: "HDPAY", reconciliationNo: "HDPAY-VQR-1", intentNo: "VQR-1", userId: 7,
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
  const result = normalize(overview([row(), row({ id: 10, paymentRail: "VIETQR", reconciliationNo: "MANUAL-1" })]));
  assert.equal(result.page.items.length, 2);
  assert.equal(result.page.items[0].id, -1);
  assert.equal(result.page.items[0].creditedUsdt, 33);
  assert.equal(result.page.items[1].id, 10);
  assert.equal(result.page.items[1].paymentRail, "VIETQR");
  assert.equal(normalize(overview([row({ id: 101, reconciliationNo: "LEGACY-HDPAY-1" })])).page.items[0].paymentRail, "HDPAY");
});

test("negative ids cannot masquerade as mutable/manual rows or a different intent", () => {
  for (const changes of [{ status: "OPEN" }, { status: "RETURN_PENDING" }, { viewType: "ORPHAN" },
    { reconciliationNo: "MANUAL-1" }, { intentNo: "VQR-2" }, { intentNo: "" },
    { creditedUsdt: 0 }, { receivedVnd: null }, { paymentRail: "VIETQR" }, { paymentRail: "UNKNOWN" }]) {
    assert.throws(() => normalize(overview([row(changes)])), /D1_RESPONSE_INVALID/);
  }
});

test("zero, fractional, unsafe ids and malformed amounts remain fail-closed", () => {
  for (const changes of [{ id: 0 }, { id: -1.5 }, { id: Number.MIN_SAFE_INTEGER - 1 },
    { creditedUsdt: -1 }, { lockedFxRateVndPerUsdt: 0 }, { version: -1 }]) {
    assert.throws(() => normalize(overview([row(changes)])), /D1_RESPONSE_INVALID/);
  }
});

test("positive legacy and negative projected HDPay rows share the credited read-only shape", () => {
  for (const identity of [{ id: 399, reconciliationNo: "LEGACY-HDPAY-1" }, { id: -1 }]) {
    for (const changes of [{ status: "OPEN" }, { status: "RETURN_PENDING" }, { status: "RETURNED" },
      { viewType: "INFLIGHT", status: "OPEN", reconciliationNo: "APP-VQR-1", receivedVnd: null, creditedUsdt: 0 },
      { viewType: "ORPHAN" }, { viewType: "MISMATCH", mismatchReason: "AMOUNT" }, { viewType: "LATE" },
      { intentNo: "" }, { intentNo: "OTHER-1" }, { creditedUsdt: 0 }, { receivedVnd: null }, { receivedVnd: 0 }]) {
      assert.throws(() => normalize(overview([row({ ...identity, ...changes })])), /D1_RESPONSE_INVALID/);
    }
  }
});

const bankCases = [
  { changes: { viewType: "INFLIGHT", receivedVnd: null }, labels: ["登记这笔回单"] },
  { changes: { viewType: "ORPHAN", intentNo: "", userId: null }, labels: ["手动匹配入账", "登记退回"] },
  { changes: { viewType: "MATCHED" }, labels: ["确认入账"] },
  { changes: { viewType: "MISMATCH", mismatchReason: "AMOUNT" }, labels: ["按实收核销", "登记退回"] },
  { changes: { viewType: "MISMATCH", mismatchReason: "BANK_ACCOUNT" }, labels: ["登记退回"] },
  { changes: { viewType: "LATE" }, labels: ["登记退回"] },
];

test("ordinary bank open rows remain valid in every reconciliation view", () => {
  for (const { changes } of bankCases) {
    const item = row({ id: 10, paymentRail: "VIETQR", reconciliationNo: "MANUAL-1",
      status: "OPEN", creditedUsdt: 0, ...changes });
    assert.equal(normalize(overview([item])).page.items[0].viewType, changes.viewType);
  }
});

// Execute the actual TSX row renderer, including its button guards and click callbacks.
// Display helpers are inert here; there is no browser, network or business write.
const ui = readFileSync(new URL("../app/components/domain-views/d-tabs/d1-recon.tsx", import.meta.url), "utf8");
const uiParsed = ts.createSourceFile("d1-recon.tsx", ui, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let bankRowCallback;
function findBankRowCallback(node) {
  if (ts.isCallExpression(node) && node.expression.getText(uiParsed) === "vietQr?.page.items.map"
      && ts.isArrowFunction(node.arguments[0])) bankRowCallback = node.arguments[0];
  ts.forEachChild(node, findBankRowCallback);
}
findBankRowCallback(uiParsed);
assert.ok(bankRowCallback, "the D1 bank row renderer must exist");
const bankRowCode = ts.transpileModule(`var renderBankRow = ${bankRowCallback.getText(uiParsed)};`, {
  fileName: "d1-row.tsx",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, jsxFactory: "jsx" },
}).outputText;

function renderedBankButtons(item, canBankReconcile = true) {
  const events = [];
  const scope = {
    canBankReconcile, busy: false,
    jsx: (type, props, ...children) => ({ type, props, children }),
    d1VietQrUsdtAmount: () => null,
    vnd: String, money: String, timeText: String,
    openReceiptRegistration: source => events.push({ kind: "register", source }),
    openActionConfirm: confirmation => events.push({ kind: "confirm", confirmation }),
  };
  vm.runInNewContext(bankRowCode, scope);
  const buttons = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (node.type === "button") buttons.push({ label: node.children.join(""), click: node.props.onClick });
    node.children?.forEach(visit);
  }
  visit(scope.renderBankRow(item));
  return { buttons, events };
}

test("real D1 row renderer exposes bank actions only for permitted VIETQR open rows", () => {
  for (const { changes, labels } of bankCases) {
    const item = row({ id: 10, paymentRail: "VIETQR", reconciliationNo: "MANUAL-1",
      status: "OPEN", creditedUsdt: 0, ...changes });
    const { buttons, events } = renderedBankButtons(item);
    assert.deepEqual(buttons.map(button => button.label), labels);
    for (const button of buttons) button.click();
    assert.equal(events.length, labels.length);
    if (changes.viewType === "INFLIGHT") assert.equal(events[0].source, item);
    assert.equal(renderedBankButtons(item, false).buttons.length, 0);
    for (const status of ["CREDITED", "RETURN_PENDING", "RETURNED"])
      assert.equal(renderedBankButtons({ ...item, status }).buttons.length, 0);
  }
});

test("real D1 row renderer never exposes manual callbacks for HDPay rows of either ID sign", () => {
  for (const id of [399, -1]) {
    for (const { changes } of bankCases) {
      const { buttons, events } = renderedBankButtons(row({ id, status: "OPEN", ...changes }));
      assert.equal(buttons.length, 0);
      assert.equal(events.length, 0);
    }
    assert.equal(renderedBankButtons(row({ id })).buttons.length, 0);
  }
});
