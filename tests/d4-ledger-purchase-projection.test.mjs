import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const clientPath = "lib/admin/d-client.ts";
const uiPath = "app/components/domain-views/d-tabs/d4-ledger.tsx";
const source = path => readFileSync(new URL(path, root), "utf8");
const compile = (path, imports, override) => {
  const module = { exports: {} };
  const code = ts.transpileModule(override ?? source(path), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: imports,
    URL, URLSearchParams, Headers, Response, AbortSignal, console }, { filename: path });
  return module.exports;
};

function row(changes = {}) {
  return { id: 101, userId: 7, userNo: "U00000007", nickname: "test", bizNo: "ORDER-1",
    bizType: "ORDER_PURCHASE", billType: "purchase", subtype: "order_purchase", asset: "USDT",
    direction: "OUT", amount: 1299, balanceAfter: 0, status: "SUCCESS", remark: "purchase",
    createdAt: "2026-10-01T10:00:00", updatedAt: "2026-10-01T10:00:00", ...changes };
}
const page = records => ({ records, total: records.length, pageNum: 1, pageSize: 10 });
const ledger = rows => ({ userId: 7, userNo: "U00000007", nickname: "test", rows, total: rows.length,
  sums: { USDT: -1299, NEX: 0 }, categorySums: { "purchase:USDT": -1299, "earning:USDT": 0 },
  currentUsdtBalance: 0, currentNexBalance: 0, sources: ["nx_wallet_ledger", "nx_user_wallet"] });

function loadClient(data, override) {
  const calls = [];
  const client = compile(clientPath, name => {
    if (name === "@/lib/admin/error-messages") return {
      formatAdminApiError: message => message,
      guardedFetch: async (url, init) => {
        assert.equal(init.method ?? "GET", "GET");
        calls.push(url);
        return Response.json({ code: 0, data });
      },
    };
    if (name === "@/lib/admin/pending-mutation-store") return { createPendingMutationStore: () => ({}) };
    if (name === "@/lib/admin/auth-session") return { isAdminAuthFailure: () => false };
    if (name === "@/lib/admin/auth-lifecycle") return { adminAuthLifecycleEpoch: () => 0 };
    if (name.startsWith("@/")) return {};
    throw new Error(`Unexpected client dependency ${name}`);
  }, override);
  return { client, calls };
}

function renderLedger(bills, userLedger, selectedType = "purchase") {
  let stateIndex = 0;
  const replacements = new Map([[0, bills], [3, selectedType], [8, userLedger], [10, false]]);
  const fakeReact = { ...React,
    useState: initial => {
      const index = stateIndex++;
      return [replacements.has(index) ? replacements.get(index) : initial, () => {}];
    },
    useEffect: () => {}, useMemo: factory => factory(), useRef: value => ({ current: value }),
  };
  const modules = new Map();
  const local = path => {
    if (!modules.has(path)) modules.set(path, compile(path, name => {
      if (name === "react") return path === uiPath ? fakeReact : React;
      if (name === "next/navigation") return { useSearchParams: () => new URLSearchParams() };
      if (name === "next/link") return { default: ({ children, prefetch: _prefetch, ...props }) => React.createElement("a", props, children) };
      if (name === "@/lib/store/admin-auth") return { useAdminAuth: selector => selector({ session: { role: "superadmin", authorities: [] } }) };
      if (name === "@/lib/admin/d-client") return {};
      if (name === "@/lib/admin/error-messages") return { displayAdminError: message => message };
      if (name.startsWith("@/")) return local(`${name.slice(2)}${name.endsWith("tab-group") ? ".tsx" : ".ts"}`);
      if (name === "./tab-group-keyboard") return local("app/components/kit/tab-group-keyboard.ts");
      return require(name);
    }));
    return modules.get(path);
  };
  const element = local(uiPath).D4Ledger({ ctx: {} });
  assert.equal(stateIndex, 15, "fixture must still align with the real page state");
  return renderToStaticMarkup(element);
}

