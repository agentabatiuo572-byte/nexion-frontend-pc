import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { collectCalledSymbols, collectClientWriteSymbols, evaluateManifestClaims, validateRuntimeEvidence } from "../scripts/lib/ops-actions-reverse-coverage.mjs";

const parse = (path, kind = ts.ScriptKind.TS) => ts.createSourceFile(path,
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, kind);
const execute = (code, scope) => vm.runInNewContext(ts.transpileModule(code,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, jsxFactory: "jsx" } }).outputText, scope);
const client = parse("lib/admin/d-client.ts");
const helperNames = new Set(["d1Invalid", "d1Object", "d1String", "d1Number", "d1Array", "d1Boolean",
  "d1OptionalText", "d1NullableNumber", "requireD1BankOrdersPage"]);
const scope = { URL, formatAdminApiError: message => message };
execute(client.statements.filter(node => ts.isFunctionDeclaration(node) && helperNames.has(node.name?.text))
  .map(node => node.getText(client)).join("\n"), scope);
const normalize = scope.requireD1BankOrdersPage;
const states = ["CREATING", "AWAITING_PAYMENT", "UNKNOWN", "FAILED", "PROCESSING", "EXPIRED",
  "CREDITED", "CANCELLED", "RETURNED", "RECEIPT_REVIEW", "MISMATCH_REVIEW", "LATE_REVIEW", "RETURN_PENDING"];
function order(changes = {}) {
  return { intentNo: "VQR-TEST20", paymentRail: "HDPAY", userId: 7, status: "AWAITING_PAYMENT",
    intentStatus: "AWAITING_PAYMENT", submissionStatus: "CREATED", providerStatus: null,
    settlementStatus: "UNSETTLED", requestedUsdt: 20, payableVnd: 527800,
    lockedFxRateVndPerUsdt: 26390, receivedVnd: null, creditedUsdt: 0, bankAccountId: null,
    memoCode: "NX-TEST20", expiresAt: "2026-10-04T16:26:02", receivedAt: null,
    createdAt: "2026-10-04T15:56:01", updatedAt: "2026-10-04T15:56:05", version: 2,
    providerVersion: 2, confirmationSource: "UNCONFIRMED", manualCreditAllowed: true,
    manualCreditBlockReason: null, manualRegistrationAllowed: false, manualConfirmationNo: null,
    settlementTargetType: "WALLET_TOPUP", targetOrderNo: null,
    paymentUrl: "https://payments.example.test/order/TEST20", ...changes };
}
const page = records => ({ records, pageNum: 1, pageSize: 20, total: records.length,
  source: "nx_vietqr_intent", asOf: "2026-10-04T16:01:00" });

test("real normalizer retains both rails in every order state and preserves provider facts", () => {
  for (const paymentRail of ["MANUAL", "HDPAY"]) {
    const records = states.map((status, index) => order({ intentNo: `VQR-STATE${index}`, paymentRail,
      status, intentStatus: status, paymentUrl: null, providerStatus: status === "CREDITED" ? 3 : null,
      creditedUsdt: status === "CREDITED" ? 20 : 0, manualCreditAllowed: false,
      manualRegistrationAllowed: paymentRail === "MANUAL" && !["CREDITED", "RETURNED"].includes(status) }));
    const result = normalize(page(records));
    assert.equal(result.records.length, states.length);
    assert.deepEqual(Array.from(result.records, row => row.status), states);
    assert.equal(result.records[6].providerStatus, "3");
    assert.equal(result.records[1].receivedVnd, null);
    assert.equal(result.records[1].receivedAt, "");
  }
});

test("real normalizer retains optional safe provider reason without changing order facts", () => {
  const rejected = order({ status: "FAILED", submissionStatus: "REJECTED", paymentUrl: null });
  const baseline = normalize(page([rejected])).records[0];
  assert.equal(baseline.providerReason, "");
  for (const providerReason of [undefined, null, "", "支付商已拒绝创建", "原".repeat(256)]) {
    const actual = normalize(page([{ ...rejected, providerReason }])).records[0];
    assert.equal(actual.providerReason, providerReason ?? "");
    assert.deepEqual({ ...actual, providerReason: "" }, { ...baseline });
  }
  for (const providerReason of [1, true, [], {}, "   "]) {
    assert.throws(() => normalize(page([{ ...rejected, providerReason }])), /D1_RESPONSE_INVALID/);
  }
});

test("real order normalizer preserves backend total/page and rejects duplicate canonical orders", () => {
  const raw = { ...page([order()]), total: 41, pageNum: 3, pageSize: 20 };
  const result = normalize(raw);
  assert.equal(result.total, 41); assert.equal(result.pageNum, 3); assert.equal(result.pageSize, 20);
  assert.throws(() => normalize(page([order(), order()])), /D1_RESPONSE_INVALID/);
  for (const changes of [{ pageNum: 0 }, { pageSize: 0 }, { total: 0 }, { total: 1.5 }]) {
    assert.throws(() => normalize({ ...raw, ...changes }), /D1_RESPONSE_INVALID/);
  }
});

test("normalizer refuses false credit, mixed targets, unsafe channel links and action capability contradictions", () => {
  for (const changes of [{ status: "CREDITED" }, { creditedUsdt: 20 }, { payableVnd: 0 },
    { receivedVnd: -1 }, { lockedFxRateVndPerUsdt: 0 }, { version: -1 }, { providerVersion: null },
    { paymentRail: "CARD" }, { paymentRail: "MANUAL" }, { settlementTargetType: "MALL_ORDER" },
    { manualRegistrationAllowed: true }, { status: "RETURNED" }, { status: "RETURN_PENDING" }, { paymentUrl: "javascript:alert(1)" },
    { paymentUrl: "http://payments.example.test/order" }, { paymentUrl: "https://user:secret@payments.example.test/order" }]) {
    assert.throws(() => normalize(page([order(changes)])), /D1_RESPONSE_INVALID/);
  }
});

const ui = parse("app/components/domain-views/d-tabs/d1-bank-orders.tsx", ts.ScriptKind.TSX);
let orderLoadCallback, orderRetryCallback;
function findOrderCallbacks(node) {
  if (ts.isVariableDeclaration(node)) {
    if (node.name.getText(ui) === "load" && ts.isCallExpression(node.initializer)) orderLoadCallback = node.initializer.arguments[0];
    if (node.name.getText(ui) === "retry") orderRetryCallback = node.initializer;
  }
  ts.forEachChild(node, findOrderCallbacks);
}
findOrderCallbacks(ui); assert.ok(orderLoadCallback && orderRetryCallback);
const rowScope = { jsx: (type, props, ...children) => ({ type, props, children }) };
execute(ui.statements.filter(node => (ts.isFunctionDeclaration(node) &&
    ["orderStatusText", "orderVnd", "orderUsdt", "orderTime", "D1BankOrderRow"].includes(node.name?.text))
  || (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ui) === "ORDER_STATUS")))
  .map(node => node.getText(ui)).join("\n"), rowScope);
function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(textOf).join("");
  return typeof node === "object" ? textOf(node.children) : String(node);
}
function rendered(changes = {}, props = {}) {
  const row = normalize(page([order(changes)])).records[0], nodes = [], events = [];
  const tree = rowScope.D1BankOrderRow({ order: row, blocked: false, canManage: true, busy: false,
    canRegisterReceipt: true, onSettled: () => events.push("settled"),
    onRegister: value => events.push(["register", value]),
    onManualCredit: value => events.push(["credit", value]), ...props });
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    nodes.push(node); node.children?.forEach(visit);
  }
  visit(tree);
  return { nodes, events, row, cells: nodes.filter(node => node.type === "td").map(textOf) };
}

