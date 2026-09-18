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
  const call = (method, path = ["profiles", "user/key", "notifications", "99", "time-evidence"], init = {}) =>
    api[method](new Request("http://fixture/api", { method, ...init }), { params: Promise.resolve({ path }) });
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

test("correction route is precise POST only and forwards the supplied command capsule", async () => {
  const path=["profiles","user/key","notifications","99","time-correction"];
  const h=routeHarness();
  for(const method of ["GET","PATCH"]) assert.equal((await h.call(method,path)).status,405);
  const body=JSON.stringify({expectedCreatedAt:"2026-09-18 03:38:59",facts:[],reason:"fixture"});
  assert.equal((await h.call("POST",path,{headers:{"Content-Type":"application/json","Idempotency-Key":"owned-key"},body})).status,200);
  assert.equal(h.calls.length,1); assert.ok(h.calls[0].url.endsWith("/profiles/user%2Fkey/notifications/99/time-correction"));
  assert.equal(h.calls[0].init.headers.get("Idempotency-Key"),"owned-key");assert.equal(h.calls[0].init.body,body);
  const anonymous=routeHarness(null);assert.equal((await anonymous.call("POST",path)).status,401);assert.equal(anonymous.calls.length,0);
});

test("correction client submits evidence and old value only, retains caller key, rejects malformed receipt", async () => {
  const calls=[];
  const preview={notificationId:99,status:"MATCHED",reason:"关联一致",storedCreatedAt:"2026-09-18 03:38:59",deliveryFactTime:"2026-09-18 11:38:58",timeZone:"Asia/Shanghai",facts:["auth.register_completed","nova.push_sent","notification.delivered"].map((eventName,i)=>({eventName,eventId:["a","b","c"][i].repeat(32),timestampMillis:1789702738000+i}))};
  let data={notificationId:99,status:"CORRECTED",previousCreatedAt:preview.storedCreatedAt,correctedCreatedAt:preview.deliveryFactTime,timeZone:"Asia/Shanghai"};
  const api=load("../lib/admin/user360-client.ts",name=>name.endsWith("pending-mutation-store")?{createPendingMutationStore:()=>({})}:name.endsWith("error-messages")?{guardedFetch:async(url,init)=>{calls.push({url,init});return Response.json({code:0,data});}}:{},undefined);
  assert.deepEqual(await api.correctNotificationTime("user/key",preview,"  根据实际投递事实校正  ","same-key"),{notificationId:99,correctedCreatedAt:preview.deliveryFactTime});
  assert.equal(calls[0].url,"/api/admin/users/profiles/user%2Fkey/notifications/99/time-correction");
  assert.equal(calls[0].init.headers.get("Idempotency-Key"),"same-key");
  assert.deepEqual(JSON.parse(calls[0].init.body),{expectedCreatedAt:preview.storedCreatedAt,facts:preview.facts,reason:"根据实际投递事实校正"});
  for(const bad of [{...preview,status:"NO_EVIDENCE",facts:[],deliveryFactTime:null},{...preview,notificationId:0},{...preview,notificationId:1.5},{...preview,storedCreatedAt:preview.deliveryFactTime}]) await assert.rejects(api.correctNotificationTime("7",bad,"fixture reason","same-key"));
  await assert.rejects(api.correctNotificationTime("",preview,"fixture reason","same-key"));
  await assert.rejects(api.correctNotificationTime("7",preview," ","same-key"));assert.equal(calls.length,1);
  for(const malformed of [{notificationId:99},{...data,notificationId:100},{...data,correctedCreatedAt:preview.storedCreatedAt}]) {
    data=malformed;await assert.rejects(api.correctNotificationTime("7",preview,"fixture reason","same-key"),error=>error instanceof api.UsersOutcomeUnknownError);
    assert.equal(calls.at(-1).init.headers.get("Idempotency-Key"),"same-key");
  }
});



function drawerText(data, notice = "") {
  const source = readFileSync(new URL("../app/_console/users/search/[id]/notification-time-evidence.tsx", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const states = [data, "", 0, null, notice, null, false];
  const element = (type, props) => ({ type, props });
  const exports = {};
  new Function("require", "exports", output)(name => {
    if (name === "react") return { useState: () => [states.shift(), () => {}], useEffect: () => {}, useRef: value => ({current:value}) };
    if (name === "react/jsx-runtime") return {jsx:element,jsxs:element};
    if (name.endsWith("pending-mutation-store")) return {createPendingMutationStore:()=>({})};
    return {};
  }, exports);
  const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
  return text(exports.NotificationTimeEvidenceDrawer({userKey:"7",notificationId:99,actorKey:"reader",canCorrect:true,onClose:()=>{}}));
}
const matchedDisplay = {notificationId:99,status:"MATCHED",reason:"关联证据一致，仅供核验；尚未校正通知时间",storedCreatedAt:"2026-09-18 03:38:59",deliveryFactTime:"2026-09-18 11:38:58",facts:[]};
test("matched unequal timestamps show pending correction without claiming it happened",()=>{
  const text=drawerText(matchedDisplay);
  assert.match(text,/记录时间与投递事实时间不一致/);
  assert.match(text,/尚未校正/);
  assert.match(text,/按投递事实校正时间/);
});
test("equal timestamps derive consistency from readback and never infer a past correction",()=>{
  for(const notice of ["","已按投递事实校正通知时间，已读状态保持不变。"]){
    const text=drawerText({...matchedDisplay,storedCreatedAt:matchedDisplay.deliveryFactTime},notice);
    assert.match(text,/当前记录时间与投递事实时间一致/);
    assert.doesNotMatch(text,/尚未校正|不表示历史记录已修复|按投递事实校正时间/);
    if(!notice) assert.doesNotMatch(text,/已按投递事实校正通知时间/);
  }
});
test("missing evidence retains server reason and does not claim consistency or correction",()=>{
  const text=drawerText({...matchedDisplay,status:"NO_EVIDENCE",reason:"持久证据缺失",deliveryFactTime:null});
  assert.match(text,/持久证据缺失/);
  assert.doesNotMatch(text,/当前记录时间与投递事实时间一致|尚未校正通知时间/);
});
