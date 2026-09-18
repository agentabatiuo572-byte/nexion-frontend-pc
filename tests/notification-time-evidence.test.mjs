import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(relative, requireMock, fetchMock) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", "fetch", output)(requireMock, exports, fetchMock);
  return exports;
}
function routeHarness(token = "fixture-token") {
  const calls = [];
  const api = load("../app/api/admin/users/[...path]/route.ts", name => name === "next/headers"
    ? { cookies: async () => ({ get: () => token ? { value: token } : undefined }) }
    : { requirePasswordChangeCleared: () => null }, async (url, init) => {
      calls.push({ url, init }); return Response.json({ code: 0, data: { notificationId: 99 } });
    });
  const call = (method, path = ["profiles", "user/key", "notifications", "99", "time-evidence"]) =>
    api[method](new Request("http://fixture/api", { method }), { params: Promise.resolve({ path }) });
  return { calls, call };
}
test("exact evidence GET forwards encoded user/id with auth and no-store", async () => {
  const h = routeHarness(); assert.equal((await h.call("GET")).status, 200);
  assert.ok(h.calls[0].url.endsWith("/profiles/user%2Fkey/notifications/99/time-evidence"));
  assert.equal(h.calls[0].init.method, "GET"); assert.equal(h.calls[0].init.body, undefined);
  assert.equal(h.calls[0].init.headers.get("Authorization"), "Bearer fixture-token");
  assert.equal(h.calls[0].init.cache, "no-store");
});
test("evidence route rejects writes, invalid ids and missing auth without upstream calls", async () => {
  const h = routeHarness();
  for (const method of ["POST", "PATCH"]) assert.equal((await h.call(method)).status, 405);
  for (const id of ["0", "-1", "1.5", "99/repair"]) assert.equal((await h.call("GET", ["profiles", "7", "notifications", id, "time-evidence"])).status, 404);
  assert.equal(h.calls.length, 0);
  const anonymous = routeHarness(null); assert.equal((await anonymous.call("GET")).status, 401); assert.equal(anonymous.calls.length, 0);
});
test("real client carries cancellation, rejects invalid ids and never creates a mutation key", async () => {
  const calls = [];
  const valid = {notificationId:99,status:"NO_EVIDENCE",reason:"持久证据缺失",storedCreatedAt:"2026-09-18 03:38:00",deliveryFactTime:null,timeZone:"Asia/Shanghai",facts:[]};
  let responseData = valid;
  const api = load("../lib/admin/user360-client.ts", name => name.endsWith("pending-mutation-store")
    ? { createPendingMutationStore: () => ({}) }
    : name.endsWith("error-messages") ? { guardedFetch: async (url, init) => { calls.push({url, init}); return Response.json({code: 0, data: responseData}); } } : {}, undefined);
  const controller = new AbortController();
  assert.deepEqual(await api.fetchNotificationTimeEvidence("user/key", 99, controller.signal), valid);
  assert.equal(calls[0].url, "/api/admin/users/profiles/user%2Fkey/notifications/99/time-evidence");
  assert.equal(calls[0].init.signal, controller.signal); assert.equal(calls[0].init.headers.has("Idempotency-Key"), false);
  for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => api.fetchNotificationTimeEvidence("7", id));
  assert.equal(calls.length, 1);
  const matched={...valid,status:"MATCHED",deliveryFactTime:"2026-09-18 11:38:00",facts:["auth.register_completed","nova.push_sent","notification.delivered"].map((eventName,i)=>({eventName,eventId:["a","b","c"][i].repeat(32),timestampMillis:1789702680000+i}))};
  responseData=matched; assert.deepEqual(await api.fetchNotificationTimeEvidence("7",99),matched);
  for (const malformed of [{notificationId:99}, {...valid,status:"OTHER"}, {...valid,status:["NO_EVIDENCE"]}, {...matched,facts:matched.facts.map(f=>({...f,eventName:[f.eventName]}))}, {...valid,notificationId:100}, {...valid,storedCreatedAt:"2026-02-30 03:38:00"}, {...matched,facts:[]}, {...valid,facts:matched.facts}, {...valid,deliveryFactTime:matched.deliveryFactTime}, {...matched,facts:matched.facts.map(f=>({...f,timestampMillis:Infinity}))}, {...matched,facts:matched.facts.map(f=>({...f,eventId:"sensitive@example.invalid"}))}, {...matched,facts:matched.facts.map(f=>({...f,eventName:"nova.push_sent"}))}]) {
    responseData=malformed; await assert.rejects(api.fetchNotificationTimeEvidence("7",99),/通知证据响应无效/);
  }
});