test("actual pending renderer shows due money with no received or credited funds and real channel/action callbacks", () => {
  const { nodes, cells, events, row } = rendered();
  assert.equal(cells[0], "HDPay"); assert.match(cells[2], /20\.00 USDT.*527,800 VND/);
  assert.equal(cells[3], "——"); assert.equal(cells[4], "—尚未入账");
  assert.match(cells[5], /待付款/);
  const link = nodes.find(node => node.type === "a"); assert.equal(link.props.href, row.paymentUrl);
  const button = nodes.find(node => node.type === "button"); assert.equal(textOf(button), "人工确认入账");
  button.props.onClick(); assert.equal(events[0][0], "credit"); assert.equal(events[0][1].intentNo, row.intentNo);
});

test("actual renderer keeps manual source and provider rejection after credit, with no second credit button", () => {
  const { cells, nodes } = rendered({ status: "CREDITED", intentStatus: "CREDITED", creditedUsdt: 20,
    receivedVnd: 527800, receivedAt: "2026-10-04T16:00:00", paymentUrl: null,
    submissionStatus: "REJECTED", providerStatus: null, providerReason: "支付商已拒绝创建", manualCreditAllowed: false,
    confirmationSource: "ADMIN_MANUAL", manualConfirmationNo: "ADM-TEST20" });
  assert.match(cells[4], /20\.00 USDT人工确认入账/); assert.match(cells[6], /REJECTED.*ADMIN_MANUAL.*ADM-TEST20/);
  assert.match(cells[6], /支付商拒绝原因：支付商已拒绝创建/);
  assert.equal(nodes.some(node => node.type === "button"), false);
  assert.match(cells[8], /不可重复确认/);
});

test("actual renderer shows only explicit HDPay rejection reasons and generic missing reason", () => {
  const rejected = { status: "FAILED", submissionStatus: "REJECTED", paymentUrl: null };
  for (const status of ["FAILED", "EXPIRED"]) {
    const { cells } = rendered({ ...rejected, status, providerReason: "支付商已拒绝创建" });
    assert.match(cells[6], /提交 REJECTED.*支付商拒绝原因：支付商已拒绝创建/);
  }
  for (const providerReason of [undefined, null, ""]) {
    assert.match(rendered({ ...rejected, providerReason }).cells[6], /支付商拒绝原因：支付商未提供具体原因/);
  }
  for (const changes of [{ status: "UNKNOWN", submissionStatus: "SUBMIT_UNKNOWN" },
    { status: "CREATING", submissionStatus: "CREATED" }, { status: "PROCESSING", submissionStatus: "CREATED" },
    { status: "FAILED", submissionStatus: "CREATED" },
    { paymentRail: "MANUAL", bankAccountId: 1, manualCreditAllowed: false, submissionStatus: "REJECTED" }]) {
    const { cells } = rendered({ paymentUrl: null, providerReason: "不应展示的原因", ...changes });
    assert.doesNotMatch(cells.join(""), /支付商拒绝原因|不应展示的原因/);
  }
  const text = "<script>literal-only</script>";
  const { cells, nodes } = rendered({ ...rejected, providerReason: text });
  assert.ok(cells[6].includes(text));
  assert.equal(nodes.some(node => node.type === "script" || node.props?.dangerouslySetInnerHTML), false);
});

test("provider rejection reason never changes actual actions, permission or unknown guards", () => {
  const rejected = { status: "FAILED", submissionStatus: "REJECTED", paymentUrl: null };
  const actionFacts = view => view.nodes.filter(node => ["button", "a"].includes(node.type))
    .map(node => [node.type, textOf(node), node.props.disabled, node.props.href]);
  for (const [changes, props] of [[{}, {}], [{ manualCreditAllowed: false }, {}], [{}, { canManage: false }],
    [{}, { busy: true }], [{}, { blocked: true }],
    [{ paymentUrl: "https://payments.example.test/order/TEST20" }, {}]]) {
    const before = rendered({ ...rejected, ...changes }, props);
    const after = rendered({ ...rejected, ...changes, providerReason: "支付商已拒绝创建" }, props);
    assert.deepEqual(actionFacts(after), actionFacts(before));
    for (const view of [before, after]) {
      view.nodes.find(node => node.type === "button" && !node.props.disabled)?.props.onClick();
    }
    assert.deepEqual(after.events.map(event => [event[0], event[1].intentNo]),
      before.events.map(event => [event[0], event[1].intentNo]));
  }
});

test("fresh real order loads reread rejection reason and do not retain a missing or older summary", async () => {
  let providerReason = "首次读取原因";
  const loads = [], reads = [];
  const runtime = { URLSearchParams, adminAuthLifecycleEpoch: () => 1, requireD1BankOrdersPage: normalize,
    requestId: { current: 0 }, rail: "HDPAY", status: "FAILED", query: "VQR-TEST20", pageNum: 1, pageSize: 20,
    setLoading: () => {}, setError: () => {}, setPending: () => {}, listD1PendingBankOrderCommands: () => [],
    setPageNum: () => assert.fail("one-row fixture must remain on page one"), setData: value => { if (value) loads.push(value); },
    apiRequest: async (base, path) => {
      reads.push({ base, path });
      return page([order({ status: "FAILED", submissionStatus: "REJECTED", paymentUrl: null, providerReason })]);
    } };
  const methods = client.statements.filter(node => ts.isFunctionDeclaration(node)
    && ["buildQuery", "assertD1BankManualAuthEpoch", "fetchD1BankOrders"].includes(node.name?.text))
    .map(node => node.getText(client).replace(/^export\s+/, "")).join("\n");
  const initialize = () => execute(`${methods}\nvar load = ${orderLoadCallback.getText(ui)};`, runtime);
  initialize(); await runtime.load();
  initialize(); await runtime.load(); // A fresh client callback reads the same durable server summary.
  providerReason = "最新读取原因"; await runtime.load();
  providerReason = undefined; await runtime.load();
  assert.deepEqual(loads.map(value => value.records[0].providerReason), ["首次读取原因", "首次读取原因", "最新读取原因", ""]);
  for (const read of reads) {
    assert.equal(read.base, "finance"); assert.match(read.path, /^\/vietqr\/orders\?.*keyword=VQR-TEST20/);
  }
  assert.match(rendered(loads[1].records[0]).cells[6], /支付商拒绝原因：首次读取原因/);
  assert.match(rendered(loads[3].records[0]).cells[6], /支付商拒绝原因：支付商未提供具体原因/);
});

test("manual registration, role controls, server block reason and unknown capsule block remain observable", () => {
  const manual = rendered({ paymentRail: "MANUAL", paymentUrl: null, manualCreditAllowed: false,
    manualRegistrationAllowed: true, bankAccountId: 1 });
  const registration = manual.nodes.find(node => node.type === "button");
  assert.equal(textOf(registration), "登记这笔回单"); registration.props.onClick();
  assert.equal(manual.events[0][0], "register");
  assert.equal(rendered({}, { canManage: false }).nodes.some(node => node.type === "button"), false);
  const denied = rendered({ manualCreditAllowed: false, manualCreditBlockReason: "已有冲突款项，需要核对" });
  assert.equal(denied.nodes.find(node => node.type === "button").props.disabled, true);
  assert.match(denied.cells[8], /已有冲突款项/);
  const unknown = rendered({}, { blocked: true });
  assert.equal(unknown.nodes.find(node => node.type === "button").props.disabled, true);
  assert.equal(unknown.nodes.some(node => node.type === "a"), false);
  assert.match(unknown.cells[8], /原请求号/);
  const rejected = rendered({ status: "FAILED", submissionStatus: "REJECTED", paymentUrl: null });
  assert.equal(rejected.nodes.find(node => node.type === "button").props.disabled, false);
  assert.equal(rejected.nodes.some(node => node.type === "a"), false);
  assert.match(rejected.cells[8], /无可用付款链接/);
});

