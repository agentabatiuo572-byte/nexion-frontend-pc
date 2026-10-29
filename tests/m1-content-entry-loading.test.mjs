import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../lib/admin/m-client.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("m-client.ts", source, ts.ScriptTarget.Latest, true);
const functions = ["initialMContentData", "fetchMContentData"].map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast));
const compiled = ts.transpileModule(functions.join("\n").replace("export async", "async"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function entryLoader(authorities = ["service_m1_read", "service_m3_read", "service_m4_read", "service_m5_read"]) {
  const calls = [], state = { sessionKey: "current", agentFailure: null };
  const templates = { scripts: [], categories: [], audienceOptions: [], segmentFields: [], replyTemplates: [] };
  const apiRequest = async path => {
    calls.push(path);
    if (path === "/knowledge/overview") return { faqs: [], sla: [] };
    if (path === "/session-templates/overview" || path === "/session-templates/runtime") return templates;
    if (path === "/tickets/load-config") return {};
    if (path === "/conversations/transfer-targets") return [];
    throw new Error(`unexpected request: ${path}`);
  };
  const identity = x => x;
  const dependencies = {
    currentMContentSessionKey: () => state.sessionKey,
    isMContentSessionCurrent: key => key === state.sessionKey,
    useAdminAuth: { getState: () => ({ session: { authorities } }) },
    apiRequest,
    fetchAllSupportConversations: async () => { calls.push("conversations"); return { records: [] }; },
    fetchSharedM1SupportAgentOverview: async () => { calls.push("support-agents"); if (state.agentFailure) throw state.agentFailure; return { agents: [], advisorAssignments: [], transferTargets: [] }; },
    classifySupportAgentFailure: () => "permission",
    adaptLoadConfig: () => ({ version: 1, agentState: {} }),
    assertSupportKnowledgeOverview: identity,
    requireSessionTemplateOverview: identity,
    bool: (x, fallback) => x ?? fallback,
    num: (x, fallback) => x ?? fallback,
    str: x => x ?? "",
    asArray: x => x ?? [],
    ...Object.fromEntries(["adaptConversation", "adaptSupportAgent", "adaptAdvisorAssignment", "adaptFaq", "adaptSla", "adaptScript", "adaptCategory", "adaptReplyTemplate"].map(name => [name, identity])),
  };
  const load = new Function(...Object.keys(dependencies), `${compiled}; return fetchMContentData;`)(...Object.values(dependencies));
  return { load, calls, state };
}

test("M1 omits obsolete load policy while retaining seats, conversations and shared content tools", async () => {
  const { load, calls } = entryLoader();
  const data = await load(undefined, "M1");
  assert.deepEqual(calls.sort(), ["conversations", "support-agents", "/conversations/transfer-targets", "/knowledge/overview", "/session-templates/overview"].sort());
  assert.equal(data.conversationsAvailable, true);
  assert.equal(data.supportAgentsAvailable, true);
  assert.equal(data.knowledgeAvailable, true);
  assert.equal(data.sessionTemplatesAvailable, true);
  assert.deepEqual(data.replyTemplates, [], "a verified empty template set stays available");
  assert.equal(data.loadConfigAvailable, false);
});

test("M4/M5 entry still reads its own bundle after M1, without a cross-page response cache", async () => {
  const { load, calls } = entryLoader();
  await load(undefined, "M1"); calls.length = 0;
  assert.equal((await load(undefined, "M4")).knowledgeAvailable, true);
  assert.ok(calls.includes("/knowledge/overview")); calls.length = 0;
  assert.equal((await load(undefined, "M5")).sessionTemplatesAvailable, true);
  assert.ok(calls.includes("/session-templates/overview"));
});

test("M1 permission denial stays fail-closed and later refresh recovers seats", async () => {
  const { load, state } = entryLoader(); state.agentFailure = new Error("denied");
  const denied = await load(undefined, "M1");
  assert.equal(denied.supportAgentsAvailable, false);
  assert.equal(denied.supportAgentsError, "permission");
  assert.deepEqual(denied.transferTargets, []);
  state.agentFailure = null;
  assert.equal((await load(undefined, "M1")).supportAgentsAvailable, true);
  const noPermission = entryLoader([]);
  await noPermission.load(undefined, "M1");
  assert.deepEqual(noPermission.calls, []);
});

test("auth changes suppress in-flight progress and reject the old M1 result", async () => {
  const { load, state } = entryLoader(); const progress = [];
  const pending = load(data => progress.push(data), "M1");
  const before = progress.length; state.sessionKey = "different-operator";
  await assert.rejects(pending, /M_CONTENT_AUTH_EPOCH_CHANGED/);
  assert.equal(progress.length, before);
});
