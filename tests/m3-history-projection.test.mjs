import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/admin/m-client.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("m-client.ts", source, ts.ScriptTarget.Latest, true);
const functions = ["fetchMConversationDetail", "markMConversationRead"].map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast));
const compiled = ts.transpileModule(functions.join("\n").replaceAll("export async", "async"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const calls = [], detail = { conversation: { status: "CLOSED", version: 7 }, messages: [{ id: 19, receiptStatus: "sent" }] };
  const ctx = {
    detail, calls,
    apiRequest: async (path, options) => { calls.push({ path, options }); return detail; },
    assertConversationDetail: value => value,
    adaptConversation: value => ({ id: "CV history", detailReady: true, messages: value.messages }),
  };
  vm.runInNewContext(`${compiled}\nglobalThis.api={fetchMConversationDetail,markMConversationRead};`, ctx);
  return ctx;
}
test("current and dock detail keep the default full endpoint; explicit history selects only the lightweight projection", async () => {
  const f = fixture(), signal = new AbortController().signal;
  await f.api.fetchMConversationDetail("CV history", signal);
  assert.equal(f.calls[0].path, "/conversations/CV%20history");
  const light = await f.api.fetchMConversationDetail("CV history", signal, false);
  assert.equal(f.calls[1].path, "/conversations/CV%20history?includeCustomerProfile=false");
  assert.equal(f.calls[1].options.signal, signal); assert.equal(light.messages, f.detail.messages);
});
test("receipt preflight uses the lightweight read and retains current status/version and target message ID", async () => {
  const f = fixture(), signal = new AbortController().signal;
  await f.api.markMConversationRead("CV history", 19, signal);
  assert.equal(f.calls[0].path, "/conversations/CV%20history?includeCustomerProfile=false");
  assert.equal(f.calls[1].path, "/conversations/CV%20history/read");
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { lastSeenMessageId: 19, expectedStatus: "CLOSED", expectedVersion: 7 });
  assert.equal(f.calls[1].options.signal, signal);
});
test("already-read receipts and aborted preflights never issue the write", async () => {
  const read = fixture(); read.detail.messages[0].receiptStatus = "read";
  await read.api.markMConversationRead("CV history", 19, new AbortController().signal);
  assert.equal(read.calls.length, 1);
  const aborted = fixture(), controller = new AbortController(); controller.abort();
  await aborted.api.markMConversationRead("CV history", 19, controller.signal);
  assert.equal(aborted.calls.length, 1);
});