const recon = parse("app/components/domain-views/d-tabs/d1-recon.tsx", ts.ScriptKind.TSX);
let manualCallback, bankWriteCallback, parentRetryCallback;
function findManual(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(recon) === "openBankManualCredit") manualCallback = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(recon) === "applyBankWrite") bankWriteCallback = node.initializer;
  if (ts.isJsxAttribute(node) && node.name.getText(recon) === "onRetry"
      && node.initializer?.getText(recon).includes("retryD1PendingBankOrderCommand")) parentRetryCallback = node.initializer.expression;
  ts.forEachChild(node, findManual);
}
findManual(recon); assert.ok(manualCallback && bankWriteCallback && parentRetryCallback);

test("new D1 bank commands have unique pending leaf claims with real producer, UI and behavior-test evidence", () => {
  const manifest = JSON.parse(readFileSync(new URL("../docs/ops-actions.manifest.json", import.meta.url), "utf8"));
  const commands = new Map([["manualCreditD1BankOrder", "OPS-D-29"], ["retryD1PendingBankOrderCommand", "OPS-D-30"]]);
  const discovered = collectClientWriteSymbols(client.text, "lib/admin/d-client.ts");
  for (const action of commands.keys()) assert.ok(discovered.has(action), `${action} must remain a real client mutation`);
  const writePoints = collectCalledSymbols(recon.text, new Set(commands.keys()), "app/components/domain-views/d-tabs/d1-recon.tsx")
    .map(point => ({ ...point, leaf: "D1", file: "app/components/domain-views/d-tabs/d1-recon.tsx", kind: "client" }));
  assert.equal(writePoints.length, 2, "both actual D1 command callsites must be registered");
  const assertClaims = candidate => {
    const coverage = evaluateManifestClaims({ manifest: candidate, writePoints });
    assert.deepEqual(coverage.problems, [], coverage.problems.join("\n"));
    const rows = [];
    for (const [action, id] of commands) {
      const row = candidate.rows.find(item => item.id === id); assert.ok(row, `${id} missing`);
      assert.equal(row.restAction, action); assert.equal(row.domain, "D"); assert.equal(row.view, "d-tabs/d1-recon.tsx");
      assert.equal(row.status, "pending", `${id} must remain pending until Root verifies actual page and financial closure`);
      assert.ok(candidate.activeLeafCoverage.D1.includes(id), `${id} must retain its D1 leaf claim`);
      const evidence = row.runtimeConsumerEvidence?.[0]; assert.ok(evidence);
      assert.equal(evidence.producer.type, "pc-runtime"); assert.equal(evidence.producer.file, "lib/admin/d-client.ts");
      assert.equal(evidence.consumer.type, "pc-runtime"); assert.equal(evidence.consumer.file, "app/components/domain-views/d-tabs/d1-recon.tsx");
      assert.equal(evidence.behaviorTest.type, "test-runtime"); assert.equal(evidence.behaviorTest.file, "tests/d1-bank-orders.test.mjs");
      assert.ok(evidence.behaviorTest.positivePatterns.includes(row.runtimeConsumerContract.successOutcome));
      assert.ok(evidence.behaviorTest.positivePatterns.includes(row.runtimeConsumerContract.failureOutcome));
      rows.push(row);
    }
    assert.deepEqual(validateRuntimeEvidence({ rows }, (_type, path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")), []);
  };
  assertClaims(manifest);
  for (const id of commands.values()) {
    const missing = structuredClone(manifest); missing.rows = missing.rows.filter(item => item.id !== id);
    assert.throws(() => assertClaims(missing), /exactly one manifest claim/);
    const duplicate = structuredClone(manifest); duplicate.rows.push({ ...duplicate.rows.find(item => item.id === id), id: `${id}-duplicate` });
    assert.throws(() => assertClaims(duplicate), /exactly one manifest claim/);
    const wrongLeaf = structuredClone(manifest); wrongLeaf.activeLeafCoverage.D1 = wrongLeaf.activeLeafCoverage.D1.filter(item => item !== id);
    wrongLeaf.activeLeafCoverage.D2.push(id); assert.throws(() => assertClaims(wrongLeaf), /D1 leaf claim/);
    const falseBuilt = structuredClone(manifest); falseBuilt.rows.find(item => item.id === id).status = "built";
    assert.throws(() => assertClaims(falseBuilt), /must remain pending/);
  }
});

function openedManual(changes = {}, manualTransport, auth = {}) {
  const calls = [], confirmations = [], settled = [], writeScope = { canBankReconcile: true, operator: "finance-fixture",
    adminAuthLifecycleEpoch: auth.adminAuthLifecycleEpoch ?? (() => 1), AdminAuthEpochChangedError: auth.AdminAuthEpochChangedError,
    openActionConfirm: value => confirmations.push(value),
    applyBankWrite: auth.applyBankWrite ?? (async task => task()), manualCreditD1BankOrder: async (...args) => { calls.push(args); return manualTransport?.(...args); },
    vnd: value => `${value} VND` };
  const helpers = recon.statements.filter(node => (ts.isFunctionDeclaration(node) &&
      ["vietnamLocalDateTimeNow", "vietQrReceivedAtInstant", "vietQrActionEvidenceRef"].includes(node.name?.text))
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(recon) === "VIETQR_ACTION_EVIDENCE_FIELD")))
    .map(node => node.getText(recon)).join("\n");
  execute(`${helpers}\nvar openBankManualCredit = ${manualCallback.getText(recon)};`, writeScope);
  writeScope.openBankManualCredit(normalize(page([order(changes)])).records[0], () => { settled.push("order-load"); return auth.load?.(); });
  return { calls, confirmation: confirmations[0], settled };
}

test("actual manual confirmation starts with no receipt time and keeps the shared reason, proof and reference gates", async () => {
  const kit = parse("app/components/domain-views/design-kit.tsx", ts.ScriptKind.TSX);
  const modal = kit.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "OperationConfirmModal");
  assert.ok(modal);
  const declarations = new Map(modal.body.statements.filter(ts.isVariableStatement)
    .flatMap(node => node.declarationList.declarations.map(item => [item.name.getText(kit), item])));
  const gateNames = ["requestedMinimum", "reasonPolicyReady", "reasonMin", "requestedMaximum", "reasonMax",
    "reasonLength", "reasonOk", "businessMissing", "uploadBlocked", "canConfirm"];
  const helpers = kit.statements.filter(node => ts.isFunctionDeclaration(node)
    && ["initBusinessForm", "missingBusinessFields"].includes(node.name?.text));
  assert.equal(helpers.length, 2);
  for (const name of [...gateNames, "handleConfirm"]) assert.ok(declarations.get(name)?.initializer, name);
  const gateCode = gateNames.map(name => `const ${declarations.get(name).getText(kit)};`).join("\n");
  const runModal = async (reason, changes = {}, uploadStates = {}) => {
    const opened = openedManual(), errors = [];
    const actualTime = opened.confirmation.businessForm.fields.find(field => field.key === "receivedAt");
    assert.equal(actualTime.current, "", "opening the manual action must not invent a bank receipt time");
    assert.equal(actualTime.required, true); assert.match(actualTime.help, /真实收款凭证.*不是操作登记时间/);
    const modalScope = { activeBusinessForm: opened.confirmation.businessForm, reason,
      requestedReasonMin: opened.confirmation.reasonMin, requestedReasonMax: opened.confirmation.reasonMax,
      authoritativeReasonMin: 8, authoritativeReasonMax: 200, isJ4Command: false,
      covBlocked: false, businessSelectionLoading: false, submitting: false, editValueOk: true,
      uploadStates, derivedNewVal: undefined, newVal: "", onConfirm: opened.confirmation.run,
      setSubmitting: () => {}, setSubmitError: value => errors.push(value),
      operationConfirmErrorMessage: error => error.message };
    execute(helpers.map(node => node.getText(kit)).join("\n"), modalScope);
    modalScope.businessValue = { ...modalScope.initBusinessForm(opened.confirmation.businessForm),
      paymentReference: "FT-TEST20", evidenceAssetId: "vqr_123e4567e89b12d3a456426614174000", ...changes };
    execute(`${gateCode}\nvar ready = canConfirm; var submit = ${declarations.get("handleConfirm").initializer.getText(kit)};`, modalScope);
    await modalScope.submit();
    return { ...opened, errors, ready: modalScope.ready, values: modalScope.businessValue };
  };
  const validReason = "核实实际到账与凭证", actualReceipt = { receivedAt: "2026-10-04T16:00:00" };
  const untouchedTime = await runModal(validReason);
  assert.equal(untouchedTime.values.receivedAt, ""); assert.equal(untouchedTime.ready, false);
  assert.equal(untouchedTime.calls.length, 0);
  await assert.rejects(() => untouchedTime.confirmation.run(validReason, undefined, untouchedTime.values), /银行到账时间格式无效/);
  assert.equal(untouchedTime.calls.length, 0);
  for (const reason of ["", "短理由", "核\u200b \u200b对"]) {
    const blocked = await runModal(reason, actualReceipt); assert.equal(blocked.ready, false); assert.equal(blocked.calls.length, 0);
  }
  for (const changes of [{ evidenceAssetId: "" }, { paymentReference: "" }, { paymentReference: "短" }]) {
    const blocked = await runModal(validReason, { ...actualReceipt, ...changes });
    assert.equal(blocked.ready, false); assert.equal(blocked.calls.length, 0);
  }
  const uploading = await runModal(validReason, actualReceipt, { evidenceAssetId: "uploading" });
  assert.equal(uploading.ready, false); assert.equal(uploading.calls.length, 0);
  for (const changes of [{ evidenceAssetId: "admin_generic_image" }, { paymentReference: "VQR-TEST20" }, { paymentReference: "NX-TEST20" }]) {
    const blocked = await runModal(validReason, { ...actualReceipt, ...changes });
    assert.equal(blocked.calls.length, 0); assert.match(blocked.errors.at(-1), /请先上传本次操作的回单图片|真实收款凭证上的交易参考号/);
  }
  const accepted = await runModal(validReason, actualReceipt);
  assert.equal(accepted.ready, true); assert.equal(accepted.calls.length, 1);
  assert.equal(accepted.calls[0][1].receivedAt, "2026-10-04T09:00:00.000Z");
  assert.equal(accepted.calls[0][1].reason, validReason);
});

