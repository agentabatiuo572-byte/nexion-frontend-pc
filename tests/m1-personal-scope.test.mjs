import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function effect(file, call) {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes(call)) found = node.getText(ast);
    else ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, `Missing actual ${call} effect`);
  return ts.transpileModule(found, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test("M1 personal cards, TODO and customer pagination use PERSONAL after losing a managed group; the pool makes no personal request", async () => {
  const source = effect("app/components/domain-views/m-tabs/m1-personal-workbench.tsx", "supportClient.snapshot");
  // M-41: the pool is its own tab rendered by M1SupervisorPool, so the personal snapshot never runs for it.
  const analytics = readFileSync(new URL("../app/components/domain-views/m-tabs/m1-analytics-workbench.tsx", import.meta.url), "utf8");
  if (!/section === "pool" && <M1SupervisorPool permission=\{leadPermission\}/.test(analytics)) throw new Error("pool tab must render M1SupervisorPool");
  for (const view of ["dashboard", "customers"]) {
    const calls = [], context = {
      view, page: 2, keyword: "2005", activeFilter: view === "dashboard" ? "TODO" : "ALL", PAGE_SIZE: 10,
      authEpoch: 1, rowsRefresh: 0, AbortController, snapshotController: { current: null },
      supportClient: { snapshot: async options => {
        calls.push(options);
        return { overview: { scope: { mode: options.mode ?? "MANAGED" }, counts: { boundCustomers: options.mode === "PERSONAL" ? 24 : 0 } }, customers: { available: true, total: options.mode === "PERSONAL" ? 24 : 0, records: [] } };
      } },
      useEffect: callback => { context.cleanup = callback(); },
      setSnapshot: value => { context.snapshot = value; },
      setRowsLoading() {}, setOverviewLoading() {}, setRowsError() {}, setOverviewError() {}, errorText: () => "读取失败",
    };
    runInNewContext(source, context); await flush();
    if (view === "pool") assert.equal(calls.length, 0);
    else {
      assert.equal(calls.length, 1);
      assert.equal(calls[0].mode, "PERSONAL");
      assert.equal(calls[0].filter, view === "dashboard" ? "TODO" : "ALL");
      assert.equal(calls[0].pageNum, view === "dashboard" ? 1 : 2);
      assert.equal(context.snapshot.overview.counts.boundCustomers, 24);
      assert.equal(context.snapshot.customers.total, 24);
    }
    context.cleanup?.();
  }
});

test("the existing M3 contact picker pages through personal customers rather than managed clients", async () => {
  const calls = [], context = {
    keyword: "2005", page: 2, retry: 0, epoch: 1, AbortController,
    supportClient: { customers: async options => { calls.push(options); return { total: 24, records: [{ customerId: "2005", agentAdminId: 1456 }] }; } },
    useEffect: callback => { context.cleanup = callback(); },
    setRows: value => { context.rows = value; }, setError() {}, displayAdminError: () => "读取失败",
  };
  runInNewContext(effect("app/components/domain-views/m-tabs/m3-dedicated-chat.tsx", "supportClient.customers"), context);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "PERSONAL");
  assert.equal(calls[0].pageNum, 2);
  assert.equal(context.rows.records[0].customerId, "2005");
  context.cleanup();
});
