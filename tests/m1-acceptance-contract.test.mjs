import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("M1 live workbench reaches the original seat form without widening its authority or write contract", async () => {
  const ts = createRequire(resolve(root, "package.json"))("typescript");
  let auth;
  let activeHooks;
  const useAdminAuth = (selector) => selector(auth);
  useAdminAuth.getState = () => auth;
  const no = () => {};
  const unavailable = () => { throw new Error("This component check cannot call an API or browser"); };
  const jsx = (type, props, key) => ({ type, props, key });
  const react = {
    useState: (initial) => activeHooks.useState(initial), useEffect: (effect, deps) => activeHooks.useEffect(effect, deps),
    useMemo: (factory) => factory(), useCallback: (callback) => callback,
    useRef: (initial) => activeHooks.useRef(initial),
  };
  const imports = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "next/link": { default: "a" }, "next/navigation": { useRouter: () => ({ push: unavailable }) },
    "lucide-react": new Proxy({}, { get: () => no }),
    "@/lib/store/admin-auth": { useAdminAuth },
    "@/lib/admin/error-messages": { displayAdminError: () => "读取失败" },
    "@/lib/admin/m-client": { fetchMAdvisorBindingUsers: unavailable, fetchMRecentAdvisorConversations: unavailable },
    "@/lib/admin/m1-pending-command": {},
    "@/lib/admin/pending-mutation-store": { createPendingMutationStore: () => ({ list: () => [], get: () => null }) },
    "@/lib/admin/business-time": { parseBusinessTime: Date.parse },
    "@/lib/admin/shell-authorities": { adminShellSessionKey: unavailable },
    "@/lib/admin/m-support-client": { supportClient: new Proxy({}, { get: () => unavailable }), SupportClientError: Error, isIndeterminateSupportError: () => false },
    "../design-kit": { Icon: no, Modal: no, Toggle: no }, "./hd-ui": { MAvatar: no, catCN: no },
    "./m1-supervisor-pool": { M1SupervisorPool: no }, "./support-bulk-composer": { SupportBulkComposer: no },
    "./support-avatar": { SupportAvatar: no, advisorAvatarPath: no, customerAvatarPath: no },
  };
  function load(file) {
    const module = { exports: {} };
    const compiled = ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    runInNewContext(compiled, { module, exports: module.exports, require: (id) => {
      if (id.endsWith(".css")) return {};
      assert.ok(Object.hasOwn(imports, id), `Unexpected runtime dependency: ${id}`);
      return imports[id];
    } });
    return module.exports;
  }
  const overview = load("app/components/domain-views/m-tabs/m1-overview.tsx");
  imports["./m1-overview"] = overview;
  const { M1PersonalWorkbench } = load("app/components/domain-views/m-tabs/m1-personal-workbench.tsx");
  const view = read("app/components/domain-views/m-view.tsx");
  assert.match(view, /tab === "M1" && <M1PersonalWorkbench[^>]*permission=\{permission\}[^>]*ctx=\{ctx\}/);
  assert.match(view, /setParam: runMWrite/);
  function mount(Component, props, { runEffects = false } = {}) {
    const values = [];
    const effects = [];
    let cursor, pendingEffects, changed, unmounted = false, updatesAfterUnmount = 0;
    const hooks = { useState(initial) {
      const slot = cursor++;
      if (!(slot in values)) values[slot] = typeof initial === "function" ? initial() : initial;
      return [values[slot], (next) => {
        if (unmounted) { updatesAfterUnmount++; return; }
        const value = typeof next === "function" ? next(values[slot]) : next;
        if (!Object.is(value, values[slot])) { values[slot] = value; changed = true; }
      }];
    }, useRef(initial) {
      const slot = cursor++;
      if (!(slot in values)) values[slot] = { current: initial };
      return values[slot];
    }, useEffect(effect, deps) {
      const slot = cursor++;
      if (!runEffects) return;
      const previous = effects[slot];
      if (!previous || !deps || deps.length !== previous.deps?.length || deps.some((dep, index) => !Object.is(dep, previous.deps[index]))) {
        pendingEffects.push(() => { previous?.cleanup?.(); effects[slot] = { deps, cleanup: effect() }; });
      }
    } };
    return {
      props,
      get updatesAfterUnmount() { return updatesAfterUnmount; },
      render() {
        assert.equal(unmounted, false, "Cannot render an unmounted component");
        for (let pass = 0; pass < 10; pass++) {
          cursor = 0; pendingEffects = []; changed = false; activeHooks = hooks;
          const tree = Component(props);
          pendingEffects.forEach((effect) => effect());
          if (!changed) return tree;
        }
        assert.fail("Component effects did not settle");
      },
      unmount() { unmounted = true; effects.forEach((effect) => effect?.cleanup?.()); },
    };
  }
  function nodes(value) {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== "object") return [];
    return [value, ...nodes(value.props?.children), ...nodes(value.props?.footer)];
  }
  function text(value) {
    if (Array.isArray(value)) return value.map(text).join("");
    if (value && typeof value === "object") return text(value.props?.children);
    return value === null || value === undefined || typeof value === "boolean" ? "" : String(value);
  }
  const button = (tree, label) => nodes(tree).find((node) => node.type === "button" && text(node) === label);
  const seat = (adminId, seatType = "GENERAL", enabled = true) => ({ id: String(adminId), adminId, name: `客服${adminId}`, email: "", adminRole: "SUPPORT", status: "enabled", seatType, position: seatType === "MANAGER" ? "客服主管" : "通用客服", serviceTypes: ["support"], tags: [], enabled, busy: false, transferable: true, assignedUserCount: 0, maxConcurrent: 8, version: 7 });
  const agents = [seat(4283, "MANAGER"), seat(4284), seat(4285, "GENERAL", false)];
  const params = { "I.support.agents": JSON.stringify(agents), "I.support.agentsAvailable": "1", "I.support.agentsError": "none", "I.support.advisorAssignments": "[]" };
  const writes = [];
  let confirmed = false;
  const ctx = { params, pget: (key) => params[key], toast: no, setParam: async (key, value, meta) => { writes.push({ key, payload: JSON.parse(value), meta: JSON.parse(JSON.stringify(meta)) }); return confirmed; } };
  const identity = (role, adminId, authorities = ["service_m1_write"]) => { auth = { role, operator: "业务验收管理员", authEpoch: 1, session: { role, adminId, authorities } }; };

  identity("superadmin", 4282);
  const workbench = mount(M1PersonalWorkbench, { permission: "superadmin", ctx });
  let tree = workbench.render();
  const entry = button(tree, "分配坐席");
  assert.ok(entry, "Seat assignment must be reachable from the active M1 workbench");
  assert.equal(entry.props.disabled, false);
  for (const label of ["工作台", "我的客户", "圈选群发", "待绑定客户池"]) assert.ok(button(tree, label), `Existing ${label} entry was lost`);
  entry.props.onClick();
  tree = workbench.render();
  const mountedModal = nodes(tree).find((node) => node.type === overview.SupportSeatRoleModal);
  assert.equal(typeof overview.SupportSeatRoleModal, "function");
  assert.ok(mountedModal, "The entry must open the existing versioned seat form");
  assert.equal(mountedModal.props.ctx, ctx);
  assert.equal(mountedModal.props.currentAdminId, 4282);
  assert.equal(mountedModal.props.agents.length, 2, "Disabled agents cannot enter the form candidates");
  const form = mount(overview.SupportSeatRoleModal, mountedModal.props, { runEffects: true });
  let formTree = form.render();
  assert.equal(nodes(formTree).find((node) => node.props?.["data-proof"] === "m1-seat-role-save").props.disabled, true, "A seat mutation must require an audit reason");
  nodes(formTree).find((node) => node.props?.["data-proof"] === "m1-seat-admin-option" && String(node.key) === "4284").props.onClick();
  nodes(formTree).find((node) => node.type === "textarea").props.onChange({ target: { value: "真实业务测试调整客服坐席" } });
  formTree = form.render();
  let save = nodes(formTree).find((node) => node.props?.["data-proof"] === "m1-seat-role-save");
  assert.equal(save.props.disabled, false);
  await save.props.onClick();
  assert.equal(nodes(workbench.render()).some((node) => node.type === overview.SupportSeatRoleModal), true, "An unconfirmed write cannot close the original form");
  confirmed = true;
  save = nodes(form.render()).find((node) => node.props?.["data-proof"] === "m1-seat-role-save");
  await save.props.onClick();
  assert.deepEqual(writes[0], { key: "I.support.seatAssignment.__update", payload: { adminId: 4284, position: "通用客服", expectedVersion: 7, userIds: [] }, meta: { action: "M1 分配客服坐席", reason: "真实业务测试调整客服坐席" } });
  assert.equal(JSON.stringify(writes[1]), JSON.stringify(writes[0]), "Retry must preserve the original version, reason and target");
  assert.equal(nodes(workbench.render()).some((node) => node.type === overview.SupportSeatRoleModal), false);
  form.unmount();

  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
  };
  const pending = deferred();
  const pendingWrites = [], pendingToasts = [];
  const pendingCtx = { ...ctx, toast: (message) => pendingToasts.push(message), setParam: (key, value, meta) => {
    pendingWrites.push({ key, payload: JSON.parse(value), meta: JSON.parse(JSON.stringify(meta)) });
    return pending.promise;
  } };
  button(workbench.render(), "分配坐席").props.onClick();
  const pendingModal = nodes(workbench.render()).find((node) => node.type === overview.SupportSeatRoleModal);
  const pendingForm = mount(overview.SupportSeatRoleModal, { ...pendingModal.props, ctx: pendingCtx }, { runEffects: true });
  let pendingTree = pendingForm.render();
  nodes(pendingTree).find((node) => node.props?.["data-proof"] === "m1-seat-admin-option" && String(node.key) === "4284").props.onClick();
  nodes(pendingTree).find((node) => node.type === "textarea").props.onChange({ target: { value: "真实业务测试调整客服坐席" } });
  pendingTree = pendingForm.render();
  const pendingSave = nodes(pendingTree).find((node) => node.props?.["data-proof"] === "m1-seat-role-save");
  const staleCancel = button(pendingTree, "取消");
  const staleClose = pendingTree.props.onClose;
  const firstSubmit = pendingSave.props.onClick();
  pendingTree = pendingForm.render();
  assert.equal(pendingTree.props.busy, true, "A pending seat write must use the shared close guard");
  assert.equal(button(pendingTree, "取消").props.disabled, true, "Cancel must be disabled while saving");
  assert.equal(nodes(pendingTree).find((node) => node.props?.["data-proof"] === "m1-seat-role-save").props.disabled, true);
  const duplicateSubmit = pendingSave.props.onClick();
  assert.equal(pendingWrites.length, 1, "The pre-render save callback cannot submit twice");
  staleCancel.props.onClick(); staleClose(); pendingTree.props.onClose(); button(pendingTree, "取消").props.onClick();
  assert.equal(nodes(workbench.render()).some((node) => node.type === overview.SupportSeatRoleModal), true, "Pending close and stale cancel callbacks cannot unmount the form");
  pending.resolve(false);
  await Promise.all([firstSubmit, duplicateSubmit]);
  pendingTree = pendingForm.render();
  assert.equal(pendingTree.props.busy, false);
  assert.equal(button(pendingTree, "取消").props.disabled, false, "An unconfirmed result must release the waiting guard");
  assert.deepEqual(pendingWrites[0], writes[0], "Waiting must preserve the original version, reason and target");
  assert.equal(pendingToasts.length, 0);
  button(pendingTree, "取消").props.onClick();
  assert.equal(nodes(workbench.render()).some((node) => node.type === overview.SupportSeatRoleModal), false, "Cancel must still work when no request is pending");
  pendingForm.unmount();

  for (const outcome of ["success", "failure"]) {
    const late = deferred(), lateWrites = [], lateToasts = [];
    const lateCtx = { ...ctx, toast: (message) => lateToasts.push(message), setParam: (...args) => { lateWrites.push(args); return late.promise; } };
    button(workbench.render(), "分配坐席").props.onClick();
    const oldModal = nodes(workbench.render()).find((node) => node.type === overview.SupportSeatRoleModal);
    const oldForm = mount(overview.SupportSeatRoleModal, { ...oldModal.props, ctx: lateCtx }, { runEffects: true });
    let oldTree = oldForm.render();
    nodes(oldTree).find((node) => node.type === "textarea").props.onChange({ target: { value: "即将切换页面前的坐席分配" } });
    oldTree = oldForm.render();
    const oldSave = nodes(oldTree).find((node) => node.props?.["data-proof"] === "m1-seat-role-save");
    const oldSubmit = oldSave.props.onClick();
    // A parent route/identity change can unmount a busy form independently of its close controls.
    oldForm.unmount(); oldModal.props.onClose();
    button(workbench.render(), "分配坐席").props.onClick();
    const newModal = nodes(workbench.render()).find((node) => node.type === overview.SupportSeatRoleModal);
    const newForm = mount(overview.SupportSeatRoleModal, newModal.props, { runEffects: true });
    const newTree = newForm.render();
    nodes(newTree).find((node) => node.props?.["data-proof"] === "m1-seat-admin-option" && String(node.key) === "4284").props.onClick();
    nodes(newTree).find((node) => node.type === "button" && text(node).startsWith("客服主管")).props.onClick();
    nodes(newTree).find((node) => node.type === "textarea").props.onChange({ target: { value: "重新打开后保留本次选择与理由" } });
    if (outcome === "success") late.resolve(true); else late.reject(new Error("Delayed seat write failure"));
    await oldSubmit;
    assert.equal(nodes(workbench.render()).some((node) => node.type === overview.SupportSeatRoleModal), true, "An unmounted request cannot close a reopened form");
    const reopenedTree = newForm.render();
    assert.equal(nodes(reopenedTree).find((node) => node.type === "textarea").props.value, "重新打开后保留本次选择与理由");
    assert.ok(nodes(reopenedTree).some((node) => node.type === "div" && text(node) === "当前选择: 客服4284"));
    assert.ok(nodes(reopenedTree).some((node) => node.type === "div" && text(node) === "当前坐席 通用客服 → 目标坐席 客服主管"));
    assert.equal(lateToasts.length, 0, "An unmounted request cannot show a stale result");
    assert.equal(oldForm.updatesAfterUnmount, 0, "Late results cannot update the unmounted form");
    await oldSave.props.onClick();
    oldTree.props.onClose();
    assert.equal(lateWrites.length, 1, "A callback from the unmounted form cannot start another write");
    assert.equal(nodes(workbench.render()).some((node) => node.type === overview.SupportSeatRoleModal), true);
    button(newForm.render(), "取消").props.onClick(); newForm.unmount();
  }

  identity("support", 4283);
  const supervisor = mount(M1PersonalWorkbench, { permission: "supervisor", ctx });
  button(supervisor.render(), "分配坐席").props.onClick();
  const supervisorModal = nodes(supervisor.render()).find((node) => node.type === overview.SupportSeatRoleModal);
  const supervisorForm = mount(overview.SupportSeatRoleModal, supervisorModal.props, { runEffects: true }).render();
  assert.equal(nodes(supervisorForm).filter((node) => node.type === "button").some((node) => text(node).startsWith("客服主管")), false, "Supervisor cannot grant supervisor seats");
  assert.equal(nodes(supervisorForm).some((node) => node.props?.["data-proof"] === "m1-seat-admin-option" && String(node.key) === "4283"), false, "Supervisor cannot reassign their own seat");
  identity("support", 4284);
  assert.equal(button(mount(M1PersonalWorkbench, { permission: "agent", ctx }).render(), "分配坐席"), undefined);
  identity("support", 4283, []);
  assert.equal(button(mount(M1PersonalWorkbench, { permission: "supervisor", ctx }).render(), "分配坐席").props.disabled, true, "Missing M1 authority must close the entry");
  identity("superadmin", 4282);
  params["I.support.agentsAvailable"] = "0";
  for (const error of ["none", "unavailable"]) {
    params["I.support.agentsError"] = error;
    const blocked = mount(M1PersonalWorkbench, { permission: "superadmin", ctx });
    const blockedEntry = button(blocked.render(), "分配坐席");
    assert.equal(blockedEntry.props.disabled, true);
    blockedEntry.props.onClick();
    assert.equal(nodes(blocked.render()).some((node) => node.type === overview.SupportSeatRoleModal), false, "Unavailable roster must not open a stale form");
  }
});