test("actual manual dialog locks amount/user/version, requires scoped proof and sends independent manual command", async () => {
  const { calls, confirmation } = openedManual();
  assert.match(confirmation.detail, /用户 7.*原状态 AWAITING_PAYMENT.*人工已入账/);
  const image = confirmation.businessForm.fields.find(field => field.key === "evidenceAssetId");
  assert.equal(image.required, true); assert.equal(image.uploadPurpose, "vietqr-receipt");
  await confirmation.run("核实实际到账与凭证", undefined, { paymentReference: "FT-TEST20",
    receivedAt: "2026-10-04T16:00:00", evidenceAssetId: "vqr_123e4567e89b12d3a456426614174000", receivedVnd: "1", userId: "99" });
  assert.equal(calls.length, 1); assert.equal(calls[0][0], "VQR-TEST20");
  const input = calls[0][1]; assert.equal(input.receivedVnd, 527800); assert.equal(input.expectedVersion, 2);
  assert.equal(input.providerVersion, 2); assert.equal(input.receivedAt, "2026-10-04T09:00:00.000Z");
  assert.equal(input.evidenceRef, "media:vqr_123e4567e89b12d3a456426614174000");
  assert.equal(input.reason, "核实实际到账与凭证"); assert.equal(input.userId, undefined);
  for (const business of [{}, { paymentReference: "VQR-TEST20" }, { paymentReference: "FT-TEST20", receivedAt: "2026-10-04T16:00:00", evidenceAssetId: "121212" }]) {
    const blocked = openedManual(); await assert.rejects(() => blocked.confirmation.run("核实到账", undefined, business));
    assert.equal(blocked.calls.length, 0);
  }
});

test("real manual transport and capsule retry preserve original body/key and exclude unrelated commands", async () => {
  const body = JSON.stringify({ expectedVersion: 2, providerVersion: 2, receivedVnd: 527800,
    paymentReference: "FT-TEST20", receivedAt: "2026-10-04T09:00:00.000Z",
    evidenceRef: "media:vqr_123e4567e89b12d3a456426614174000", reason: "核实实际到账", operator: "finance-fixture" });
  const capsule = { commandKey: "d1-bank-original-fixture", base: "finance",
    path: "/vietqr/orders/VQR-TEST20/manual-credit", method: "POST", body, createdAt: 1, expiresAt: 2 };
  capsule.fingerprint = `POST|finance|${capsule.path}|${body}`;
  const records = [capsule, { ...capsule, commandKey: "other-base", base: "treasury" },
    { ...capsule, commandKey: "other-path", path: "/topup/overview" },
    { ...capsule, commandKey: "bad-order", path: "/vietqr/orders/../manual-credit" }];
  const calls = [], transport = { pendingMutations: { list: () => records,
      get: fingerprint => records.find(value => value.fingerprint === fingerprint)?.commandKey,
      forget: fingerprint => { const index = records.findIndex(value => value.fingerprint === fingerprint); if (index >= 0) records.splice(index, 1); } },
    URLSearchParams, adminAuthLifecycleEpoch: () => 1, requireD1BankOrdersPage: normalize,
    apiRequest: async (...args) => {
      if (!args[2]?.method) { assert.match(args[1], /keyword=VQR-TEST20/);
        return page([order({ status: "CREDITED", creditedUsdt: 20, manualCreditAllowed: false, paymentUrl: null })]); }
      calls.push(args); return { status: "CREDITED" };
    } };
  execute(client.statements.filter(node => ts.isFunctionDeclaration(node)
    && ["buildQuery", "assertD1BankManualAuthEpoch", "fetchD1BankOrders", "submitD1BankManualCredit", "manualCreditD1BankOrder", "listD1PendingBankOrderCommands", "retryD1PendingBankOrderCommand"].includes(node.name?.text))
    .map(node => node.getText(client).replace(/^export\s+/, "")).join("\n"), transport);
  assert.equal(transport.listD1PendingBankOrderCommands().length, 1);
  await transport.retryD1PendingBankOrderCommand(capsule.commandKey);
  assert.equal(calls[0][1], capsule.path); assert.equal(calls[0][2].body, body);
  assert.equal(calls[0][2].idempotencyKey, capsule.commandKey);
  assert.equal(calls[0][2].idempotencyPrefix, "d1-bank-manual-credit");
  assert.equal(calls[0][2].retainOnSuccess, true);
  for (const key of ["other-base", "other-path", "bad-order", "missing"]) {
    await assert.rejects(() => transport.retryD1PendingBankOrderCommand(key));
  }
  assert.equal(calls.length, 1);
  await transport.manualCreditD1BankOrder("VQR-TEST20", JSON.parse(body));
  assert.equal(calls[1][2].body, body); assert.equal(calls[1][2].method, "POST");
  assert.equal(calls[1][2].idempotencyPrefix, "d1-bank-manual-credit");
});

