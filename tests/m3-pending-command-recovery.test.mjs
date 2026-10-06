import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const view = process.env.M3_PENDING_VIEW_SOURCE ? readFileSync(process.env.M3_PENDING_VIEW_SOURCE, "utf8") : read("app/components/domain-views/m-view.tsx");
const chat = process.env.M3_PENDING_CHAT_SOURCE ? readFileSync(process.env.M3_PENDING_CHAT_SOURCE, "utf8") : read("app/components/domain-views/m-tabs/m3-dedicated-chat.tsx");
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
// LF-normalized frozen r4 / r2-before production declarations: source SHA256 5a557147b5cc834664f1e3abe082397344a59f1de4d0989a61598f51aceacddd.
// Fixture SHA256 ac1a82c932961664f0f00c9780fadaccd4f3d8dbc945426ba4d36fbeeb67542e; execute them to reproduce legacy same-page reason drift.
const legacyView = [
  "const mCommands = createPendingMutationStore<MCommandRecord>({",
  "  storageKey: \"nexion-admin-m-content-commands-v1\",",
  "  isValidRecord: (record) => (record.value === undefined || typeof record.value === \"string\")",
  "    && (record.paramFingerprint === undefined || typeof record.paramFingerprint === \"string\")",
  "    && (record.clientMessageId === undefined || typeof record.clientMessageId === \"string\"),",
  "});",
  "const runMWrite = useCallback(",
  "    async (key: string, value: string, meta?: { action?: string; reason?: string; idempotencyKey?: string; commandKey?: string; onBackendResult?: (result: unknown) => void }): Promise<boolean> => {",
  "      if (isMUiKey(key)) {",
  "        setUiParams((prev) => {",
  "          const next = { ...prev, [key]: value };",
  "          if (session?.adminId) saveDockUi(session.adminId, next);",
  "          return next;",
  "        });",
  "        return true;",
  "      }",
  "      const fingerprint = `${key}\\u0000${value}\\u0000${meta?.reason?.trim() ?? \"\"}`;",
  "      const commandFingerprint = meta?.commandKey ?? fingerprint;",
  "      const records = mCommands.list();",
  "      const attempt = records.find((record) => record.fingerprint === commandSlot(commandFingerprint));",
  "      const idempotencyKey = meta?.idempotencyKey",
  "        ?? attempt?.commandKey",
  "        ?? records.find((record) => record.paramFingerprint === fingerprint)?.commandKey",
  "        ?? `m-${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;",
  "      const stableValue = attempt?.value ?? value;",
  "      const stableMetadata = pendingMCommandMetadata.current.get(commandFingerprint)",
  "        ?? { action: meta?.action, reason: meta?.reason };",
  "      const stableBaseline = pendingMCommandBaselines.current.get(commandFingerprint)",
  "        ?? { legacyParams, data: safeMData };",
  "      mCommands.remember(commandSlot(commandFingerprint), idempotencyKey, { value: stableValue, paramFingerprint: fingerprint });",
  "      pendingMCommandMetadata.current.set(commandFingerprint, stableMetadata);",
  "      pendingMCommandBaselines.current.set(commandFingerprint, stableBaseline);",
  "      try {",
  "        const backendResult = await applyMBackendWrite(key, stableValue, stableBaseline.legacyParams, stableBaseline.data, { ...meta, ...stableMetadata, idempotencyKey });",
  "        await reloadMContent();",
  "        meta?.onBackendResult?.(backendResult);",
  "        mCommands.forget(commandSlot(commandFingerprint));",
  "        pendingMCommandMetadata.current.delete(commandFingerprint);",
  "        pendingMCommandBaselines.current.delete(commandFingerprint);",
  "        return true;",
  "      } catch (error) {",
  "        await reloadMContent();",
  "        const message = displayAdminError(error);",
  "        // client 已接咽喉,英文网络错误不再到达;按原压制意图改判「咽喉网络中文」,命中仍不附加 detail。",
  "        const detail = message.includes(\"网络连接失败或后台服务不可达\") ? \"\" : ` · ${message}`;",
  "        setToast(`写入失败或结果未知,请保留当前输入并重试${detail}`);",
  "        return false;",
  "      }",
  "    },",
  "    [legacyParams, safeMData, reloadMContent, setToast, session?.adminId],",
  "  );"
].join("\n");