test("M1 explains its read and write boundary and deep-links KPI cards to matching queues", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");
  const view = read("app/components/domain-views/m-view.tsx");
  const registry = read("lib/admin/registry/m.ts");

  assert.doesNotMatch(overview, /只看不改/);
  assert.doesNotMatch(registry, /只看不改/);
  assert.match(view, /本人客户与待办 · 主管可处理待绑定客户/);
  assert.match(overview, /\/service\/tickets\?scope=active&status=pending_user/);
  assert.match(overview, /\/service\/sessions\?seg=unread/);
  assert.match(overview, /只有总管理员或客服主管能调整坐席与负载策略/);
});

test("M1 SLA health is time based and unmatched work remains visible", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");

  assert.match(overview, /firstResponseMins/);
  assert.match(overview, /resolutionHours/);
  assert.match(overview, /unassignedLoadCount/);
  assert.doesNotMatch(overview, /priority === "urgent"[\s\S]{0,120}105/);
});

test("M1 mutations require the dedicated authority and load config preserves backend agent state", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");
  const client = read("lib/admin/m-client.ts");

  assert.match(overview, /service_m1_write/);
  assert.match(client, /raw\.agentState/);
});

test("M1 keeps usable sections visible when a sibling M endpoint fails", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");
  const client = read("lib/admin/m-client.ts");

  assert.match(client, /const tasks = \[ticketsTask, conversationsTask, m1Task/);
  assert.match(client, /await Promise\.all\(tasks\)/);
  assert.match(client, /loadWarnings/);
  assert.match(overview, /部分信息暂未同步/);
});

