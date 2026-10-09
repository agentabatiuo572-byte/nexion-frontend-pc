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
    "@/lib/nav/console-nav": { resolveVisibleDomains: session => session, canAccessResolvedPath: session => session.menuCodes?.includes("A1") === true },
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
    // Seat-form boundaries remain under test here; the avatar child has its own real producer/recovery tests.
    "./self-avatar-editor": { SelfAvatarEditor: no },
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
  assert.match(view, /tab === "M1" && <M1AnalyticsWorkbench[^>]*permission=\{permission\}[^>]*ctx=\{ctx\}/);
  const analytics = read("app/components/domain-views/m-tabs/m1-analytics-workbench.tsx");
  assert.match(analytics, /const isPersonal = scope\?\.scopeSummary.mode === "PERSONAL"/);
  assert.match(analytics, /const mode = scope.scopeSummary.mode/);
  assert.match(analytics, /\{isPersonal &&[\s\S]*?<M1PersonalWorkbench permission="agent" ctx=\{ctx\}/);
  assert.match(analytics, /\{operations &&[\s\S]*?<M1PersonalWorkbench permission=\{mode === "ALL" \? "superadmin" : "supervisor"\} ctx=\{ctx\}/);
  assert.equal([...analytics.matchAll(/<M1PersonalWorkbench\b/g)].length, 2, "Both personal and scope-derived operations entries remain present");
  assert.doesNotMatch(analytics, /<M1PersonalWorkbench[^>]*permission=\{permission\}/, "Legacy seat-derived permission must not override current server scope");
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
  const identity = (role, adminId, authorities = ["service_m1_write"]) => { auth = { role, operator: "业务验收管理员", authEpoch: 1, session: { role, adminId, authorities: role === "superadmin" ? [...authorities, "platform_a1_read"] : authorities, menuCodes: role === "superadmin" ? ["A1"] : ["M1"] } }; };

  for (const [role, permission] of [["superadmin", "superadmin"], ["support", "supervisor"]]) {
    identity(role, 4282);
    const workbench = mount(M1PersonalWorkbench, { permission, ctx });
    const tree = workbench.render();
    for (const label of ["工作台", "我的客户", "圈选群发", "待绑定客户池"]) assert.ok(button(tree, label), label);
    const entry = button(tree, "客服资格"); assert.ok(entry); entry.props.onClick();
    const modal = nodes(workbench.render()).find(node => node.type === overview.SupportSeatRoleModal); assert.ok(modal);
    const form = mount(overview.SupportSeatRoleModal, modal.props).render();
    assert.equal(nodes(form).some(node => node.props?.href === "/platform/rbac"), role === "superadmin");
    assert.equal(nodes(form).some(node => ["input", "select", "textarea"].includes(node.type)), false);
    assert.equal(button(form, "确认分配"), undefined);
    button(form, "关闭").props.onClick();
    assert.equal(nodes(workbench.render()).some(node => node.type === overview.SupportSeatRoleModal), false);
    assert.equal(writes.length, 0, "noLegacyDispatch: M1 must never derive qualifications from a legacy seat edit");
  }
  for (const config of [{ role: "superadmin", authorities: [], menuCodes: ["A1"], canManage: true }, { role: "superadmin", authorities: ["platform_a1_read"], menuCodes: [], canManage: true }, { role: "superadmin", authorities: ["platform_a1_read"], menuCodes: ["A1"], canManage: false }, { role: "support", authorities: ["platform_a1_read"], menuCodes: ["A1"], canManage: true }]) {
    auth = { authEpoch: 1, session: { adminId: 4282, role: config.role, authorities: config.authorities, menuCodes: config.menuCodes } };
    const form = mount(overview.SupportSeatRoleModal, { ctx, operatorName: "客服", currentRole: config.role, currentAdminId: 4282, agents, canManage: config.canManage, onClose: no }).render();
    assert.equal(nodes(form).some(node => node.props?.href === "/platform/rbac"), false, "A1 entry needs current true-super role, A1 read, resolved path and caller authorization");
    assert.ok(button(form, "关闭")); assert.match(text(form), /由总管理员/); assert.equal(writes.length, 0, "noLegacyDispatch");
  }
  identity("support", 4284, []);
  const ordinary = mount(M1PersonalWorkbench, { permission: "agent", ctx });
  assert.equal(button(ordinary.render(), "客服资格"), undefined);
  assert.equal(writes.length, 0);

});

test("M1 explains its read and write boundary and deep-links KPI cards to matching queues", () => {
  const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");
  const view = read("app/components/domain-views/m-view.tsx");
  const registry = read("lib/admin/registry/m.ts");

  assert.doesNotMatch(overview, /只看不改/);
  assert.doesNotMatch(registry, /只看不改/);
  assert.match(view, /按当前授权范围查看客户与分组数据/);
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
  assert.doesNotMatch(overview, /ctx\.setParam\("I\.support\.seatAssignment\.__update"/);
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
