import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chatSource = process.env.M3_REGRESSION_SOURCE
  ? readFileSync(process.env.M3_REGRESSION_SOURCE, "utf8")
  : read("app/components/domain-views/m-tabs/m3-dedicated-chat.tsx");
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const row = (id, customerId, ownerAdminId = 4285) => ({
  id, customerId, ownerAdminId, version: 7, assignmentId: "9", owner: "顾问", customer: `客户${customerId}`,
  status: "open", messages: [], detailReady: true, unread: 0, lastTs: 1, type: "support",
});
const session = (adminId = 4283, authorities = ["service_m1_read", "service_m3_read", "service_m3_write"]) => ({ adminId, role: "agent", authorities });

// Run the actual production component with isolated React lifecycle and virtual JSX.
// There is no listener, real network, DOM, browser, timer or service in this harness.
function harness({ auth = session(), search = "?conversationNo=CV-1", drafts = {}, scopeMode = "MANAGED", deferredScope = false } = {}) {
  const slots = [], effects = [], listeners = new Map(), profileRequests = [], scopeRequests = [];
  const storage = {};
  Object.defineProperties(storage, {
    getItem: { value: key => storage[key] ?? null },
    setItem: { value: (key, value) => { storage[key] = String(value); } },
    removeItem: { value: key => { delete storage[key]; } },
  });
  storage[`nexion-m3-drafts:${auth.adminId}`] = JSON.stringify(drafts);
  const ctx = {
    params: { "I.session.conversationsAvailable": "0", "I.support.agentsAvailable": "0", "I.support.agentsError": "none", "I.support.agents": "[]" },
    pget(key) { return this.params[key]; },
    setParam: async () => true, loadConversationDetail: async () => undefined,
    invalidateScope(conversationNo, customerId) { emit({ conversationNo, customerId }); },
  };
  let cursor = 0, dirty = false, running = false, tree;
  const same = (previous, deps) => previous && deps && previous.length === deps.length && deps.every((item, index) => Object.is(item, previous[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, next => {
        const value = typeof next === "function" ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { value: factory(), deps };
      return slots[index].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!same(previous?.deps, deps)) { slots[index] = { deps, cleanup: previous?.cleanup }; effects.push({ index, effect }); }
    },
    useSyncExternalStore(_subscribe, get) { return react.useMemo(get, []); },
  };
  const window = {
    location: { search, href: `http://isolated.invalid/service/conversations${search}` }, history: { replaceState() {} },
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
  };
  const realtime = { ready: false, presence: null };
  const supportClient = {
    overview({ signal }) {
      if (!deferredScope) return Promise.resolve({ scope: { actorId: auth.adminId, mode: scopeMode } });
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      scopeRequests.push({ signal, resolve, reject });
      return promise;
    },
    customerDetail(customerId, signal) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      profileRequests.push({ customerId, signal, resolve, reject });
      return promise;
    },
    attachmentPolicy: async () => ({ allowedMimeTypes: [], maxBytes: 1 }),
  };
  const unused = () => null;
  const imports = {
    react,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "fragment" },
    "@/lib/store/admin-auth": { useAdminAuth: select => select({ session: auth, authEpoch: 1 }) },
    "@/lib/admin/admin-conversation-realtime": { subscribeAdminRealtime: unused, getAdminRealtimeSnapshot: () => realtime, watchAdminConversation: unused, sendAdminTyping: unused },
    "@/lib/admin/error-messages": { displayAdminError: cause => `服务错误${cause.status ?? ""}` },
    "@/lib/admin/m-support-client": { supportClient, SupportClientError: Error, isIndeterminateSupportError: () => false },
    "@/lib/admin/pending-mutation-store": { createPendingMutationStore: () => ({ list: () => [], forget: unused, remember: unused, isDurablyStored: () => true }) },
  };
  const exported = {};
  new Function("require", "exports", "window", "document", "sessionStorage", "setTimeout", "clearTimeout", compile(chatSource))(
    name => imports[name] ?? new Proxy({}, { get: () => unused }), exported, window, { visibilityState: "hidden" }, storage, () => 1, unused,
  );
  function render() {
    if (running) return;
    running = true;
    let rounds = 0;
    do {
      assert.ok(++rounds < 30, "Production component did not settle");
      cursor = 0; dirty = false; tree = exported.M3DedicatedChat({ ctx });
      for (const job of effects.splice(0)) { slots[job.index].cleanup?.(); slots[job.index].cleanup = job.effect(); }
    } while (dirty);
    running = false;
  }
  function emit(detail) { for (const callback of listeners.get("support-scope-invalidated") ?? []) callback({ detail }); render(); }
  function text(node) {
    if (Array.isArray(node)) return node.map(text).join("");
    if (node == null || typeof node === "boolean") return "";
    if (typeof node !== "object") return String(node);
    return text(node.props?.children);
  }
  render();
  return {
    storage, profileRequests, scopeRequests, ctx, render, emit, text: () => text(tree),
    publish(values) { ctx.params = { ...ctx.params, ...values }; render(); },
    buttons() {
      const found = [];
      function walk(node) { if (Array.isArray(node)) { node.forEach(walk); return; } if (!node || typeof node !== "object") return; if (node.type === "button") found.push({ label: text(node), disabled: node.props.disabled, onClick: node.props.onClick }); walk(node.props?.children); }
      walk(tree); return found;
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const conversations = rows => ({ "I.session.conversationsAvailable": "1", "I.session.convos": JSON.stringify(rows) });
const roster = (seatType = "MANAGER") => ({ "I.support.agentsAvailable": "1", "I.support.agents": JSON.stringify([{ adminId: 4283, seatType, enabled: true, position: seatType === "MANAGER" ? "客服主管" : "客服顾问" }]) });

test("552 list labels use each segment's pending count before and after customer aggregate loads", async () => {
  const probe = harness();
  const rows = [0, 1, undefined, null, -1, "0"].map((pendingReplyCount, index) => ({
    ...row(`CV-${index + 1}`, "1"), status: "closed", lastPublicMessageId: 3730,
    pendingReplyCount,
  }));
  const labels = () => probe.buttons().filter(button => button.label.includes("发起来源未记录")).map(button => button.label);
  const verify = () => {
    const actual = labels();
    assert.equal(actual.length, 6);
    assert.match(actual[0], /已处理$/);
    assert.match(actual[1], /待专属客服回复$/);
    for (const label of actual.slice(2)) assert.match(label, /查看待回复状态$/);
  };
  try {
    await flush(); probe.render();
    probe.publish({ ...conversations(rows), ...roster() });
    verify();
    probe.profileRequests[0].resolve({ customerId: "1", agentAdminId: 4285, assignmentId: "9", waitingReply: true, pendingReplyCount: 3 });
    await flush(); probe.render();
    verify();
    probe.publish(conversations(rows.map(value => value.id === "CV-1" ? { ...value, pendingReplyCount: 2 } : value)));
    assert.match(labels()[0], /待专属客服回复$/);
    probe.publish(conversations(rows.map(value => value.id === "CV-1" ? { ...value, pendingReplyCount: undefined } : value)));
    assert.match(labels()[0], /查看待回复状态$/);
  } finally { probe.unmount(); }
});

test("conversation data arriving before manager qualification stays pending, then shows all 44 without false revocation", async () => {
  const probe = harness();
  try {
    await flush(); probe.publish(conversations(Array.from({ length: 44 }, (_, index) => row(`CV-${index + 1}`, String(index + 1)))));
    const pendingText = probe.text(), pendingRequests = probe.profileRequests.length;
    const pendingButtons = probe.buttons().filter(button => ["主动联系", "圈选群发"].includes(button.label));
    await flush(); probe.publish(roster()); await flush(); probe.render();
    assert.ok(probe.text().includes("44 段"));
    assert.ok(!probe.text().includes("当前已无权"));
    assert.equal(probe.profileRequests.length, 1);
    assert.ok(pendingText.includes("专属客服身份待核对"));
    assert.ok(!pendingText.includes("当前已无权"));
    assert.equal(pendingRequests, 0);
    for (const button of pendingButtons) assert.equal(button.disabled, true);
  } finally { probe.unmount(); }
});

test("unknown qualification preserves private drafts; a real shared 403 revoke clears them before the roster arrives", async () => {
  const probe = harness({ drafts: { "CV-1": "private pending draft" } });
  try {
    await flush(); probe.publish(conversations([row("CV-1", "1", 4283)]));
    assert.deepEqual(JSON.parse(probe.storage["nexion-m3-drafts:4283"]), { "CV-1": "private pending draft" });
    probe.emit({ conversationNo: "CV-1", customerId: "1" });
    assert.deepEqual(JSON.parse(probe.storage["nexion-m3-drafts:4283"]), {});
    await flush(); probe.publish(roster());
    assert.ok(!probe.text().includes("客户1"));
    assert.equal(probe.profileRequests.length, 0);
  } finally { probe.unmount(); }
});

test("an actual 403 from the production customer read invalidates the exact customer and its draft", async () => {
  const probe = harness({ drafts: { "CV-1": "private draft" } });
  try {
    await flush(); probe.render();
    probe.publish({ ...conversations([row("CV-1", "1")]), ...roster() });
    assert.equal(probe.profileRequests.length, 1);
    probe.profileRequests[0].reject({ status: 403 }); await flush(); probe.render();
    assert.deepEqual(JSON.parse(probe.storage["nexion-m3-drafts:4283"]), {});
    assert.ok(!probe.text().includes("客户1"));
  } finally { probe.unmount(); }
});

test("a read-only manager can review while a normal agent and M3-only reader do not gain another owner's scope", async () => {
  const manager = harness({ auth: session(4283, ["service_m1_read", "service_m3_read"]) });
  const agent = harness({ scopeMode: "PERSONAL" });
  const m3Only = harness({ auth: session(4283, ["service_m3_read"]), search: "", scopeMode: "PERSONAL" });
  try {
    await flush(); manager.render();
    manager.publish({ ...conversations([row("CV-1", "1")]), ...roster() });
    assert.ok(manager.text().includes("1 段"));
    assert.equal(manager.buttons().find(button => button.label === "主动联系").disabled, true);
    agent.publish({ ...conversations([row("CV-1", "1")]), ...roster("AGENT") });
    m3Only.publish(conversations([row("CV-1", "1"), row("CV-2", "2", 4283)]));
    await flush(); agent.render(); m3Only.render();
    assert.ok(!agent.text().includes("客户1"));
    assert.ok(!m3Only.text().includes("客户1"));
    assert.ok(m3Only.text().includes("客户2"));
  } finally { manager.unmount(); agent.unmount(); m3Only.unmount(); }
});

test("SUPPORT with independent supervisor scope can review while keeping another owner's composer read-only", async () => {
  const probe = harness();
  try {
    await flush(); probe.render();
    probe.publish({ ...conversations([row("CV-1", "1")]), ...roster("DEDICATED") });
    assert.ok(probe.text().includes("1 段"));
    assert.ok(!probe.text().includes("当前已无权"));
    assert.equal(probe.profileRequests.length, 1);
    assert.ok(!probe.buttons().some(button => button.label === "标记已解决"));
  } finally { probe.unmount(); }
});

test("scope invalidation aborts an old supervisor response and PERSONAL revalidation cannot expose another owner's conversation", async () => {
  const probe = harness({ deferredScope: true });
  try {
    probe.publish({ ...conversations([row("CV-1", "1")]), ...roster("DEDICATED") });
    const old = probe.scopeRequests[0];
    probe.emit({});
    assert.equal(old.signal.aborted, true);
    old.resolve({ scope: { actorId: 4283, mode: "MANAGED" } });
    await flush(); probe.render();
    assert.ok(!probe.text().includes("客户1"));
    probe.scopeRequests.at(-1).resolve({ scope: { actorId: 4283, mode: "PERSONAL" } });
    await flush(); probe.render();
    assert.ok(!probe.text().includes("客户1"));
    assert.equal(probe.profileRequests.length, 0);
  } finally { probe.unmount(); }
});

test("a failed scope read remains closed and the existing-style retry restores an authorized supervisor view", async () => {
  const probe = harness({ deferredScope: true });
  try {
    probe.publish({ ...conversations([row("CV-1", "1")]), ...roster("DEDICATED") });
    probe.scopeRequests[0].reject({ status: 503 });
    await flush(); probe.render();
    assert.ok(probe.text().includes("当前会话范围暂时无法核对"));
    assert.ok(!probe.text().includes("客户1"));
    assert.equal(probe.profileRequests.length, 0);
    probe.buttons().find(button => button.label === "重新核对范围").onClick(); probe.render();
    probe.scopeRequests.at(-1).resolve({ scope: { actorId: 4283, mode: "MANAGED" } });
    await flush(); probe.render();
    assert.ok(probe.text().includes("客户1"));
    assert.ok(!probe.text().includes("当前会话范围暂时无法核对"));
    assert.equal(probe.profileRequests.length, 1);
  } finally { probe.unmount(); }
});

function productionFunction(source, name) {
  const parsed = ts.createSourceFile("production.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing production function ${name}`);
  return declaration.getText(parsed).replace(/^export\s+/, "");
}

test("552 conversation adapter preserves per-segment zero and positive counts but keeps old or malformed fields unknown", () => {
  const client = read("lib/admin/m-client.ts");
  const adapt = new Function("conversationType", "roleKey", "asTs", "asArray", "adaptCustomerProfile", "str", "num", "conversationStatus",
    compile(productionFunction(client, "adaptConversation")) + "\nreturn adaptConversation;")(
    value => value, value => value, () => 1, value => value ?? [], () => ({}),
    (value, fallback = "") => value ?? fallback, (value, fallback) => typeof value === "number" ? value : fallback, value => value,
  );
  for (const pendingReplyCount of [0, 1, 3]) {
    const base = { conversationNo: "CV-1", userId: 7, pendingReplyCount };
    assert.equal(adapt(base).pendingReplyCount, pendingReplyCount);
    assert.equal(adapt({ conversation: base, messages: [], historyTruncated: true }).pendingReplyCount, pendingReplyCount);
  }
  for (const pendingReplyCount of [undefined, null, -1, 0.5, "0", false, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(adapt({ conversationNo: "CV-1", pendingReplyCount }).pendingReplyCount, null);
  }
});

test("the actual end confirmation, row writer and HTTP client send OPEN to RESOLVED with the original CAS, reason and stable command key", async () => {
  const view = read("app/components/domain-views/m-view.tsx"), client = read("lib/admin/m-client.ts");
  const parsed = ts.createSourceFile("chat.tsx", chatSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "M3DedicatedChat");
  const declaration = component.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(parsed) === "closeConversation");
  assert.ok(declaration, "Missing production end command");
  const exported = {}, wire = [], owner = { agentAdminId: 4285, assignmentId: "9" };
  const imports = {
    "@/lib/admin/current-operator": { currentAdminOperator: () => "4285" },
    "@/lib/store/admin-auth": { useAdminAuth: { getState: () => ({ session: session(4285) }) } },
    "@/lib/admin/m-support-read-contract": { parseMContentApiEnvelope: (_status, body) => JSON.parse(body).data },
  };
  new Function("require", "exports", "fetch", compile(client))(
    name => imports[name] ?? new Proxy({}, { get: () => () => undefined }), exported,
    async (url, init) => { wire.push({ url, init }); return new Response(JSON.stringify({ code: 0, data: { status: "RESOLVED", version: 8 } }), { status: 200 }); },
  );
  const write = new Function("useAdminAuth", "supportClient", "mContentActions", compile(
    ["addedRow", "changedRow", "writeConversationRows"].map(name => productionFunction(view, name)).join("\n"),
  ) + "\nreturn writeConversationRows;")(imports["@/lib/store/admin-auth"].useAdminAuth, { customerDetail: async () => owner }, exported.mContentActions);
  const selected = row("CV-1", "1");
  let confirmation;
  const ctx = {
    openActionConfirm(value) { confirmation = value; },
    async setParam(_key, rows, metadata) { await write([selected], JSON.parse(rows), metadata.reason, metadata.action, null, metadata.commandKey); return true; },
  };
  const close = new Function("selected", "writable", "pending", "firstPending", "checkActionReady", "identityRef", "ctx", "all", "CONVO_KEY", "setActionError",
    compile(`const ${declaration.getText(parsed)};`) + "\nreturn closeConversation;")(
    selected, true, null, null, async () => true, { current: "current" }, ctx, [selected], "I.session.convos", error => { throw new Error(error); },
  );
  await close(); assert.ok(confirmation);
  const reason = "客户问题已经处理完毕";
  assert.equal(await confirmation.run(reason), true);
  assert.equal(await confirmation.run(reason), true);
  assert.equal(wire.length, 2);
  for (const request of wire) {
    assert.equal(request.url, "/api/admin/content/conversations/CV-1/status");
    assert.equal(request.init.method, "PATCH");
    assert.deepEqual(JSON.parse(request.init.body), { status: "RESOLVED", expectedStatus: "OPEN", expectedVersion: 7, operator: "4285", reason });
    assert.equal(request.init.headers.get("Idempotency-Key"), "m3:close:CV-1:7");
  }
});
