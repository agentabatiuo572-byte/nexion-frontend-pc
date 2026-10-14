import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const client = readFileSync(new URL("../lib/admin/m-client.ts", import.meta.url), "utf8");
const chat = readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx", import.meta.url), "utf8");
function declaration(source, name) {
  const ast = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node.getText(ast).replace(/^export /, "");
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === name)) return node.getText(ast);
  }
  throw new Error(`Missing ${name}`);
}
function load(source, name, context = {}) {
  const script = declaration(source, name) + `\nglobalThis.actual = ${name};`;
  runInNewContext(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.actual;
}
test("preserves AI wire identity while both human aliases remain writable only by their current owner", () => {
  const type = load(client, "conversationType");
  assert.equal(type("AI"), "ai"); assert.equal(type("SUPPORT"), "support"); assert.equal(type("ADVISOR"), "advisor");
  const send = load(chat, "canSendTo");
  for (const type of ["advisor", "support"]) {
    assert.equal(send({ type, status: "open", ownerAdminId: 7 }, 7), true);
    assert.equal(send({ type, status: "open", ownerAdminId: 8 }, 7), false);
    assert.equal(send({ type, status: "closed", ownerAdminId: 7 }, 7), false);
    assert.equal(send({ type, status: "transferred", ownerAdminId: 7 }, 7), false);
  }
  assert.equal(send({ type: "ai", status: "open", ownerAdminId: 7 }, 7), false);
});
test("recent human caller requests server filtering before paging and retains old SUPPORT ids", async () => {
  const calls = [], rows = [{ conversationType: "SUPPORT", conversationNo: "CV-old", customerId: 3, unreadCount: 2 },
    { conversationType: "ADVISOR", conversationNo: "CV-new", customerId: 4 },
    { conversationType: "AI", conversationNo: "CV-ai", customerId: 5 }];
  const fetch = load(client, "fetchMRecentAdvisorConversations", {
    supportWireId: x => x, assertConversationPage: x => x, apiRequest: async path => { calls.push(path); return { records: rows }; },
    upper: (x, fallback) => typeof x === "string" ? x.toUpperCase() : fallback, str: x => x ?? "", asTs: () => 0, num: (x, fallback) => x ?? fallback,
  });
  const result = await fetch(7);
  assert.equal(calls[0], "/conversations?readMode=PERSONAL&type=HUMAN&ownerAgentId=7&pageNum=1&pageSize=5");
  assert.deepEqual(Array.from(result, x => x.conversationNo), ["CV-old", "CV-new"]);
  assert.equal(result[0].unreadCount, 2);
});

test("recent personal messages preserve denial and cancellation instead of reporting an empty inbox", async () => {
  for (const failure of [Object.assign(new Error("Forbidden"), { status: 403 }), new DOMException("Cancelled", "AbortError")]) {
    const controller = new AbortController();
    const fetch = load(client, "fetchMRecentAdvisorConversations", {
      supportWireId: x => x, assertConversationPage: x => x,
      apiRequest: async (path, { signal }) => {
        assert.equal(signal, controller.signal);
        assert.match(path, /readMode=PERSONAL.*ownerAgentId=7/);
        throw failure;
      },
    });
    await assert.rejects(fetch(7, controller.signal), error => error === failure);
  }
});