test("real dialog and transport reject edited unknown commands, recover identical body/key and release the next order after confirmed credit", async () => {
  const memory = new Map(), calls = [];
  let readback = "failure", writeStatus = 503;
  const runtime = { Headers, Response, AbortSignal, URLSearchParams, requestSeq: 0,
    adminAuthLifecycleEpoch: () => 1, requireD1BankOrdersPage: normalize,
    pendingMutations: { get: fingerprint => memory.get(fingerprint)?.commandKey,
      remember: (fingerprint, commandKey, extra) => memory.set(fingerprint, { fingerprint, commandKey, ...extra }),
      forget: fingerprint => memory.delete(fingerprint), list: () => [...memory.values()] },
    guardedFetch: async (url, init) => {
      if (!init.method) {
        if (readback === "failure") throw new Error("fixture readback unavailable");
        const intentNo = new URL(url, "https://admin.example.test").searchParams.get("keyword");
        return new Response(JSON.stringify({ code: 0, data: page([readback === "unconfirmed" ? order({ intentNo })
          : order({ intentNo, status: "CREDITED", creditedUsdt: 20, manualCreditAllowed: false, paymentUrl: null })]) }));
      }
      calls.push({ url, body: init.body, key: init.headers.get("Idempotency-Key") });
      return new Response(JSON.stringify({ code: writeStatus === 200 ? 0 : 503, data: { status: "CREDITED" } }), { status: writeStatus });
    },
    outcomeStaysUnknown: status => status >= 500, isAdminAuthFailure: () => false,
    resetAdminSession: () => {}, formatAdminApiError: message => message || "rejected" };
  execute(client.statements.filter(node => (ts.isFunctionDeclaration(node)
      && ["buildQuery", "nextId", "assertD1BankManualAuthEpoch", "apiRequest", "fetchD1BankOrders", "submitD1BankManualCredit", "manualCreditD1BankOrder", "retryD1PendingBankOrderCommand"].includes(node.name?.text))
    || (ts.isClassDeclaration(node) && node.name?.text === "DOutcomeUnknownError"))
    .map(node => node.getText(client).replace(/^export\s+/, "")).join("\n"), runtime);
  const confirmation = openedManual({}, runtime.manualCreditD1BankOrder).confirmation;
  const reason = "核实实际到账与凭证", business = { paymentReference: "FT-TEST20", receivedAt: "2026-10-04T16:00:00",
    evidenceAssetId: "vqr_123e4567e89b12d3a456426614174000" };
  await assert.rejects(() => confirmation.run(reason, undefined, business), failure => failure.name === "DOutcomeUnknownError");
  assert.equal(memory.size, 1); const first = calls[0];
  const commandKey = [...memory.values()][0].commandKey; assert.equal(commandKey, first.key);
  for (const [editedReason, editedBusiness] of [["修改了理由后再次确认", business],
    [reason, { ...business, receivedAt: "2026-10-04T16:01:00" }],
    [reason, { ...business, paymentReference: "FT-OTHER20" }],
    [reason, { ...business, evidenceAssetId: "vqr_223e4567e89b12d3a456426614174000" }]]) {
    await assert.rejects(() => confirmation.run(editedReason, undefined, editedBusiness), failure => failure.commandKey === commandKey);
    assert.equal(calls.length, 1, "BANK_MANUAL_EDITED_UNKNOWN_BLOCKED");
    assert.equal(memory.size, 1); assert.equal([...memory.values()][0].body, first.body);
    assert.equal([...memory.values()][0].commandKey, commandKey);
  }
  writeStatus = 200;
  await assert.rejects(() => confirmation.run(reason, undefined, business), failure => failure.commandKey === commandKey);
  assert.equal(memory.size, 1); assert.equal(calls[1].key, first.key); assert.equal(calls[1].body, first.body);
  await assert.rejects(() => confirmation.run("受理后回读失败仍然修改理由", undefined, business), failure => failure.commandKey === commandKey);
  assert.equal(calls.length, 2); assert.equal(memory.size, 1); assert.equal([...memory.values()][0].body, first.body);
  readback = "unconfirmed";
  await assert.rejects(() => confirmation.run(reason, undefined, business), failure => failure.commandKey === commandKey);
  assert.equal(memory.size, 1); assert.equal(calls[2].key, first.key); assert.equal(calls[2].body, first.body);
  writeStatus = 503;
  await assert.rejects(() => runtime.retryD1PendingBankOrderCommand(commandKey), failure => failure.commandKey === commandKey);
  assert.equal(memory.size, 1); assert.equal(calls[3].key, first.key);
  writeStatus = 200; readback = "confirmed";
  await runtime.retryD1PendingBankOrderCommand(commandKey);
  assert.equal(memory.size, 0); assert.equal(calls[4].key, first.key, "BANK_MANUAL_ORIGINAL_KEY_RECOVERED"); assert.equal(calls[4].body, first.body);
  const nextConfirmation = openedManual({ intentNo: "VQR-TEST21" }, runtime.manualCreditD1BankOrder).confirmation;
  await nextConfirmation.run(reason, undefined, { ...business, paymentReference: "FT-TEST21" });
  assert.equal(memory.size, 0, "BANK_MANUAL_CREDIT_CONFIRMED"); assert.match(calls[5].url, /VQR-TEST21\/manual-credit$/);
  assert.notEqual(calls[5].key, first.key, "a separate order gets a new command only after the first is confirmed");
  await runtime.apiRequest("finance", "/topup/fixture", { method: "POST", body: "{}", idempotencyPrefix: "existing-fixture" });
  assert.equal(memory.size, 0, "existing commands keep their success-clears behavior");
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};
const authSource = parse("lib/store/admin-auth.ts");
const authInitializer = authSource.statements.filter(ts.isVariableStatement)
  .flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(authSource) === "useAdminAuth")?.initializer;
assert.ok(authInitializer);

