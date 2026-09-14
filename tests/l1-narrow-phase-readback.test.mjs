import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as kpiContract from "../app/components/domain-views/l-tabs/l1-kpi-contract.ts";
import * as liveTotals from "../app/components/domain-views/l-tabs/l1-l2-live-data.ts";
import * as exportContract from "../app/components/domain-views/l-tabs/l1-export-contract.ts";
import * as requestController from "../app/components/domain-views/l-tabs/l1-request-generation.ts";
import * as attributionRoutes from "../app/components/domain-views/l-tabs/l-attribution-routes.ts";

function loadClient(read) {
  const source = readFileSync(new URL("../lib/admin/l-client.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "module", output)((name) => {
    if (name.endsWith("error-messages")) return { guardedFetch: read, formatAdminApiError: (message) => message };
    if (name.endsWith("current-operator")) return { currentAdminOperator: () => "test" };
    if (name.endsWith("l6-runtime-state") || name.endsWith("l3-finance-contract")) return {};
    if (name.endsWith("l5-overview-contract")) return { CURRENT_L5_REPORT_TYPES: [] };
    throw new Error(`Unexpected dependency: ${name}`);
  }, exports, { exports });
  return exports;
}

test("L1 reads its own endpoint and carries live phase without fetching other BI modules", async () => {
  const requests = [];
  let payload = { module: "L1", available: false, kpis: [], currentPhase: { code: "P6", month: 11, sourceDomain: "H1" } };
  const client = loadClient(async (url, init) => {
    requests.push({ url, method: init.method ?? "GET" });
    return new Response(JSON.stringify({ code: 0, data: payload }));
  });
  const first = await client.fetchLBiOverview("L1");
  assert.deepEqual(first, { l1: payload, currentPhase: payload.currentPhase });
  payload = { module: "L1", available: false, kpis: [] };
  const second = await client.fetchLBiOverview("L1");
  assert.deepEqual(second, { l1: payload, currentPhase: {} }, "missing phase must not reuse the previous account or response");
  assert.deepEqual(requests, Array.from({ length: 2 }, () => ({ url: "/api/admin/bi/kpi?window=7d", method: "GET" })));
});

test("L1 read failure propagates without falling back to broad overview or cached phase", async () => {
  const requests = [];
  const client = loadClient(async (url) => {
    requests.push(url);
    return new Response(JSON.stringify({ code: 403, message: "FORBIDDEN" }), { status: 403 });
  });
  await assert.rejects(client.fetchLBiOverview("L1"), /FORBIDDEN/);
  assert.deepEqual(requests, ["/api/admin/bi/kpi?window=7d"]);
});

function renderKpi(parent, local) {
  const directory = new URL("../app/components/domain-views/l-tabs/", import.meta.url);
  let stateIndex = 0;
  const element = (type, props) => ({ type, props });
  const load = (filename) => {
    const output = ts.transpileModule(readFileSync(new URL(filename, directory), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    new Function("require", "exports", "module", output)((name) => {
      if (name === "react") return {
        useState: (initial) => [stateIndex++ === 14 ? local : initial, () => {}],
        useRef: (initial) => ({ current: initial }), useEffect: () => {},
      };
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "fragment" };
      if (name === "./live-data") return load("live-data.tsx");
      if (name === "./l1-kpi-contract") return kpiContract;
      if (name === "./l1-l2-live-data") return liveTotals;
      if (name === "./l1-export-contract") return exportContract;
      if (name === "./l1-request-generation") return requestController;
      if (name === "./l-attribution-routes") return attributionRoutes;
      // Presentation-only children are represented as elements; effects and event handlers are not run.
      return {};
    }, exports, { exports });
    return exports;
  };
  return load("l1-kpi.tsx").L1Kpi({ ctx: { biData: { l1: parent, currentPhase: parent.currentPhase } } });
}

function findPhaseText(node) {
  if (!node || typeof node !== "object") return "";
  const text = (value) => Array.isArray(value) ? value.map(text).join("")
    : value && typeof value === "object" ? text(value.props?.children)
      : value == null || typeof value === "boolean" ? "" : String(value);
  if (node.props?.className === "f-stat cyan") return text(node.props.children);
  return (Array.isArray(node) ? node : [node.props?.children]).map(findPhaseText).join("");
}

test("L1 rendered phase follows the selected response and does not reuse parent phase after refresh", () => {
  const kpis = Array.from({ length: 8 }, (_, i) => ({
    n: i + 1, kpiId: String(i + 1), name: `KPI ${i + 1}`, target: 60, dir: "gte", unit: "%",
    available: false, value: null, numerator: 0, denominator: 0, spark: [],
  }));
  const dashboard = { module: "L1", kpis, weeks: ["W1", "W2", "W3", "W4", "W5", "W6"],
    kpiPlain: Object.fromEntries(kpis.map(row => [String(row.n), row.name])),
    kpiExt: Object.fromEntries(kpis.map(row => [String(row.n), { fx: row.name, fxBold: [], num: "0", den: "0", delta: "0", note: "Insufficient events", jump: [] }])),
  };
  const parent = { ...dashboard, currentPhase: { code: "P1", month: 1 } };
  assert.match(findPhaseText(renderKpi(parent, null)), /P1 · 月 1/);
  assert.match(findPhaseText(renderKpi(parent, { ...dashboard, currentPhase: { code: "P6", month: 11 } })), /P6 · 月 11/);
  const missing = findPhaseText(renderKpi(parent, dashboard));
  assert.match(missing, /未返回/);
  assert.doesNotMatch(missing, /P1/);
});
