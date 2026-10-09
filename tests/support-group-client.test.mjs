import test from "node:test";
import assert from "node:assert/strict";
import { actualSupport, makeClient, storage, group, detail, member, qualification, why } from "./helpers.mjs";
let calls=[], response;
const module=makeClient({supportRequest:async (url,parse,init)=>{calls.push({url,init});return parse(response);}}), client=module.supportGroupClient;
const key="12345678-1234-1234-1234-123456789012";
test("illegal IDs, versions, extra fields, page/group parameters and reasons cause zero transport",()=>{
  calls=[]; for(const id of ["0","01","1/2","9007199254740992"]) assert.throws(()=>client.detail(id));
  for(const q of [{pageNum:0,pageSize:20},{pageNum:1,pageSize:101},{pageNum:1,pageSize:20,groupId:"01"},{pageNum:1,pageSize:20,scope:"all"}])assert.throws(()=>client.candidates(q));
  assert.throws(()=>client.createSupportGroup({name:"组",supervisorAdminId:"01",reason:why},key));
  assert.throws(()=>client.createSupportGroup({name:"组",supervisorAdminId:"17",reason:"简短"},key));
  assert.throws(()=>client.renameSupportGroup("5",{name:"组",expectedVersion:0,reason:why},key));
  assert.throws(()=>client.transferSupportGroupOwner("5",{supervisorAdminId:"18",expectedVersion:3,reason:why,private:true},key));
  assert.throws(()=>client.moveSupportGroupMember("21",{targetGroupId:"6",expectedMemberVersion:7,sourceGroupVersion:3,targetGroupVersion:null,reason:why},key));
  assert.throws(()=>client.setSupportQualification("21",{qualificationKind:"OTHER",state:"ENABLED",expectedAccountVersion:13,expectedQualificationVersion:0,reason:why},key));
  assert.equal(calls.length,0);
});
test("safe account version is a strict latest-account string, ABSENT alone permits zero",()=>{
  assert.equal(module.accountVersion("9007199254740991"),Number.MAX_SAFE_INTEGER);
  for(const n of [13,"01","-1","9007199254740992","1.0",null])assert.throws(()=>module.accountVersion(n));
  assert.equal(module.observedVersion(member("21",null,"ABSENT").currentMember),0);
  assert.equal(module.observedVersion(member().currentMember),7);
  assert.throws(()=>module.observedVersion(member("21",null,"UNKNOWN").currentMember));
  assert.equal(module.observedVersion(qualification().qualifications[0]),0);
  assert.throws(()=>module.observedVersion(qualification("21","UNKNOWN").qualifications[0]));
});
test("strict read projections reject unknown/private fields and inconsistent identities/blockers",async()=>{
  for(const mutate of [v=>v.privatePhone="secret",v=>v.currentMember.state="UNKNOWN",v=>v.currentMember.version=Number.MAX_SAFE_INTEGER+1]){const value=member();mutate(value);assert.throws(()=>module.parseGroupMember(value));}
  for(const mutate of [v=>v.memberCount=1,v=>v.blockers.canExit=false,v=>v.group.status="UNKNOWN",v=>v.members.push({adminId:21,version:1,groupId:6,accountStatus:1,handoverRequired:0,boundCustomers:0})]){const value=detail();mutate(value);assert.throws(()=>module.parseGroupDetail(value));}
  for(const mutate of [v=>v.qualifications.pop(),v=>v.qualifications[0].version=1,v=>v.accountVersion="9007199254740992",v=>v.qualifications[0].state="ENABLED"]){const value=qualification();mutate(value);assert.throws(()=>module.parseQualifications(value));}
  response=member("22");await assert.rejects(client.member("21"));response=detail("6");await assert.rejects(client.detail("5"));response=qualification("22");await assert.rejects(client.qualifications("21"));
});
test("candidate requests preserve server paging and legal controlled groupId; page identity cannot drift",async()=>{
  response={records:[{adminId:21,name:"甲",version:999,privatePhone:"not selected"}],total:41,pageNum:2,pageSize:20};calls=[];
  const result=await client.candidates({pageNum:2,pageSize:20,groupId:"5"});assert.equal(result.records[0].adminId,"21");assert.equal(result.records[0].version,undefined);assert.equal(calls[0].url,"/support-agents/page?pageNum=2&pageSize=20&groupId=5");
  response.pageNum=1;await assert.rejects(client.candidates({pageNum:2,pageSize:20,groupId:"5"}));
});
test("all group writers whitelist body, use numeric safe wire IDs and original key; acknowledgements bound to intention",async()=>{
  response={...group("5"),name:"新组"};calls=[];await client.createSupportGroup({name:" 新组 ",supervisorAdminId:"17",reason:why},key);assert.deepEqual(JSON.parse(calls[0].init.body),{name:"新组",supervisorAdminId:17,reason:why});assert.equal(new Headers(calls[0].init.headers).get("Idempotency-Key"),key);
  response={...group("5","17",4),name:"新名"};await client.renameSupportGroup("5",{name:"新名",expectedVersion:3,reason:why},key);
  response={...group("5","17",4),status:"DISABLED"};await client.setSupportGroupStatus("5",{status:"DISABLED",expectedVersion:3,reason:why},key);
  response=group("5","18",4);await client.transferSupportGroupOwner("5",{supervisorAdminId:"18",expectedVersion:3,reason:why},key);
  response=group("6","18",4);await assert.rejects(client.transferSupportGroupOwner("5",{supervisorAdminId:"18",expectedVersion:3,reason:why},key));
  response=group("5","18",3);await assert.rejects(client.transferSupportGroupOwner("5",{supervisorAdminId:"18",expectedVersion:3,reason:why},key));
});
test("move and qualification use narrow observation versions, never profile versions",async()=>{
  calls=[];response={member:{id:88,agentAdminId:21,groupId:6,version:8,startsAt:"2026-10-09T00:00:00Z"},boundCustomers:4};await client.moveSupportGroupMember("21",{targetGroupId:"6",expectedMemberVersion:7,sourceGroupVersion:3,targetGroupVersion:3,reason:why},key);assert.equal(JSON.parse(calls[0].init.body).expectedMemberVersion,7);
  response=[{id:1,adminId:21,qualificationKind:"SERVICE",state:"ENABLED",version:1,startsAt:"2026-10-09T00:00:00Z"}];await client.setSupportQualification("21",{qualificationKind:"SERVICE",state:"ENABLED",expectedQualificationVersion:0,expectedAccountVersion:13,reason:why},key);assert.equal(JSON.parse(calls[1].init.body).expectedAccountVersion,13);
  response[0].qualificationKind="SUPERVISOR";await assert.rejects(client.setSupportQualification("21",{qualificationKind:"SERVICE",state:"ENABLED",expectedQualificationVersion:0,expectedAccountVersion:13,reason:why},key));
});
test("real supportRequest/guardedFetch transport keeps same-origin, no-store, signal, envelope and HTTP errors",async()=>{
  const real=makeClient(), original=globalThis.fetch, seen=[];let upstream=new Response(JSON.stringify({code:0,message:"OK",data:detail()}),{status:200,headers:{"content-type":"application/json"}});
  globalThis.fetch=async (url,init)=>{seen.push({url,init});return upstream;};try{const abort=new AbortController();await real.supportGroupClient.detail("5",abort.signal);assert.equal(seen[0].url,"/api/admin/content/support-agents/groups/5");assert.equal(seen[0].init.credentials,"same-origin");assert.equal(seen[0].init.cache,"no-store");assert.equal(seen[0].init.signal,abort.signal);for(const status of [403,409]){upstream=new Response(JSON.stringify({code:status,message:"DENIED",data:null}),{status});await assert.rejects(real.supportGroupClient.detail("5"),e=>e instanceof actualSupport.SupportClientError&&e.status===status);}}finally{globalThis.fetch=original;}
});
test("unknown raw command statuses and 404 never become definite failure",async()=>{for(const status of ["PROCESSING","UNKNOWN","NOT_FOUND","MISMATCH","NEW_BACKEND_STATUS"]){response={status};assert.equal((await client.command("x")).status,status);}response={status:"SUCCEEDED",privatePayload:{secret:true}};await assert.rejects(client.command("x"));});
test("unresolved original CREATE survives module reload beyond 24h but cannot replay",()=>{
  const persisted=storage(), first=makeClient({},persisted);first.groupPendingCommands.remember("group-management:17",key,{actorId:17,label:"创建新组",intent:{kind:"CREATE",payload:{name:"新组",supervisorAdminId:"17",reason:why}}});const record=first.groupPendingCommands.list()[0];
  class Later extends Date {static now(){return record.createdAt+25*60*60*1000;}}
  const reloaded=makeClient({},persisted,Later), next=reloaded.groupPendingCommands.list()[0];assert.equal(next.commandKey,key);assert.equal(next.intent.payload.reason,why);assert.equal(next.createdAt,record.createdAt);assert.equal(reloaded.canReplayGroupCommand(next),false);assert.equal(reloaded.groupPendingCommands.isDurablyStored(next.fingerprint,key),true);
});