for (const stage of ["post-401-response", "post-401-json", "post-200-response", "post-reject", "canonical-200-response", "canonical-200-json", "receipt-401-json",
  "final-confirm-401-response", "final-confirm-401-json", "final-confirm-200-json", "final-retry-401-response", "final-retry-401-json", "final-retry-200-json"]) {
  test(`real manual chain loses authority after logout/owner change at ${stage}`, async () => {
    const finalList = stage.startsWith("final-"), retryFinal = stage.startsWith("final-retry-");
    const started = deferred(), delayed = deferred(), storage = new Map(), writes = [], reads = [], logoutCalls = [], views = [], toasts = [], dataUpdates = [], loadUpdates = [], errors = [];
    let reloads = 0;
    const sessionStorage = { getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key),
      key: index => [...storage.keys()][index] ?? null, get length() { return storage.size; } };
    const okPost = () => new Response(JSON.stringify({ code: 0, data: { status: "CREDITED" } }));
    const creditedPage = () => page([order({ status: "CREDITED", intentStatus: "CREDITED", creditedUsdt: 20,
      receivedVnd: 527800, receivedAt: "2026-10-04T09:00:00.000Z", manualCreditAllowed: false,
      paymentUrl: null, confirmationSource: "ADMIN_MANUAL" })]);
    const runtime = { Headers, Response, AbortSignal, URL, URLSearchParams, console, requestSeq: 0,
      formatAdminApiError: message => message, outcomeStaysUnknown: status => status >= 500,
      bankView: "inflight", bankPage: 1, bankPageSize: 20, setBusy: () => {}, setError: value => errors.push(value), setBankPage: () => {},
      rail: "", status: "", query: "", pageNum: 1, pageSize: 20, requestId: { current: 0 },
      setLoading: value => loadUpdates.push(value), setData: value => dataUpdates.push(value), setPending: () => {}, setPageNum: () => {},
      setRetrying: () => {}, setWriteError: value => errors.push(value),
      setVietQr: value => views.push(value), toast: value => toasts.push(value),
      displayAdminError: failure => failure.message, normalizeD1VietQrOverview: value => value,
      create: () => initializer => {
        let state;
        const set = update => { state = { ...state, ...(typeof update === "function" ? update(state) : update) }; };
        state = initializer(set); return { getState: () => state };
      },
      window: { sessionStorage, localStorage: sessionStorage, location: { reload: () => { reloads++; } } },
      fetch: async (...args) => { logoutCalls.push(args); return new Response("{}"); },
      guardedFetch: async (url, init) => {
        if (init.method === "POST") {
          writes.push({ url, body: init.body, key: init.headers.get("Idempotency-Key") });
          if (stage === "post-401-json") return { ok: false, status: 401, headers: new Headers(),
            json: () => { started.resolve(); return delayed.promise; } };
          if (stage.startsWith("post-")) { started.resolve(); return delayed.promise; }
          return okPost();
        }
        reads.push(url);
        if (finalList) {
          if (url.includes("keyword=")) return new Response(JSON.stringify({ code: 0, data: creditedPage() }));
          if (url.includes("/vietqr/overview")) return new Response(JSON.stringify({ code: 0, data: { page: { items: [], total: 0 } } }));
          if (stage.endsWith("-json")) return { ok: !stage.includes("401"), status: stage.includes("401") ? 401 : 200, headers: new Headers(),
            json: () => { started.resolve(); return delayed.promise; } };
          started.resolve(); return delayed.promise;
        }
        if (stage === "receipt-401-json") {
          if (url.includes("/vietqr/orders")) return new Response(JSON.stringify({ code: 0, data: creditedPage() }));
          return { ok: false, status: 401, headers: new Headers(), json: () => { started.resolve(); return delayed.promise; } };
        }
        if (stage === "canonical-200-json") return { ok: true, status: 200, headers: new Headers(),
          json: () => { started.resolve(); return delayed.promise; } };
        started.resolve(); return delayed.promise;
      } };
    // Exercise the existing lifecycle, auth reset and owner-clearing store, not a
    // new owner/epoch implementation or a second pending store.
    for (const path of ["lib/admin/auth-lifecycle.ts", "lib/admin/auth-session.ts", "lib/admin/pending-mutation-store.ts"]) {
      execute(parse(path).text.replace(/^export\s+/gm, "")
        + (path.endsWith("auth-lifecycle.ts") ? "\nvar epochChangedClass = AdminAuthEpochChangedError;" : ""), runtime);
    }
    runtime.AdminAuthEpochChangedError = runtime.epochChangedClass;
    runtime.pendingMutations = runtime.createPendingMutationStore({ storageKey: "manual-owner-fixture" });
    execute(`var actualAuthStore = ${authInitializer.getText(authSource)};`, runtime);
    runtime.useAdminAuth = runtime.actualAuthStore;
    execute(client.statements.filter(node => (ts.isFunctionDeclaration(node) && (helperNames.has(node.name?.text)
        || ["buildQuery", "nextId", "isDOutcomeUnknownError", "assertD1BankManualAuthEpoch", "apiRequest", "fetchD1BankOrders", "submitD1BankManualCredit", "manualCreditD1BankOrder", "loadD1VietQrOverview", "listD1PendingBankOrderCommands", "retryD1PendingBankOrderCommand"].includes(node.name?.text)))
      || (ts.isClassDeclaration(node) && node.name?.text === "DOutcomeUnknownError"))
      .map(node => node.getText(client).replace(/^export\s+/, "")).join("\n"), runtime);
    execute(`var scopedBankWrite = ${bankWriteCallback.getText(recon)};`, runtime);
    runtime.applyBankWrite = runtime.scopedBankWrite;
    execute(`var actualOrderLoad = ${orderLoadCallback.getText(ui)};\nvar actualOrderRetry = ${orderRetryCallback.getText(ui)};\nvar actualParentRetry = ${parentRetryCallback.getText(recon)};`, runtime);
    runtime.load = runtime.actualOrderLoad; runtime.onRetry = runtime.actualParentRetry;
    const session = (adminId, username) => ({ adminId, username, operator: username, role: "finance", authorities: ["finance_d1_bank_reconcile"] });
    runtime.actualAuthStore.getState().signIn({ tokenType: "Bearer", session: session(101, "operator-A") });
    const input = { expectedVersion: 2, providerVersion: 2, receivedVnd: 527800, paymentReference: "FT-TEST20",
      receivedAt: "2026-10-04T09:00:00.000Z", evidenceRef: "media:vqr_123e4567e89b12d3a456426614174000",
      reason: "核实实际到账", operator: "operator-A" };
    const { confirmation, settled } = openedManual({}, runtime.manualCreditD1BankOrder, runtime);
    const business = { paymentReference: input.paymentReference, receivedAt: "2026-10-04T16:00:00",
      evidenceAssetId: "vqr_123e4567e89b12d3a456426614174000" };
    if (retryFinal) runtime.pendingMutations.remember(`POST|finance|/vietqr/orders/VQR-TEST20/manual-credit|${JSON.stringify(input)}`, "original-owner-A-command",
      { base: "finance", path: "/vietqr/orders/VQR-TEST20/manual-credit", method: "POST", body: JSON.stringify(input) });
    const pending = retryFinal ? runtime.actualOrderRetry("original-owner-A-command") : confirmation.run(input.reason, undefined, business);
    const completion = finalList ? pending : assert.rejects(pending, failure => failure.name === "AdminAuthEpochChangedError");
    await started.promise;
    assert.equal(writes.length, 1); const old = writes[0];
    const beforeLateUi = JSON.stringify({ dataUpdates, loadUpdates, errors, views, toasts });
    runtime.actualAuthStore.getState().signOut();
    runtime.actualAuthStore.getState().signIn({ tokenType: "Bearer", session: session(202, "operator-B") });
    await assert.rejects(() => confirmation.run(input.reason, undefined, business), failure => failure.name === "AdminAuthEpochChangedError");
    const fingerprint = `POST|finance|/vietqr/orders/VQR-TEST20/manual-credit|${old.body}`;
    runtime.pendingMutations.remember(fingerprint, "command-owned-by-B", { base: "finance",
      path: "/vietqr/orders/VQR-TEST20/manual-credit", method: "POST", body: old.body });
    const beforeLateResponse = JSON.stringify(runtime.pendingMutations.list());
    if (finalList && stage.endsWith("401-json")) delayed.resolve({ code: 401, message: "UNAUTHORIZED", data: null });
    else if (finalList && stage.endsWith("200-json")) delayed.resolve({ code: 0, data: creditedPage() });
    else if (finalList) delayed.resolve(new Response(JSON.stringify({ code: 401, message: "UNAUTHORIZED" }), { status: 401 }));
    else if (["post-401-json", "receipt-401-json"].includes(stage)) delayed.resolve({ code: 401, message: "UNAUTHORIZED", data: null });
    else if (stage === "post-401-response") delayed.resolve(new Response(JSON.stringify({ code: 401, message: "UNAUTHORIZED" }), { status: 401 }));
    else if (stage === "post-reject") delayed.reject(new Error("late fixture transport failure"));
    else if (stage === "canonical-200-json") delayed.resolve({ code: 0, data: creditedPage() });
    else if (stage === "canonical-200-response") delayed.resolve(new Response(JSON.stringify({ code: 0, data: creditedPage() })));
    else delayed.resolve(okPost());
    await completion;
    assert.equal(logoutCalls.length, 0, "old response must never log out the current owner");
    assert.equal(reloads, 0); assert.equal(writes.length, 1);
    assert.equal(runtime.actualAuthStore.getState().session.adminId, 202); assert.equal(runtime.actualAuthStore.getState().isAuthenticated, true);
    assert.equal(settled.length, finalList && !retryFinal ? 1 : 0, "final list must be the actual onSettled or retry-finally read");
    assert.equal(reads.length, finalList ? 3 : stage === "receipt-401-json" ? 2 : stage.startsWith("canonical-") ? 1 : 0, "old POST must not start a read under B's session");
    assert.equal(JSON.stringify({ dataUpdates, loadUpdates, errors, views, toasts }), beforeLateUi, "no stale result, error or finally state may publish after the epoch change");
    assert.equal(runtime.pendingMutations.get(fingerprint), "command-owned-by-B");
    assert.equal(JSON.stringify(runtime.pendingMutations.list()), beforeLateResponse,
      retryFinal ? "BANK_MANUAL_RETRY_STALE_OWNER_BLOCKED" : "old response cannot change B's capsule");
  });
}

