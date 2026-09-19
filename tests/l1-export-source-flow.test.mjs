import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as kpiContract from "../app/components/domain-views/l-tabs/l1-kpi-contract.ts";
import * as liveTotals from "../app/components/domain-views/l-tabs/l1-l2-live-data.ts";
import * as exportContract from "../app/components/domain-views/l-tabs/l1-export-contract.ts";
import * as requestController from "../app/components/domain-views/l-tabs/l1-request-generation.ts";
import * as attribution from "../app/components/domain-views/l-tabs/l-attribution-routes.ts";
import { displayAdminError } from "../lib/admin/error-messages.ts";

const element = (type, props) => ({ type, props });
test("server export failures distinguish missing metrics from malformed data in operator copy", () => {
  assert.match(displayAdminError(new Error("L1_EXPORT_NO_AVAILABLE_KPI")), /没有可用 KPI.*未生成报表/);
  assert.match(displayAdminError(new Error("L1_EXPORT_DATA_INVALID")), /格式异常.*未生成报表/);
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const text = node => Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : node == null ? "" : String(node);
function find(node, predicate) {
  if (!node || typeof node !== "object") return undefined;
  // A function `type` is a component the renderer has not expanded yet (the harness only
  // invokes the page component itself). Expand it the way React would, so a wrapper such as
  // TabGroup — whose children are a render prop — is reachable from a tree walk.
  if (typeof node.type === "function") {
    if (predicate(node)) return node;
    return find(node.type(node.props), predicate);
  }
  if (predicate(node)) return node;
  for (const child of Array.isArray(node) ? node : [node.props?.children]) { const found = find(child, predicate); if (found) return found; }
}

// Execute the real component functions, hooks' updates, effects and event handlers.
// Presentation children remain opaque; API reads are controlled promises with no network writes.
function harness(dependencies = {}) {
  const slots = [], pending = []; let index = 0;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, at) => !Object.is(value, b[at]));
  const react = {
    useState(initial) { const at = index++; if (!slots[at]) slots[at] = { value: typeof initial === "function" ? initial() : initial }; return [slots[at].value, next => { slots[at].value = typeof next === "function" ? next(slots[at].value) : next; }]; },
    useRef(initial) { const at = index++; return slots[at] ??= { current: initial }; },
    useEffect(effect, deps) { const at = index++; if (changed(slots[at]?.deps, deps)) { const previous = slots[at]; slots[at] = { deps }; pending.push(() => { previous?.cleanup?.(); slots[at].cleanup = effect(); }); } },
    useMemo(factory, deps) { const at = index++; if (changed(slots[at]?.deps, deps)) slots[at] = { deps, value: factory() }; return slots[at].value; },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
  };
  function load(file) {
    const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    new Function("require", "exports", "module", "window", output)(name => {
      if (dependencies[name]) return dependencies[name];
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "fragment" };
      if (name === "./live-data") return load("../app/components/domain-views/l-tabs/live-data.tsx");
      // TabGroup is a presentation-only semantic wrapper (role=tablist/tab + roving tabindex).
      // The harness renders presentation children as opaque elements, so give it the same
      // button structure the real component produces: the flow under test picks a window by
      // finding a button whose text is the label, then calling its onClick.
      if (name.endsWith("kit/tab-group")) {
        // The harness renders presentation children as opaque elements and calls component
        // functions directly, so the stub must be a plain function returning the same button
        // structure the real component produces (a <button> whose text is the label).
        return {
          TabGroup: (props) => {
            const { items, value, onSelect, children, className, label, labelClassName } = props;
            const buttons = items.map(item => element("button", {
              type: "button",
              role: "tab",
              "aria-selected": item === value,
              onClick: () => onSelect(item),
              children: children(item, item === value),
            }));
            return element("div", {
              className,
              role: "tablist",
              children: labelClassName !== undefined && label ? [element("span", { className: labelClassName, children: label }), ...buttons] : buttons,
            });
          },
        };
      }
      if (name.endsWith("l1-kpi-contract")) return kpiContract;
      if (name.endsWith("l1-l2-live-data")) return liveTotals;
      if (name.endsWith("l1-export-contract")) return exportContract;
      if (name.endsWith("l1-request-generation")) return requestController;
      if (name.endsWith("l-attribution-routes")) return attribution;
      if (name.endsWith("error-messages")) return { displayAdminError: error => error.message ?? String(error), formatAdminApiError: value => value };
      return {};
    }, exports, { exports }, dependencies.window);
    return exports;
  }
  return {
    load,
    render(component, props) { index = 0; const tree = component(props); while (pending.length) pending.shift()(); return tree; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

function dashboard(value = 70) {
  const kpis = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, kpiId: String(i + 1), name: `KPI ${i + 1}`,
    target: 60, dir: "gte", unit: "%", available: value !== null, value, numerator: value === null ? 0 : 7, denominator: value === null ? 0 : 10, spark: [] }));
  return { module: "L1", kpis, weeks: ["W1", "W2", "W3", "W4", "W5", "W6"], currentPhase: { code: "P6", month: 11 },
    kpiPlain: Object.fromEntries(kpis.map(row => [String(row.n), row.name])),
    kpiExt: Object.fromEntries(kpis.map(row => [String(row.n), { fx: row.name, fxBold: [], num: "7", den: "10", delta: "0", note: "Selected", jump: [] }])),
  };
}