function scanView(source) {
  const ast = ts.createSourceFile("m-view.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const functions = new Map(), variables = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
    if (ts.isVariableDeclaration(node)) variables.set(node.name.getText(ast), node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { ast, functions, variables };
}
const { ast, functions, variables } = scanView(view);
const flush = () => new Promise(resolve => setImmediate(resolve));
const key = "I.session.convos", storageKey = "nexion-admin-m-content-commands-v1";
const reason = "原会话问题已经处理完毕", changedReason = "重新核对后确认结束服务";
const convo = (version = 7, status = "open", ownerAdminId = 4285) => ({ id: "CV-1", version, status, ownerAdminId, customerId: "3562", assignmentId: "9", customer: "测试客户", owner: "顾问", messages: [], detailReady: true, unread: 0, lastTs: 1 });
const value = (version = 7, status = "resolved") => JSON.stringify([convo(version, status)]);
const meta = (version = 7, suppliedReason = changedReason) => ({ commandKey: `m3:close:CV-1:${version}`, action: "结束服务会话 CV-1", reason: suppliedReason });
const response = (status, message, data = null) => new Response(JSON.stringify({ code: status === 200 ? 0 : status, message, data }), { status, headers: { "Content-Type": "application/json" } });

// Each page gets actual new pending-store and runMWrite instances; only sessionStorage
// survives. The real row writer, M client, envelope parser and fetch wire are executed.
function transportHarness(adminId = 4285) {
  const persisted = new Map(), requests = [], plans = [], toasts = [];
  const storage = { getItem: name => persisted.get(name) ?? null, setItem: (name, text) => persisted.set(name, text), removeItem: name => persisted.delete(name), key: index => [...persisted.keys()][index] ?? null, get length() { return persisted.size; } };
  const window = { sessionStorage: storage };
  const contract = {};
  new Function("exports", compile(read("lib/admin/m-support-read-contract.ts")))(contract);
  const support = {};
  new Function("require", "exports", compile(read("lib/admin/m-support-client.ts")))(() => contract, support);
  const auth = { adminId, role: "agent", authorities: ["service_m1_read", "service_m3_write"] };
  let ownerFailure = null, ownerReads = 0;
  const supportClient = { customerDetail: async () => { ownerReads += 1; if (ownerFailure) throw ownerFailure; return { agentAdminId: auth.adminId, assignmentId: "9" }; } };
  const imported = {
    "@/lib/admin/m-support-read-contract": contract,
    "@/lib/admin/m-support-client": support,
    "@/lib/admin/current-operator": { currentAdminOperator: () => String(auth.adminId) },
    "@/lib/store/admin-auth": { useAdminAuth: { getState: () => ({ session: auth }) } },
    "@/lib/admin/error-messages": { formatAdminApiError: message => message },
  };
  const client = {};
  new Function("require", "exports", "fetch", compile(read("lib/admin/m-client.ts")))(
    name => imported[name] ?? new Proxy({}, { get: () => () => undefined }), client,
    async (url, init) => {
      requests.push({ url, method: init.method, headers: Object.fromEntries(init.headers), body: JSON.parse(init.body) });
      const plan = plans.shift(); assert.ok(plan, "Unexpected production HTTP write");
      if (plan instanceof Error) throw plan;
      return plan;
    },
  );
  const helperCode = ["parseRows", "parseRecord", "reasonOf", "changedRow", "addedRow", "writeConversationRows", "applyMBackendWrite", "originalM3CloseBaseline"]
    .filter(name => functions.has(name)).map(name => functions.get(name).getText(ast)).join("\n");
  const helper = new Function("useAdminAuth", "supportClient", "mContentActions", compile(helperCode) + "\nreturn { applyMBackendWrite, reasonOf, originalM3CloseBaseline: typeof originalM3CloseBaseline === 'function' ? originalM3CloseBaseline : undefined };")(
    imported["@/lib/store/admin-auth"].useAdminAuth, supportClient, client.mContentActions,
  );
  function page(current = convo(7, "open", adminId), reload = async () => {}, confirmation = {}, source = { ast, variables }) {
    const storeExports = {};
    new Function("exports", "window", compile(read("lib/admin/pending-mutation-store.ts")))(storeExports, window);
    const mCommands = new Function("createPendingMutationStore", compile(`const ${source.variables.get("mCommands").getText(source.ast)};`) + "\nreturn mCommands;")(storeExports.createPendingMutationStore);
    let rememberCalls = 0;
    const remember = mCommands.remember;
    mCommands.remember = (...args) => { rememberCalls += 1; return remember(...args); };
    const pendingMCommandMetadata = { current: new Map() }, pendingMCommandBaselines = { current: new Map() };
    const qualifiedRef = { current: { authEpoch: 1, adminId: auth.adminId, qualified: true } };
    const callback = source.variables.get("runMWrite").initializer.arguments[0];
    const run = new Function("mCommands", "isMUiKey", "commandSlot", "pendingMCommandMetadata", "pendingMCommandBaselines", "legacyParams", "safeMData", "applyMBackendWrite", "reloadMContent", "setToast", "displayAdminError", "session", "authEpoch", "m3WriteQualifiedRef", "originalM3CloseBaseline", "reasonOf", "MContentReadError", "actionConfirmRunRef", "setActionConfirm",
      compile(`const run = ${callback.getText(source.ast)};`) + "\nreturn run;")(
      mCommands, () => false, fingerprint => `cmd|${fingerprint}`, pendingMCommandMetadata, pendingMCommandBaselines,
      { [key]: JSON.stringify([current]) }, { conversations: [current], supportAgentsAvailable: true }, helper.applyMBackendWrite, reload,
      message => toasts.push(message), error => error.message, auth, 1, qualifiedRef, helper.originalM3CloseBaseline, helper.reasonOf, contract.MContentReadError,
      confirmation.actionConfirmRunRef ?? { current: null }, confirmation.setActionConfirm ?? (() => {}),
    );
    return { run, mCommands, qualifiedRef, pendingMCommandMetadata, pendingMCommandBaselines, rememberCalls: () => rememberCalls };
  }
  async function startPending() {
    const initial = page();
    plans.push(new Error("lost original response"));
    assert.equal(await initial.run(key, JSON.stringify([convo(7, "resolved", adminId)]), meta(7, reason)), false);
    const record = initial.mCommands.list().find(record => record.fingerprint === "cmd|m3:close:CV-1:7");
    assert.equal(record.closeReason, reason, "The first real wire reason must be explicitly persisted");
    assert.equal(record.value, JSON.stringify([convo(7, "resolved", adminId)]), "Persist the original exact value and CAS together with its reason");
    assert.equal(record.commandKey, requests[0].headers["idempotency-key"]);
    initial.mCommands.remember("m3direct|m3:add-tag:OTHER:keep", "unrelated-original-key", { value: "unrelated input" });
    return initial;
  }
  function assertOriginal(request, status = "RESOLVED") {
    assert.equal(request.url, "/api/admin/content/conversations/CV-1/status");
    assert.equal(request.method, "PATCH");
    assert.equal(request.headers["idempotency-key"], requests[0].headers["idempotency-key"]);
    assert.deepEqual(request.body, { status, expectedStatus: "OPEN", expectedVersion: 7, operator: String(adminId), reason });
  }
  return { requests, plans, toasts, storage, page, startPending, assertOriginal, contract, legacyPage: () => page(undefined, undefined, undefined, scanView(legacyView)),
    ownerFailure(cause) { ownerFailure = cause; }, ownerReads: () => ownerReads,
    ownerDenied: () => new support.SupportClientError(403, 403, "SUPPORT_CUSTOMER_READ_FORBIDDEN"),
  };
}

test("a new-format pending end keeps its explicit original reason and only its definite 409 is retired", async () => {
  const probe = transportHarness(); await probe.startPending();
  const refreshed = probe.page();
  refreshed.pendingMCommandMetadata.current.set("m3:close:CV-1:7", { reason: changedReason });
  refreshed.pendingMCommandBaselines.current.set("m3:close:CV-1:7", { legacyParams: { [key]: value(9, "open") }, data: null });
  probe.plans.push(response(409, "INVALID_STATE_TRANSITION"));
  assert.equal(await refreshed.run(key, value(), meta()), false);
  probe.assertOriginal(probe.requests[1]);
  assert.equal(refreshed.mCommands.get("cmd|m3:close:CV-1:7"), undefined);
  assert.equal(refreshed.mCommands.get("m3direct|m3:add-tag:OTHER:keep"), "unrelated-original-key");
  assert.equal(refreshed.pendingMCommandMetadata.current.size, 0);
  assert.equal(refreshed.pendingMCommandBaselines.current.size, 0);
  assert.match(probe.toasts.at(-1), /后台明确拒绝/);
  probe.plans.push(response(200, "OK", { status: "RESOLVED", version: 8 }));
  assert.equal(await refreshed.run(key, value(), meta()), true);
  const fresh = probe.requests[2];
  assert.notEqual(fresh.headers["idempotency-key"], probe.requests[0].headers["idempotency-key"]);
  assert.deepEqual(fresh.body, { status: "RESOLVED", expectedStatus: "OPEN", expectedVersion: 7, operator: "4285", reason: changedReason });
});

test("unknown, idempotency-unknown and 5xx retain original key/body/CAS/reason across refresh and later versions", async () => {
  const probe = transportHarness(); await probe.startPending();
  probe.plans.push(new Error("lost original response"));
  assert.equal(await probe.page().run(key, value(), meta()), false);
  const afterNetwork = probe.storage.getItem(storageKey);
  for (const reply of [response(409, "IDEMPOTENCY_RESULT_UNKNOWN"), response(503, "UPSTREAM_UNAVAILABLE"), new Response(JSON.stringify({ code: 409, message: "INVALID_STATE_TRANSITION", data: null }), { status: 503 })]) {
    probe.plans.push(reply);
    assert.equal(await probe.page(convo(9)).run(key, value(9), { ...meta(9), idempotencyKey: "must-not-rotate-unknown" }), false);
    assert.equal(probe.storage.getItem(storageKey), afterNetwork);
  }
  for (const request of probe.requests) probe.assertOriginal(request);
  probe.plans.push(response(409, "INVALID_STATE_TRANSITION"));
  const resolved = probe.page(convo(9));
  assert.equal(await resolved.run(key, value(9), meta(9)), false);
  probe.assertOriginal(probe.requests.at(-1));
  assert.equal(resolved.mCommands.get("cmd|m3:close:CV-1:7"), undefined);
  probe.plans.push(response(200, "OK", { status: "RESOLVED", version: 10 }));
  assert.equal(await probe.page(convo(9)).run(key, value(9), meta(9)), true);
  assert.deepEqual(probe.requests.at(-1).body, { status: "RESOLVED", expectedStatus: "OPEN", expectedVersion: 9, operator: "4285", reason: changedReason });
  assert.notEqual(probe.requests.at(-1).headers["idempotency-key"], probe.requests[0].headers["idempotency-key"]);
});

test("an earlier unknown successful end is settled before the new-version end needs another confirmation", async () => {
  const probe = transportHarness(); await probe.startPending();
  const refreshed = probe.page(convo(9));
  let projected = false;
  probe.plans.push(response(200, "OK", { status: "RESOLVED", version: 8 }));
  assert.equal(await refreshed.run(key, value(9), { ...meta(9), onBackendResult: () => { projected = true; } }), false);
  probe.assertOriginal(probe.requests[1], "RESOLVED");
  assert.equal(projected, false, "the original result must not masquerade as this new-version action");
  assert.equal(refreshed.mCommands.get("cmd|m3:close:CV-1:7"), undefined);
  assert.match(probe.toasts.at(-1), /原会话结束操作已确认/);
});

test("owner preread denial and latest unknown qualification cannot retire or replace the original pending receipt", async () => {
  const probe = transportHarness(); await probe.startPending(); const page = probe.page();
  const before = probe.storage.getItem(storageKey);
  page.qualifiedRef.current = { authEpoch: 1, adminId: 4285, qualified: false };
  assert.equal(await page.run(key, value(), meta()), false);
  assert.equal(probe.ownerReads(), 1); assert.equal(probe.requests.length, 1);
  assert.equal(probe.storage.getItem(storageKey), before);
  const refreshed = probe.page(); probe.ownerFailure(probe.ownerDenied());
  assert.equal(await refreshed.run(key, value(), meta()), false);
  assert.equal(probe.requests.length, 1);
  assert.equal(refreshed.mCommands.get("cmd|m3:close:CV-1:7"), probe.requests[0].headers["idempotency-key"]);
});

test("actual legacy changed-reason retries cannot prove the original reason after refresh and remain blocked without rewriting the receipt", async () => {
  const probe = transportHarness(), legacy = probe.legacyPage();
  probe.plans.push(new Error("lost first response"), new Error("lost retry response"));
  assert.equal(await legacy.run(key, value(7, "closed"), meta(7, reason)), false);
  assert.equal(await legacy.run(key, value(7, "closed"), meta(7, changedReason)), false);
  for (const request of probe.requests) probe.assertOriginal(request, "CLOSED");
  const oldRecord = legacy.mCommands.list()[0];
  assert.equal(oldRecord.closeReason, undefined);
  assert.ok(oldRecord.paramFingerprint.endsWith(changedReason));
  assert.ok(!oldRecord.paramFingerprint.endsWith(reason));
  const persisted = probe.storage.getItem(storageKey), reads = probe.ownerReads();
  const refreshed = probe.page(convo(9));
  const recordBefore = refreshed.mCommands.list();
  assert.equal(await refreshed.run(key, value(9), { ...meta(9), idempotencyKey: "must-not-rotate-legacy" }), false);
  assert.equal(probe.requests.length, 2, "No guessed reason may reach the actual HTTP writer");
  assert.equal(probe.ownerReads(), reads, "Block before owner preread");
  assert.equal(refreshed.rememberCalls(), 0, "Do not promote a guessed legacy reason to closeReason");
  assert.deepEqual(refreshed.mCommands.list(), recordBefore);
  assert.equal(probe.storage.getItem(storageKey), persisted);
  assert.equal(refreshed.pendingMCommandMetadata.current.size, 0);
  assert.equal(refreshed.pendingMCommandBaselines.current.size, 0);
  assert.match(probe.toasts.at(-1), /理由无法核对/);
});

test("missing legacy reason remains blocked, and a reload read error cannot be misclassified as a rejected write", async () => {
  const probe = transportHarness(), page = probe.page();
  page.mCommands.remember("cmd|m3:close:CV-1:7", "legacy-original-key", { value: value(7, "closed") });
  assert.equal(await page.run(key, value(), meta()), false); assert.equal(probe.requests.length, 0);
  assert.equal(page.mCommands.get("cmd|m3:close:CV-1:7"), "legacy-original-key");
  const missingPayload = transportHarness(), blocked = missingPayload.page();
  blocked.mCommands.remember("cmd|m3:close:CV-1:7", "legacy-original-key", { closeReason: reason });
  assert.equal(await blocked.run(key, value(), meta()), false); assert.equal(missingPayload.requests.length, 0);
  assert.equal(blocked.mCommands.get("cmd|m3:close:CV-1:7"), "legacy-original-key");
  const other = transportHarness(), fresh = other.page(convo(), async () => { throw new other.contract.MContentReadError(409, 409, "INVALID_STATE_TRANSITION", "read reload failed"); });
  other.plans.push(response(200, "OK", { status: "RESOLVED", version: 8 }));
  await assert.rejects(fresh.run(key, value(), meta()), /read reload failed/);
  assert.ok(fresh.mCommands.get("cmd|m3:close:CV-1:7"));
});

// Reuse the proven isolated React lifecycle harness without changing its sealed source.
// Only expose its virtual button callback; the actual M3 production component is unchanged.
function modalHarness() {
  const testAst = ts.createSourceFile("harness.mjs", read("tests/m3-manager-race-end-wire.test.mjs"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const harness = testAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "harness");
  const marker = "found.push({ label: text(node), disabled: node.props.disabled })";
  const body = harness.getText(testAst); assert.ok(body.includes(marker));
  return new Function("compile", "chatSource", "assert", "session", `${body.replace(marker, "found.push({ label: text(node), disabled: node.props.disabled, onClick: node.props.onClick })")}\nreturn harness;`)(
    compile, chat, assert, () => ({ adminId: 4283, role: "agent", authorities: ["service_m1_read", "service_m3_write"] }),
  );
}

// Execute the actual parent's conditional modal JSX and onConfirm/onClose callbacks.
// The virtual modal carries those production props; no DOM or browser is involved.
function parentModalHarness() {
  let modalNode;
  function find(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "OperationConfirmModal") modalNode = node;
    ts.forEachChild(node, find);
  }
  find(ast); assert.ok(modalNode, "Actual parent modal element is required");
  while (!ts.isJsxExpression(modalNode)) modalNode = modalNode.parent;
  const render = new Function("require", "exports", "OperationConfirmModal", "mc", "setActionConfirm", "actionConfirmRunRef",
    compile(`const modal = ${modalNode.expression.getText(ast)};`) + "\nreturn modal;");
  let mc = null;
  const actionConfirmRunRef = { current: null };
  const setActionConfirm = next => { mc = typeof next === "function" ? next(mc) : next; };
  const jsx = { jsx: (type, props) => ({ type, props }) };
  return {
    actionConfirmRunRef, setActionConfirm, open: setActionConfirm, current: () => mc,
    render: () => render(() => jsx, {}, "OperationConfirmModal", mc, setActionConfirm, actionConfirmRunRef),
  };
}

async function openRealEnd(probe, detail) {
  probe.render();
  const button = probe.buttons().find(button => button.label === "结束服务会话");
  assert.ok(button, "Actual M3 end button must be present");
  const before = probe.profileRequests.length;
  const opening = button.onClick(); await flush();
  assert.equal(probe.profileRequests.length, before + 1, "Every new opening must perform latest checkActionReady");
  probe.profileRequests.at(-1).resolve(detail);
  await opening; probe.render();
}

async function currentEndPage() {
  const transport = transportHarness(4283); await transport.startPending();
  const parent = parentModalHarness(), page = transport.page(convo(9, "open", 4283), undefined, parent);
  const probe = modalHarness()({ search: "?conversationNo=CV-1" }), outcomes = [], invalidations = [];
  const invalidate = probe.ctx.invalidateScope.bind(probe.ctx);
  probe.ctx.invalidateScope = (...args) => { invalidations.push(args); return invalidate(...args); };
  probe.ctx.openActionConfirm = parent.open;
  probe.ctx.setParam = async (...args) => { const result = await page.run(...args); outcomes.push(result); return result; };
  const detail = { customerId: "3562", assignmentId: "9", agentAdminId: 4283, waitingReply: false };
  probe.publish({
    "I.session.conversationsAvailable": "1", "I.session.convos": JSON.stringify([convo(9, "open", 4283)]),
    "I.support.agentsAvailable": "1", "I.support.agents": JSON.stringify([{ adminId: 4283, seatType: "DEDICATED", enabled: true }]),
  });
  probe.profileRequests[0].resolve(detail); await flush(); probe.render();
  await openRealEnd(probe, detail);
  assert.ok(parent.render(), "Actual M3 handler must open the actual parent's reason modal");
  return { transport, parent, page, probe, detail, outcomes, invalidations };
}

test("settling an earlier end removes the actual old parent modal; another end must reopen and check latest waitingReply and owner", async () => {
  for (const denial of ["waitingReply", "owner"]) {
    const { transport, parent, probe, detail, outcomes, invalidations } = await currentEndPage();
    try {
      transport.plans.push(response(200, "OK", { status: "RESOLVED", version: 8 }));
      await parent.render().props.onConfirm(changedReason);
      transport.assertOriginal(transport.requests[1]);
      assert.equal(outcomes.at(-1), false, "Earlier success must not pretend the requested version succeeded");
      assert.equal(parent.render(), null, "There must be no old modal available for a second click");
      const writes = transport.requests.length;
      await openRealEnd(probe, denial === "waitingReply" ? { ...detail, waitingReply: true } : { ...detail, agentAdminId: 999 });
      assert.equal(parent.render(), null);
      assert.equal(transport.requests.length, writes);
      if (denial === "waitingReply") assert.ok(probe.text().includes("还有客户消息待回复"));
      else assert.deepEqual(invalidations, [["CV-1", "3562"]], "Latest owner mismatch must invalidate only this exact scope");
      if (denial === "waitingReply") {
        await openRealEnd(probe, detail);
        transport.plans.push(response(200, "OK", { status: "RESOLVED", version: 10 }));
        await parent.render().props.onConfirm(changedReason);
        assert.equal(parent.render(), null);
        assert.equal(outcomes.at(-1), true);
        assert.deepEqual(transport.requests.at(-1).body, { status: "RESOLVED", expectedStatus: "OPEN", expectedVersion: 9, operator: "4283", reason: changedReason });
        assert.notEqual(transport.requests.at(-1).headers["idempotency-key"], transport.requests[0].headers["idempotency-key"]);
      }
    } finally { probe.unmount(); }
  }
});

test("a recovered old end cannot close a different confirmation opened while its HTTP result was pending", async () => {
  const { transport, parent, probe, outcomes } = await currentEndPage();
  try {
    let complete;
    transport.plans.push(new Promise(resolve => { complete = resolve; }));
    const oldModal = parent.render(), finishing = oldModal.props.onConfirm(changedReason);
    await flush();
    transport.assertOriginal(transport.requests[1]);
    oldModal.props.onClose(); assert.equal(parent.render(), null);
    const replacement = { action: "另一项业务确认", detail: "独立操作", run: async () => true };
    parent.open(replacement);
    complete(response(200, "OK", { status: "RESOLVED", version: 8 }));
    await finishing;
    assert.equal(outcomes.at(-1), false);
    assert.equal(parent.current(), replacement, "Only the original confirmation identity may be closed");
    assert.equal(parent.render().props.action, replacement.action);
    assert.equal(transport.requests.length, 2);
  } finally { probe.unmount(); }
});

test("an explicitly rejected close retires its receipt and removes its modal before any new latest-owner and waitingReply check", async () => {
  for (const denial of ["waitingReply", "owner"]) {
    const { transport, parent, page, probe, detail, outcomes, invalidations } = await currentEndPage();
    try {
      transport.plans.push(response(409, "INVALID_STATE_TRANSITION"));
      await parent.render().props.onConfirm(changedReason);
      transport.assertOriginal(transport.requests[1]);
      assert.equal(outcomes.at(-1), false);
      assert.equal(page.mCommands.get("cmd|m3:close:CV-1:7"), undefined);
      assert.equal(page.mCommands.get("m3direct|m3:add-tag:OTHER:keep"), "unrelated-original-key");
      assert.equal(parent.render(), null, "A definite rejection must remove the old modal before a second click can mint a key");
      const writes = transport.requests.length;
      await openRealEnd(probe, denial === "waitingReply" ? { ...detail, waitingReply: true } : { ...detail, agentAdminId: 999 });
      assert.equal(parent.render(), null);
      assert.equal(transport.requests.length, writes);
      if (denial === "owner") assert.deepEqual(invalidations, [["CV-1", "3562"]]);
      else {
        assert.ok(probe.text().includes("还有客户消息待回复"));
        await openRealEnd(probe, detail);
        transport.plans.push(response(200, "OK", { status: "RESOLVED", version: 10 }));
        await parent.render().props.onConfirm(changedReason);
        assert.equal(parent.render(), null);
        assert.equal(outcomes.at(-1), true);
        assert.deepEqual(transport.requests.at(-1).body, { status: "RESOLVED", expectedStatus: "OPEN", expectedVersion: 9, operator: "4283", reason: changedReason });
        assert.notEqual(transport.requests.at(-1).headers["idempotency-key"], transport.requests[0].headers["idempotency-key"]);
      }
    } finally { probe.unmount(); }
  }
});

test("an explicit close rejection preserves a different modal opened while its original HTTP result was pending", async () => {
  const { transport, parent, page, probe, outcomes } = await currentEndPage();
  try {
    let complete;
    transport.plans.push(new Promise(resolve => { complete = resolve; }));
    const oldModal = parent.render(), finishing = oldModal.props.onConfirm(changedReason);
    await flush(); transport.assertOriginal(transport.requests[1]);
    oldModal.props.onClose(); assert.equal(parent.render(), null);
    const replacement = { action: "另一项业务确认", detail: "独立操作", run: async () => true };
    parent.open(replacement);
    complete(response(409, "INVALID_STATE_TRANSITION"));
    await finishing;
    assert.equal(outcomes.at(-1), false);
    assert.equal(page.mCommands.get("cmd|m3:close:CV-1:7"), undefined);
    assert.equal(parent.current(), replacement);
    assert.equal(parent.render().props.action, replacement.action);
    assert.equal(transport.requests.length, 2);
  } finally { probe.unmount(); }
});

test("unknown, 5xx and owner-preread failures keep the original close receipt and its actual parent confirmation", async () => {
  for (const failure of ["unknown", "5xx", "owner-preread"]) {
    const { transport, parent, page, probe, outcomes } = await currentEndPage();
    try {
      const original = parent.current(), saved = transport.storage.getItem(storageKey);
      if (failure === "owner-preread") transport.ownerFailure(transport.ownerDenied());
      else transport.plans.push(failure === "unknown" ? new Error("lost original result") : response(503, "UPSTREAM_UNAVAILABLE"));
      await parent.render().props.onConfirm(changedReason);
      assert.equal(outcomes.at(-1), false);
      assert.equal(parent.current(), original, "An indeterminate failure cannot dismiss the original recovery confirmation");
      assert.equal(page.mCommands.get("cmd|m3:close:CV-1:7"), transport.requests[0].headers["idempotency-key"]);
      assert.equal(transport.storage.getItem(storageKey), saved);
      assert.equal(transport.requests.length, failure === "owner-preread" ? 1 : 2);
      if (failure !== "owner-preread") transport.assertOriginal(transport.requests[1]);
    } finally { probe.unmount(); }
  }
});

test("a real opened end confirmation expires when qualification becomes unknown and cannot revive after recovery", async () => {
  const create = modalHarness(), probe = create({ search: "?conversationNo=CV-1" });
  let confirmation, writes = 0;
  probe.ctx.openActionConfirm = value => { confirmation = value; };
  probe.ctx.setParam = async () => { writes += 1; return true; };
  const detail = { customerId: "3562", assignmentId: "9", agentAdminId: 4283 };
  const qualified = { "I.support.agentsAvailable": "1", "I.support.agents": JSON.stringify([{ adminId: 4283, seatType: "DEDICATED", enabled: true }]) };
  try {
    probe.publish({ "I.session.conversationsAvailable": "1", "I.session.convos": JSON.stringify([convo(7, "open", 4283)]), ...qualified });
    probe.profileRequests[0].resolve(detail); await flush(); probe.render();
    const button = probe.buttons().find(button => ["结束服务会话", "关闭服务会话"].includes(button.label));
    assert.ok(button, "The real component should expose the end action after verified ownership");
    const opening = button.onClick(); await flush();
    probe.profileRequests.at(-1).resolve(detail); await opening;
    assert.ok(confirmation, "The actual production handler opened a reason confirmation");
    const before = writes;
    probe.publish({ "I.support.agentsAvailable": "0", "I.support.agents": "[]", "I.support.agentsError": "unavailable" });
    const pendingText = probe.text(), unknownResult = await confirmation.run(reason), unknownWrites = writes;
    probe.publish(qualified);
    const recoveredResult = await confirmation.run(reason);
    assert.equal(unknownResult, false); assert.equal(unknownWrites, before);
    assert.equal(recoveredResult, false); assert.equal(writes, before);
    assert.ok(pendingText.includes("坐席身份待核对"));
    assert.ok(!pendingText.includes("权限已变化"));
  } finally { probe.unmount(); }
});