const logoutRouteSource = parse("app/api/admin/auth/logout/route.ts");
const cookieTokenSource = parse("lib/admin/require-password-change-cleared.ts");
const topbarSource = parse("app/components/shell/topbar.tsx", ts.ScriptKind.TSX);
let topbarSignOut;
function findTopbarSignOut(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "handleSignOut") topbarSignOut = node;
  ts.forEachChild(node, findTopbarSignOut);
}
findTopbarSignOut(topbarSource); assert.ok(topbarSignOut);

function cookieAuthFixture(financeTransport = async () => { throw new Error("unexpected finance transport"); }) {
  const storage = new Map(), cookieJar = new Map(), logoutCalls = [], cookieEffects = new WeakMap();
  const lateLogout = deferred(), lateEnvelope = deferred();
  let reloads = 0;
  const sessionStorage = { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key),
    key: index => [...storage.keys()][index] ?? null, get length() { return storage.size; } };
  // Invoke the actual logout BFF. The cookie jar models the browser applying
  // its Set-Cookie envelope before returning the HTTP response to JavaScript.
  const logoutRoute = { Request, Response, URL, process: { env: { NEXION_BACKEND_URL: "https://backend.example.test" } },
    cookies: async () => { const snapshot = new Map(cookieJar); return { get: name => ({ value: snapshot.get(name) }) }; },
    fetch: async () => new Response(JSON.stringify({ code: 0 })),
    NextResponse: { json: (data, init) => {
      const response = new Response(JSON.stringify(data), init), effects = [];
      cookieEffects.set(response, effects);
      response.cookies = { set: (name, value, options) => effects.push({ name, value, options }) };
      return response;
    } } };
  execute(cookieTokenSource.statements.filter(node => (ts.isFunctionDeclaration(node) && node.name?.text === "readAdminAccessToken")
      || (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(cookieTokenSource) === "ADMIN_PASSWORD_CHANGE_COOKIE")))
    .map(node => node.getText(cookieTokenSource).replace(/^export\s+/, "")).join("\n"), logoutRoute);
  execute(logoutRouteSource.statements.filter(node => ts.isFunctionDeclaration(node)
      || (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ["ADMIN_TOKEN_COOKIE", "BACKEND_BASE_URL"].includes(item.name.getText(logoutRouteSource)))))
    .map(node => node.getText(logoutRouteSource).replace(/^export\s+/, "")).join("\n") + "\nvar passwordCookieName = ADMIN_PASSWORD_CHANGE_COOKIE;", logoutRoute);
  const browserLogout = (url, init) => {
    assert.equal(url, "/api/admin/auth/logout");
    const call = { token: cookieJar.get("nexion_admin_token"), coordinated: Boolean(init.signal) };
    logoutCalls.push(call);
    call.promise = (async () => {
      const response = await logoutRoute.POST(new Request("https://admin.example.test/api/admin/auth/logout", { method: "POST" }));
      if (!call.coordinated) { lateEnvelope.resolve(); await lateLogout.promise; }
      for (const effect of cookieEffects.get(response) ?? []) {
        if (effect.options.maxAge === 0) cookieJar.delete(effect.name);
        else cookieJar.set(effect.name, effect.value);
      }
      return response;
    })();
    return call.promise;
  };
  const runtime = { Headers, Response, Request, AbortSignal, AbortController, URL, URLSearchParams, console,
    setTimeout, clearTimeout, requestSeq: 0,
    window: { sessionStorage, localStorage: sessionStorage, location: { reload: () => { reloads++; } } },
    fetch: browserLogout, guardedFetch: financeTransport,
    formatAdminApiError: message => message || "rejected", outcomeStaysUnknown: status => status >= 500,
    create: () => initializer => {
      let state;
      const set = update => { state = { ...state, ...(typeof update === "function" ? update(state) : update) }; };
      state = initializer(set); return { getState: () => state };
    }, logoutAttemptRef: { current: false }, setLoggingOut: () => {},
    currentAdminSession: async () => { throw new Error("logout fixture must complete its real envelope"); } };
  for (const path of ["lib/admin/auth-lifecycle.ts", "lib/admin/auth-session.ts", "lib/admin/pending-mutation-store.ts", "lib/admin/logout-request.ts"]) {
    execute(parse(path).text.replace(/^export\s+/gm, "")
      + (path.endsWith("auth-lifecycle.ts") ? "\nvar epochChangedClass = AdminAuthEpochChangedError;" : ""), runtime);
  }
  runtime.AdminAuthEpochChangedError = runtime.epochChangedClass;
  runtime.pendingMutations = runtime.createPendingMutationStore({ storageKey: "manual-cookie-fixture" });
  execute(`var actualAuthStore = ${authInitializer.getText(authSource)};`, runtime);
  runtime.useAdminAuth = runtime.actualAuthStore;
  for (const action of ["beginLogout", "signOut", "beginLogoutVerification", "cancelLogout", "failLogoutUnknown"]) {
    runtime[action] = (...args) => runtime.actualAuthStore.getState()[action](...args);
  }
  execute(client.statements.filter(node => (ts.isFunctionDeclaration(node) && (helperNames.has(node.name?.text)
      || ["buildQuery", "nextId", "assertD1BankManualAuthEpoch", "apiRequest", "fetchD1BankOrders", "submitD1BankManualCredit", "manualCreditD1BankOrder", "retryD1PendingBankOrderCommand"].includes(node.name?.text)))
    || (ts.isClassDeclaration(node) && node.name?.text === "DOutcomeUnknownError"))
    .map(node => node.getText(client).replace(/^export\s+/, "")).join("\n"), runtime);
  execute(`${topbarSignOut.getText(topbarSource)}\nvar actualTopbarSignOut = handleSignOut;`, runtime);
  const signIn = (adminId, username) => {
    cookieJar.set("nexion_admin_token", `fixture-cookie-${adminId}`);
    cookieJar.set(logoutRoute.passwordCookieName, `fixture-password-cookie-${adminId}`);
    runtime.actualAuthStore.getState().signIn({ tokenType: "Bearer", session: { adminId, username, operator: username,
      role: "finance", authorities: ["finance_d1_bank_reconcile"] } });
  };
  const drainLogout = async () => {
    lateLogout.resolve(); await Promise.all(logoutCalls.map(call => call.promise));
    await new Promise(resolve => setImmediate(resolve));
  };
  return { runtime, cookieJar, passwordCookieName: logoutRoute.passwordCookieName, logoutCalls, lateEnvelope, signIn, drainLogout, get reloads() { return reloads; } };
}