function kpiFlow(saved) {
  const reads = [], exports = []; let source;
  const runtime = harness({
    window: saved ? { localStorage: {} } : undefined,
    "./l1-local-view": { loadL1LocalView: () => saved },
    "@/lib/admin/l-client": { fetchL1Kpi: query => { const request = deferred(); reads.push({ query, ...request }); return request.promise; } },
  });
  const components = runtime.load("../app/components/domain-views/l-tabs/l1-kpi.tsx");
  const ctx = { biData: { l1: dashboard() }, biLoading: false, biError: null, canExport: true, toast() {}, biActions: { createReport: async input => exports.push(input) } };
  const render = () => runtime.render(components.L1Kpi, { ctx, onExportSource: next => { source = next; } });
  const header = () => find(components.L1HeaderActions({ ctx, source }), node => node.type === "button");
  const choose = label => { const button = find(render(), node => node.type === "button" && text(node) === label); assert.ok(button, label); button.props.onClick(); };
  return { reads, exports, runtime, ctx, render, header, choose, source: () => source };
}

test("L1 export stays disabled during refresh and exports only the latest accepted query", async () => {
  const flow = kpiFlow(); flow.render();
  flow.choose("滚动 30d"); await settle();
  assert.equal(flow.header().props.disabled, true);
  await flow.header().props.onClick(); assert.equal(flow.exports.length, 0);
  flow.choose("当日"); await settle();
  assert.deepEqual(flow.reads.map(row => row.query.window), ["30d", "1d"]);
  flow.reads[1].resolve(dashboard(81)); await settle(); flow.render();
  flow.reads[0].resolve(dashboard(12)); await settle(); flow.render();
  assert.equal(flow.source().data.kpis[0].value, 81);
  assert.equal(flow.header().props.disabled, false);
  await flow.header().props.onClick();
  assert.equal(flow.exports.length, 1);
  assert.equal(flow.exports[0].window, "1d");
});

test("L1 failed or malformed refresh keeps export disabled; a later successful read restores it", async () => {
  const flow = kpiFlow(); flow.render();
  flow.choose("滚动 30d"); await settle(); flow.reads[0].reject(new Error("SERVICE_UNAVAILABLE")); await settle(); flow.render();
  assert.equal(flow.header().props.disabled, true); assert.match(flow.header().props.title, /读取失败/);
  await flow.header().props.onClick(); assert.equal(flow.exports.length, 0);
  flow.choose("当日"); await settle(); flow.reads[1].resolve({ module: "L1", kpis: [] }); await settle(); flow.render();
  assert.equal(flow.header().props.disabled, true);
  flow.choose("滚动 7d"); await settle(); flow.reads[2].resolve(dashboard()); await settle(); flow.render();
  assert.equal(flow.header().props.disabled, false);
  flow.ctx.canExport = false;
  await flow.header().props.onClick(); assert.equal(flow.exports.length, 0);
});

test("L1 parent replacement and unmount invalidate old local reads", async () => {
  const flow = kpiFlow(); flow.render(); flow.choose("滚动 30d"); await settle();
  flow.ctx.biData = { l1: dashboard(null) }; flow.render();
  flow.reads[0].resolve(dashboard(90)); await settle(); flow.render();
  assert.equal(flow.source().data.kpis[0].value, null);
  assert.equal(flow.header().props.disabled, true);
  flow.choose("当日"); await settle(); const lastSource = flow.source(); flow.runtime.unmount();
  flow.reads.at(-1).resolve(dashboard(90)); await settle();
  assert.equal(flow.source(), lastSource);
});