test("real list caller accepts purchase, preserves money and sends its independent filter", async () => {
  for (const direction of ["OUT", "DEBIT"]) {
    const raw = row({ direction });
    const { client, calls } = loadClient(page([raw]));
    const result = await client.fetchD4Bills({ type: "purchase", userId: 7, pageNum: 1, pageSize: 10 });
    assert.equal(result.records[0].billType, "purchase");
    for (const key of ["id", "bizNo", "bizType", "direction", "amount", "balanceAfter", "status"]) {
      assert.equal(result.records[0][key], raw[key]);
    }
    assert.match(calls[0], /[?&]type=purchase(?:&|$)/);
    assert.equal(result.total, 1);
  }
});

test("real user-ledger caller preserves independent purchase/earning totals and wallet facts", async () => {
  const raw = ledger([row()]);
  const result = await loadClient(raw).client.fetchD4UserLedger(7);
  assert.equal(result.rows[0].billType, "purchase");
  assert.equal(result.categoryTotals["purchase:USDT"], -1299);
  assert.equal(result.categoryTotals["earning:USDT"], 0);
  assert.equal(result.totals.USDT, -1299);
  assert.equal(result.balance.USDT, 0);
});

test("purchase cannot be claimed for unknown types, rewards, refunds or incoming/invalid directions", async () => {
  for (const changes of [
    { bizType: "UNKNOWN_PURCHASE" }, { bizType: "GENESIS_PURCHASE" }, { bizType: "ORDER_PURCHASE_REWARD" },
    { bizType: "ORDER_REFUND" }, { direction: "IN" }, { direction: "CREDIT" },
    { direction: "UNKNOWN" }, { billType: null }, { billType: "unknown" }, { amount: -1299 },
  ]) {
    await assert.rejects(loadClient(page([row(changes)])).client.fetchD4Bills({}), /D4_RESPONSE_INVALID/);
  }
});

test("the original seven canonical categories and unknown business facts remain accepted unchanged", async () => {
  const types = ["swap", "topup", "withdraw", "earning", "commission", "refund", "bonus"];
  const rows = types.map((billType, index) => row({ id: index + 1, billType, bizType: `OLD_${index}`,
    subtype: `old_${index}`, direction: index % 2 ? "IN" : "OUT", amount: index, balanceAfter: 100 + index }));
  const result = await loadClient(page(rows)).client.fetchD4Bills({});
  assert.deepEqual(Array.from(result.records, item => item.billType), types);
  rows.forEach((raw, index) => {
    for (const key of ["bizType", "subtype", "direction", "amount", "balanceAfter"]) assert.equal(result.records[index][key], raw[key]);
  });
});

test("actual React SSR exposes eight tabs and presents purchase rows and totals independently", async () => {
  const bills = await loadClient(page([row()])).client.fetchD4Bills({});
  const userLedger = await loadClient(ledger([row()])).client.fetchD4UserLedger(7);
  const html = renderLedger(bills, userLedger);
  const categoryTabs = html.match(/<div[^>]*role="tablist"[^>]*aria-label="账单类型"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(categoryTabs, "actual named category tablist");
  assert.equal((categoryTabs.match(/role="tab"/g) ?? []).length, 9, "all plus the exact eight categories");
  assert.match(categoryTabs, /role="tab"[^>]*aria-selected="true"[^>]*>商品购买<\/button>/);
  assert.match(html, /商品购买 · USDT/);
  assert.match(html, /商品购买 · ORDER-1/);
  assert.match(html, /收益 · USDT/);
  assert.doesNotMatch(html, /收益 · ORDER-1|七类/);
  assert.match(html, /-\$1,299\.00 USDT/);
});

test("actual React SSR retains the seven previous labels beside the new purchase filter", () => {
  const html = renderLedger(page([]), null, "");
  for (const label of ["全部", "兑换", "充值", "提现", "收益", "佣金", "退款", "奖励", "商品购买"]) {
    assert.ok(html.includes(`>${label}</button>`), label);
  }
});