test("actual legacy reset and Topbar logout demonstrate late logout cookies clearing the later login", async () => {
  const fixture = cookieAuthFixture(), { runtime, cookieJar, logoutCalls } = fixture;
  fixture.signIn(101, "operator-A");
  runtime.resetAdminSession(); await fixture.lateEnvelope.promise;
  await runtime.actualTopbarSignOut();
  assert.equal(runtime.actualAuthStore.getState().sessionResolution, "anonymous");
  fixture.signIn(202, "operator-B");
  assert.equal(cookieJar.get("nexion_admin_token"), "fixture-cookie-202");
  await fixture.drainLogout();
  assert.equal(logoutCalls.length, 2); assert.equal(logoutCalls[0].coordinated, false); assert.equal(logoutCalls[1].coordinated, true);
  assert.equal(logoutCalls[0].token, "fixture-cookie-101"); assert.equal(logoutCalls[1].token, "fixture-cookie-101");
  assert.equal(cookieJar.has("nexion_admin_token"), false); assert.equal(cookieJar.has(fixture.passwordCookieName), false);
  assert.equal(runtime.actualAuthStore.getState().session.adminId, 202); assert.equal(fixture.reloads, 1);
});

for (const stage of ["manual-post", "canonical-read", "orders-read"]) {
  test(`current new bank auth failure at ${stage} signs out locally, retains the original command and never sends an automatic logout`, async () => {
    const writes = [], reads = [];
    let mode = "initial";
    const fixture = cookieAuthFixture(async (url, init) => {
      if (init.method === "POST") {
        writes.push({ url, body: init.body, key: init.headers.get("Idempotency-Key") });
        const status = mode === "initial" && stage === "manual-post" ? 401 : mode === "initial" && stage === "orders-read" ? 503 : 200;
        return new Response(JSON.stringify({ code: status === 200 ? 0 : status, message: status === 401 ? "UNAUTHORIZED" : "fixture", data: { status: "CREDITED" } }), { status });
      }
      reads.push(url);
      if (mode === "initial") return new Response(JSON.stringify({ code: 401, message: "UNAUTHORIZED", data: null }), { status: 401 });
      return new Response(JSON.stringify({ code: 0, data: page([order({ status: "CREDITED", intentStatus: "CREDITED", creditedUsdt: 20,
        receivedVnd: 527800, receivedAt: "2026-10-04T09:00:00.000Z", manualCreditAllowed: false,
        paymentUrl: null, confirmationSource: "ADMIN_MANUAL" })]) }));
    });
    const { runtime, cookieJar, logoutCalls } = fixture;
    fixture.signIn(101, "operator-A");
    const input = { expectedVersion: 2, providerVersion: 2, receivedVnd: 527800, paymentReference: "FT-TEST20",
      receivedAt: "2026-10-04T09:00:00.000Z", evidenceRef: "media:vqr_123e4567e89b12d3a456426614174000", reason: "核实实际到账", operator: "operator-A" };
    const firstEpoch = runtime.adminAuthLifecycleEpoch();
    await assert.rejects(() => runtime.manualCreditD1BankOrder("VQR-TEST20", input), failure => failure.name === (stage === "canonical-read" ? "AdminAuthEpochChangedError" : "DOutcomeUnknownError"));
    if (stage === "orders-read") await assert.rejects(() => runtime.fetchD1BankOrders({ pageNum: 1, pageSize: 20 }), failure => failure.name === "AdminAuthEpochChangedError");
    assert.equal(runtime.actualAuthStore.getState().sessionResolution, "anonymous");
    assert.equal(runtime.actualAuthStore.getState().isAuthenticated, false); assert.ok(runtime.adminAuthLifecycleEpoch() > firstEpoch);
    assert.equal(logoutCalls.length, 0, "new current 401 must not start the uncoordinated L1");
    assert.equal(cookieJar.get("nexion_admin_token"), "fixture-cookie-101"); assert.equal(fixture.reloads, 0);
    const original = runtime.pendingMutations.list()[0]; assert.equal(runtime.pendingMutations.list().length, 1);
    assert.equal(original.body, JSON.stringify(input)); assert.equal(original.commandKey, writes[0].key);
    const originalBytes = JSON.stringify(runtime.pendingMutations.list());
    fixture.signIn(101, "operator-A");
    assert.equal(JSON.stringify(runtime.pendingMutations.list()), originalBytes, "same operator relogin retains the exact capsule");
    await assert.rejects(() => runtime.manualCreditD1BankOrder("VQR-TEST20", { ...input, reason: "重登后编辑理由" }), failure => failure.commandKey === original.commandKey);
    assert.equal(writes.length, 1);
    mode = "recovered"; await runtime.retryD1PendingBankOrderCommand(original.commandKey);
    assert.equal(writes[1].body, original.body); assert.equal(writes[1].key, original.commandKey);
    assert.equal(runtime.pendingMutations.list().length, 0); assert.equal(logoutCalls.length, 0);
    await runtime.actualTopbarSignOut(); fixture.signIn(202, "operator-B");
    runtime.pendingMutations.remember(original.fingerprint, "command-owned-by-B", { base: "finance", path: original.path, method: "POST", body: original.body });
    const bCapsule = JSON.stringify(runtime.pendingMutations.list());
    await fixture.drainLogout();
    assert.equal(logoutCalls.length, 1); assert.equal(logoutCalls[0].coordinated, true, "only the real controlled Topbar logout was sent");
    assert.equal(cookieJar.get("nexion_admin_token"), "fixture-cookie-202");
    assert.equal(cookieJar.get(fixture.passwordCookieName), "fixture-password-cookie-202");
    assert.equal(runtime.actualAuthStore.getState().session.adminId, 202); assert.equal(runtime.actualAuthStore.getState().isAuthenticated, true);
    assert.equal(JSON.stringify(runtime.pendingMutations.list()), bCapsule); assert.equal(fixture.reloads, 0);
  });
}

test("real order recovery finally does not refresh the old component after the auth epoch changes", async () => {
  let retryCallback;
  function findRetry(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ui) === "retry") retryCallback = node.initializer;
    ts.forEachChild(node, findRetry);
  }
  findRetry(ui); assert.ok(retryCallback);
  const delayed = deferred(), loads = [], errors = [], runtime = { window: {},
    setRetrying: () => {}, setWriteError: value => errors.push(value), onRetry: () => delayed.promise,
    load: async () => { loads.push("read"); }, displayAdminError: failure => failure.message };
  execute(parse("lib/admin/auth-lifecycle.ts").text.replace(/^export\s+/gm, ""), runtime);
  execute(`var scopedRetry = ${retryCallback.getText(ui)};`, runtime);
  runtime.renewAdminAuthLifecycle();
  const pending = runtime.scopedRetry("old-owner-command");
  runtime.completeAdminLogout(); runtime.renewAdminAuthLifecycle();
  delayed.reject(new Error("late old-owner failure")); await pending;
  assert.equal(loads.length, 0); assert.deepEqual(errors, [""]);
});

test("finance BFF routes only real order paths and rejects wrong read/write methods before auth or transport", async () => {
  const route = parse("app/api/admin/finance/[...path]/route.ts");
  const bff = { Response, cookies: () => { throw new Error("wrong methods must stop before auth"); } };
  execute(route.statements.filter(node => ts.isFunctionDeclaration(node)
    && ["isText", "backendPath", "jsonError", "proxy"].includes(node.name?.text)).map(node => node.getText(route)).join("\n"), bff);
  assert.equal(bff.backendPath(["vietqr", "orders"]), "/api/admin/finance/vietqr/orders");
  assert.equal(bff.backendPath(["vietqr", "orders", "VQR-TEST20", "manual-credit"]), "/api/admin/finance/vietqr/orders/VQR-TEST20/manual-credit");
  assert.equal(bff.backendPath(["vietqr", "orders", "../TEST20", "manual-credit"]), null);
  for (const [path, method] of [[["vietqr", "orders"], "POST"], [["vietqr", "orders", "VQR-TEST20", "manual-credit"], "GET"],
    [["vietqr", "orders", "VQR-TEST20", "manual-credit"], "PATCH"]]) {
    const result = await bff.proxy({ method }, { params: Promise.resolve({ path }) }); assert.equal(result.status, 405);
  }
});