test("parent reload re-reads the selected window before allowing export instead of silently using default data", async () => {
  const flow = kpiFlow(); flow.render(); flow.choose("滚动 30d"); await settle();
  flow.reads[0].resolve(dashboard(81)); await settle(); flow.render();
  flow.ctx.biData = { l1: dashboard(12) }; flow.render(); await settle();
  assert.equal(flow.header().props.disabled, true);
  const duringRefresh = text(flow.render());
  assert.match(duringRefresh, /81/);
  assert.doesNotMatch(duringRefresh, /12%/);
  assert.equal(flow.reads[1].query.window, "30d");
  flow.reads[1].resolve(dashboard(82)); await settle(); flow.render();
  await flow.header().props.onClick();
  assert.equal(flow.exports[0].window, "30d");
  assert.equal(flow.source().data.kpis[0].value, 82);
});

test("restored selection never renders the initial default window while its own read is pending", async () => {
  const flow = kpiFlow({ window: "30d", customFrom: "", customTo: "", gran: "week", phaseOn: true, ylOffset: 10,
    ovlSel: [1], cohortFilter: "2026-W36", phaseFilter: "P2", localeFilter: "vi", refFilter: "ref-one" });
  flow.render(); await settle();
  const waiting = flow.render();
  assert.equal(waiting.props.label, "L1");
  assert.equal(waiting.props.ctx.biLoading, true);
  assert.equal(flow.header().props.disabled, true);
  flow.ctx.biData = { l1: dashboard(12) }; flow.render(); await settle();
  assert.equal(flow.reads.length, 2);
  assert.deepEqual(flow.reads[0].query, flow.reads[1].query);
  flow.reads[0].resolve(dashboard(91)); await settle(); flow.render();
  assert.equal(flow.header().props.disabled, true);
  flow.reads[1].resolve(dashboard(82)); await settle(); flow.render();
  await flow.header().props.onClick();
  assert.equal(flow.exports[0].window, "30d"); assert.equal(flow.exports[0].cohort, "2026-W36");
  assert.equal(flow.source().data.kpis[0].value, 82);
});

test("all selected L1 filters reach the report input without client KPI values", async () => {
  const inputs = [], query = { window: "custom", from: "2026-09-01", to: "2026-09-07", cohort: "2026-W36", phase: "P2", locale: "vi", ref: "ref-one" };
  await exportContract.submitL1Export(dashboard(), false, async input => inputs.push(input), query);
  assert.equal(inputs.length, 1);
  for (const [key, value] of Object.entries(query)) assert.equal(inputs[0][key], value);
  assert.equal("kpis" in inputs[0], false); assert.equal("value" in inputs[0], false);
});

test("BI parent drops a late previous-account response and gates data until the new owner read", async () => {
  let session = { adminId: 1, username: "first", role: "superadmin", authorities: [] }; const reads = [];
  const runtime = harness({
    "@/lib/store/admin-auth": { useAdminAuth: select => select({ session }) },
    "./design-kit": { useToast: () => [null, () => {}] },
    "@/lib/admin/l-client": { fetchLBiOverview: () => { const request = deferred(); reads.push(request); return request.promise; }, lBiActions: {} },
  });
  const { LDomainView } = runtime.load("../app/components/domain-views/l-view.tsx");
  const render = () => runtime.render(LDomainView, { meta: { l2Id: "L1" } });
  const context = tree => find(tree, node => node.props?.onExportSource)?.props.ctx;
  render(); assert.equal(reads.length, 1);
  session = { ...session, adminId: 2, username: "second" };
  assert.equal(context(render()).biData, null); assert.equal(reads.length, 2);
  reads[0].resolve({ l1: dashboard(92) }); await settle();
  assert.equal(context(render()).biData, null);
  reads[1].resolve({ l1: dashboard(63) }); await settle();
  assert.equal(context(render()).biData.l1.kpis[0].value, 63);
  const pending = context(render()).reloadBi();
  runtime.unmount(); reads[2].resolve({ l1: dashboard(99) }); await pending;
});
