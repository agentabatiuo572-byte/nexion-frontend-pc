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
const bankEvidenceCode = uiParsed.statements.filter(node =>
  (ts.isFunctionDeclaration(node) && node.name?.text === "vietQrActionEvidenceRef")
  || (ts.isVariableStatement(node) && node.declarationList.declarations.some(
    declaration => declaration.name.getText(uiParsed) === "VIETQR_ACTION_EVIDENCE_FIELD")))
  .map(node => node.getText(uiParsed)).join("\n");
const bankRowCode = ts.transpileModule(`${bankEvidenceCode}\nvar renderBankRow = ${bankRowCallback.getText(uiParsed)};`, {
  fileName: "d1-row.tsx",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, jsxFactory: "jsx" },
}).outputText;

function renderedBankButtons(item, canBankReconcile = true) {
  const events = [];
  const calls = [];
  const scope = {
    canBankReconcile, busy: false, operator: "finance-fixture",
    applyBankWrite: async task => task(),
    reconcileD1VietQr: async (...args) => { calls.push(args); return { code: 0 }; },
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
  return { buttons, events, calls };
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

// Invoke the real click and command callbacks with an isolated transport fixture.
const actionCases = [
  { viewType: "ORPHAN", label: "手动匹配入账", action: "match-credit" },
  { viewType: "MATCHED", label: "确认入账", action: "match-credit" },
  { viewType: "MISMATCH", mismatchReason: "AMOUNT", label: "按实收核销", action: "write-off" },
  ...["ORPHAN", "MISMATCH", "LATE"].map(viewType => ({ viewType, label: "登记退回", action: "return" })),
];
const fixtureAssetId = "vqr_123e4567e89b12d3a456426614174000";
function openedBankAction(changes) {
  const item = row({ id: 10, paymentRail: "VIETQR", reconciliationNo: "MANUAL-1",
    status: "OPEN", creditedUsdt: 0, ...changes });
  const rendered = renderedBankButtons(item);
  const button = rendered.buttons.find(candidate => candidate.label === changes.label);
  assert.ok(button, `expected the actual ${changes.label} button`);
  button.click();
  return { ...rendered, item, confirmation: rendered.events[0].confirmation };
}

test("every real bank reconciliation dialog obtains fresh purpose-scoped image evidence", async () => {
  for (const changes of actionCases) {
    const { confirmation, calls, item } = openedBankAction(changes);
    const field = confirmation.businessForm.fields.find(candidate => candidate.key === "evidenceAssetId");
    assert.ok(field);
    assert.equal(field.inputKind, "asset-upload");
    assert.equal(field.uploadPurpose, "vietqr-receipt");
    assert.equal(field.accept, "image/jpeg,image/png");
    assert.equal(field.required, true);
    assert.match(field.label, /回单图片/);
    assert.match(field.help, /本次操作.*上传.*校验完成/);
    assert.equal(confirmation.businessForm.fields.some(candidate => candidate.key === "evidenceRef"), false);
    await confirmation.run("核对银行到账与付款单后处置", undefined,
      { intentNo: " VQR-1 ", evidenceAssetId: ` ${fixtureAssetId} ` });
    assert.equal(calls.length, 1);
    const [id, action, input] = calls[0];
    assert.equal(id, item.id);
    assert.equal(action, changes.action);
    assert.equal(input.evidenceRef, `media:${fixtureAssetId}`);
    assert.equal(input.expectedVersion, item.version);
    assert.equal(input.operator, "finance-fixture");
    assert.equal(input.reason, "核对银行到账与付款单后处置");
    assert.equal(input.userId, undefined);
    if (changes.viewType === "ORPHAN" && changes.action === "match-credit") assert.equal(input.intentNo, "VQR-1");
    if (changes.viewType === "MATCHED") assert.equal(input.intentNo, item.intentNo);
  }
});

test("real reconciliation callbacks reject missing images and the old hand-entered reference before transport", async () => {
  for (const changes of actionCases) {
    for (const values of [{}, { evidenceRef: "121212" }, { evidenceRef: `media:${fixtureAssetId}` },
      { evidenceAssetId: "121212" }, { evidenceAssetId: `media:${fixtureAssetId}` },
      { evidenceAssetId: "admin_generic_image" }]) {
      const { confirmation, calls } = openedBankAction(changes);
      await assert.rejects(async () => confirmation.run("核对银行到账与付款单后处置", undefined,
        { intentNo: "VQR-1", ...values }), /请先上传本次操作的回单图片/);
      assert.equal(calls.length, 0);
    }
  }
  const { confirmation, calls } = openedBankAction(actionCases[0]);
  await assert.rejects(async () => confirmation.run("核对银行到账与付款单后处置", undefined,
    { evidenceAssetId: fixtureAssetId }), /真实付款意向单号/);
  assert.equal(calls.length, 0);
});

// Exercise the existing shared file-input handler and real confirmation predicates.
// Upload calls are contained fixtures; no file, API, receipt, ledger or wallet is written.
const kit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const kitParsed = ts.createSourceFile("design-kit.tsx", kit, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let uploadSelection, uploadBlockedExpression, canConfirmExpression;
function findUploadContract(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(kitParsed) === "onChange"
      && node.initializer?.getText(kitParsed).includes("uploadD1VietQrReceiptEvidence(file)")) {
    uploadSelection = node.initializer.expression;
  }
  if (ts.isVariableDeclaration(node)) {
    if (node.name.getText(kitParsed) === "uploadBlocked") uploadBlockedExpression = node.initializer.getText(kitParsed);
    if (node.name.getText(kitParsed) === "canConfirm") canConfirmExpression = node.initializer.getText(kitParsed);
  }
  ts.forEachChild(node, findUploadContract);
}
findUploadContract(kitParsed);
assert.ok(uploadSelection && uploadBlockedExpression && canConfirmExpression);
const missingFields = kitParsed.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === "missingBusinessFields");
assert.ok(missingFields);
const sharedUploadCode = ts.transpileModule(`
${missingFields.getText(kitParsed)}
var handleUploadSelection = ${uploadSelection.getText(kitParsed)};
var confirmationReady = (spec, values, uploadStates) => {
  const reasonPolicyReady = true, covBlocked = false, businessSelectionLoading = false;
  const submitting = false, reasonOk = true, editValueOk = true;
  const businessMissing = missingBusinessFields(spec, values);
  const uploadBlocked = ${uploadBlockedExpression};
  return ${canConfirmExpression};
};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function sharedUploadFixture(confirmation) {
  const values = { intentNo: "VQR-1" }, states = {}, names = {}, errors = {}, uploading = {}, pending = [];
  const field = confirmation.businessForm.fields.find(candidate => candidate.key === "evidenceAssetId");
  const update = target => updater => Object.assign(target, updater(target));
  const scope = {
    f: field, set: (key, value) => { values[key] = value; },
    setAssetNames: update(names), setAssetErrors: update(errors), setAssetUploading: update(uploading),
    onUploadStateChange: (key, value) => { states[key] = value; },
    uploadD1VietQrReceiptEvidence: file => new Promise((resolve, reject) => pending.push({ file, resolve, reject })),
    uploadAdminMedia: () => { throw new Error("VietQR must not use the generic upload route"); },
  };
  vm.runInNewContext(sharedUploadCode, scope);
  return { values, states, names, errors, uploading, pending,
    select: file => scope.handleUploadSelection({ target: { files: file ? [file] : [] } }),
    ready: () => scope.confirmationReady(confirmation.businessForm, values, states) };
}
const flushUpload = () => new Promise(resolve => setImmediate(resolve));

test("real upload callback enables a bank action only after the finance upload resolves", async () => {
  for (const changes of actionCases) {
    const { confirmation, calls } = openedBankAction(changes);
    const upload = sharedUploadFixture(confirmation);
    assert.equal(upload.ready(), false);
    const file = { name: "isolated-bank-receipt.png" };
    upload.select(file);
    assert.equal(upload.pending[0].file, file);
    assert.equal(upload.states.evidenceAssetId, "uploading");
    assert.equal(upload.values.evidenceAssetId, "");
    assert.equal(upload.ready(), false);
    assert.equal(calls.length, 0);
    upload.pending[0].resolve({ assetId: fixtureAssetId });
    await flushUpload();
    assert.equal(upload.values.evidenceAssetId, fixtureAssetId);
    assert.equal(upload.uploading.evidenceAssetId, false);
    assert.equal(upload.ready(), true);
    await confirmation.run("核对银行到账与付款单后处置", undefined, upload.values);
    assert.equal(calls[0][2].evidenceRef, `media:${fixtureAssetId}`);
  }
});

test("real upload failure blocks confirmation and a successful retry restores it", async () => {
  const { confirmation, calls } = openedBankAction(actionCases[0]);
  const upload = sharedUploadFixture(confirmation);
  upload.select({ name: "bad.png" });
  upload.pending[0].reject(new Error("VIETQR_RECEIPT_IMAGE_TYPE_MISMATCH"));
  await flushUpload();
  assert.equal(upload.values.evidenceAssetId, "");
  assert.equal(upload.states.evidenceAssetId, "failed");
  assert.equal(upload.ready(), false);
  assert.ok(upload.errors.evidenceAssetId);
  assert.equal(calls.length, 0);
  upload.select(undefined);
  assert.equal(upload.ready(), false); // required action images cannot use registration's no-image path
  upload.select({ name: "correct-bank-receipt.png" });
  assert.equal(upload.ready(), false);
  upload.pending[1].resolve({ assetId: fixtureAssetId });
  await flushUpload();
  assert.equal(upload.errors.evidenceAssetId, "");
  assert.equal(upload.ready(), true);
});