test("M1 renders an in-flight roster read as status, never as a false failure alert", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");

  assert.match(overview, /const supportAgentsPending = !supportAgentsAvailable && supportAgentsError === "none"/);
  assert.match(overview, /supportAgentsPending && \([\s\S]*?role="status"[\s\S]*?坐席数据正在同步/);
  assert.match(overview, /!supportAgentsAvailable && !supportAgentsPending && \([\s\S]*?role="alert"/);
  assert.doesNotMatch(
    overview,
    /!supportAgentsAvailable && \([\s\S]*?role="alert"/,
    "pending and failed roster states must not share the same alert branch",
  );
});

test("M1 writes await the real result and reuse the same idempotency key after an unknown outcome", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");
  const view = read("app/components/domain-views/m-view.tsx");
  const client = read("lib/admin/m-client.ts");

  assert.match(overview, /const ok = await ctx\.setParam\("I\.support\.load\.__bulk"/);
  assert.match(overview, /const ok = await ctx\.setParam\("I\.support\.seatAssignment\.__update"/);
  assert.match(overview, /const ok = await ctx\.setParam\("I\.support\.advisorAssignment\.__create"/);
  assert.match(overview, /const ok = await ctx\.setParam\("I\.support\.advisorAssignment\.__delete"/);
  assert.match(overview, /if \(!ok\)[\s\S]{0,240}return;/);
  assert.match(overview, /结果未知[\s\S]{0,240}保留/);
  assert.match(view, /updateLoadConfig\(payload, reason, idempotencyKey\)/);
  assert.match(view, /rebalanceLoad\(payload\.rows, payload\.expectedVersion!, reason, idempotencyKey\)/);
  assert.match(view, /Number\.isSafeInteger\(payload\.expectedVersion\)/);
  assert.doesNotMatch(view, /rebalanceLoad\([^;]+data\.loadConfig\.version/);
  assert.match(view, /assignSupportSeat\([^;]+reason, idempotencyKey\)/);
  assert.match(view, /assignAdvisorUsers\([^;]+reason, idempotencyKey\)/);
  assert.match(view, /deactivateAdvisorAssignment\([^;]+reason, idempotencyKey\)/);
  assert.match(client, /updateLoadConfig\(payload: MLoadConfigWrite, reason: string, idempotencyKey\?: string\)/);
  assert.match(client, /rebalanceLoad\(agents: Array<Record<string, unknown>>, expectedVersion: number, reason: string, idempotencyKey\?: string\)/);
  assert.match(client, /headers: idempotencyKey \? \{ "Idempotency-Key": idempotencyKey \} : undefined/);
});

test("M1 load writes carry a visible-snapshot version and enforce the 8-200 audit reason boundary", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");
  const view = read("app/components/domain-views/m-view.tsx");
  const client = read("lib/admin/m-client.ts");
  const updateRequest = read("../nexion-backend/src/main/java/ffdd/opsconsole/content/dto/SupportLoadConfigUpdateRequest.java");
  const rebalanceRequest = read("../nexion-backend/src/main/java/ffdd/opsconsole/content/dto/SupportLoadRebalanceRequest.java");
  const service = read("../nexion-backend/src/main/java/ffdd/opsconsole/content/application/OpsSupportTicketService.java");

  assert.match(overview, /reason\.trim\(\)\.length >= 8[\s\S]{0,80}reason\.trim\(\)\.length <= 200/);
  assert.match(overview, /maxLength=\{200\}/);
  assert.match(client, /version: loadNumber\(loadRaw, "version"\)/);
  assert.match(view, /expectedVersion: version/);
  assert.match(updateRequest, /Long expectedVersion/);
  assert.match(rebalanceRequest, /Long expectedVersion/);
  assert.match(service, /activeValueForUpdate\(LOAD_VERSION_KEY\)/);
  assert.match(service, /SUPPORT_LOAD_VERSION_CONFLICT/);
  assert.match(service, /auditLogService\.recordRequired/);
});

test("M1 KPI links match their target queues and conversation detail failures fail closed", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");
  const client = read("lib/admin/m-client.ts");
  const chat = read("app/components/domain-views/m-tabs/m3-dedicated-chat.tsx");

  assert.match(overview, /ACTIVE_TICKET_STATUSES\.has\(t\.status\)/);
  assert.match(overview, /c\.unread > 0/);
  assert.match(client, /const conversationsTask =/);
  assert.match(client, /page\.records\.map\(adaptConversation\)/);
  assert.match(client, /export async function fetchMConversationDetail/);
  assert.match(chat, /selected\.detailReady === true/);
  assert.match(chat, /会话详情读取失败/);
  assert.match(client, /publish\(\{ conversations: \[\], conversationsAvailable: false \}, warning\)/);
  assert.match(client, /publish\(\{ conversations: page\.records\.map\(adaptConversation\), conversationsAvailable: true \}\)/);
  assert.doesNotMatch(client, /async function detailOrRow/);
});
