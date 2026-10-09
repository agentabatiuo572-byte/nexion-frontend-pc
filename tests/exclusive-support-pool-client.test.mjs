import test from 'node:test';
import assert from 'node:assert/strict';
import { supportClient, setSupportPoolRoute, SupportClientError, readSupportPoolCustomer, verifySupportTransfer } from '../lib/admin/m-support-client.ts';
const envelope = (data, status = 200) => new Response(JSON.stringify({code: status === 200 ? 0 : status, data, message: 'OK'}), {status});
const original = globalThis.fetch;
const row = {customerId: 71, reason: 'NO_INVITER', enteredAt: '2026-10-09T00:00:00Z', version: 4};
const page = records => ({records, total: records.length, pageNum: 1, pageSize: 8});
test('candidate page preserves historical roster and rejects unknown or contradictory assignment authority', async () => {
  const agent = {adminId: 7, name: '专属客服', seatType: 'MANAGER', serviceTypes: ['support'], status: 'enabled', enabled: true, assignmentEligible: true, busy: true, assignedUserCount: 4, maxConcurrent: 10, version: 1};
  try {
    for (const changes of [{}, {status:'disabled',assignmentEligible:false}, {assignmentEligible:false}]) {
      globalThis.fetch=async()=>envelope(page([{...agent,...changes}]));
      const result=(await supportClient.agents({pageNum:1,pageSize:8})).records[0];
      assert.equal(result.assignmentEligible, changes.assignmentEligible ?? true);
      assert.equal(result.status, changes.status ?? 'enabled');
      assert.equal(result.enabled, true); assert.equal(result.busy, true); assert.equal(result.assignedUserCount, 4);
    }
    for (const changes of [{assignmentEligible:undefined},{assignmentEligible:null},{assignmentEligible:'true'},{status:'UNKNOWN'},{status:'disabled'},{enabled:false}]) {
      globalThis.fetch=async()=>envelope(page([{...agent,...changes}]));
      await assert.rejects(supportClient.agents({pageNum:1,pageSize:8}), /SUPPORT_CONTRACT_MALFORMED/);
    }
  } finally {globalThis.fetch=original;}
});
test('pool route observations preserve nonzero unassigned facts, confirmed absence and unknown', async () => {
  try {
    for (const fact of [{routeState:'AVAILABLE',routeId:'91',routeGroupId:null,routeVersion:7}, {routeState:'ABSENT',routeId:null,routeGroupId:null,routeVersion:null}, {routeState:'UNKNOWN',routeId:null,routeGroupId:null,routeVersion:null}]) {
      globalThis.fetch=async()=>envelope(page([{...row,...fact}]));
      const result=(await supportClient.bindingPool({pageNum:1,pageSize:8})).records[0];
      for(const key of Object.keys(fact))assert.equal(result[key],fact[key]);
    }
    globalThis.fetch=async()=>envelope(page([row]));
    assert.equal((await supportClient.bindingPool({pageNum:1,pageSize:8})).records[0].routeState,'UNKNOWN');
    for(const fact of [{routeState:'ABSENT',routeId:null,routeGroupId:null,routeVersion:0}, {routeState:'UNKNOWN',routeId:'91',routeGroupId:null,routeVersion:7}, {routeState:'AVAILABLE',routeId:'91',routeGroupId:null,routeVersion:0}, {routeState:'AVAILABLE',routeId:'91',routeGroupId:null,routeVersion:7.5}]) {
      globalThis.fetch=async()=>envelope(page([{...row,...fact}]));
      await assert.rejects(supportClient.bindingPool({pageNum:1,pageSize:8}),/SUPPORT_CONTRACT_MALFORMED/);
    }
  }finally{globalThis.fetch=original;}
});
test('pool and candidate paging forward the same validated groupId without forging a mode', async()=>{
  const urls=[];
  try {
    globalThis.fetch=async(url,init)=>{urls.push(new URL(url,'http://localhost'));assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');return envelope(page([]));};
    await supportClient.bindingPool({pageNum:1,pageSize:8,groupId:8});await supportClient.agents({pageNum:1,pageSize:100,groupId:8});
    assert.ok(urls.every(url=>url.searchParams.get('groupId')==='8'&&!url.searchParams.has('mode')));
    for(const groupId of [0,-1,NaN,1.5,Number.MAX_SAFE_INTEGER+1]){
      await assert.rejects(async()=>supportClient.bindingPool({pageNum:1,pageSize:8,groupId}),/MALFORMED/);
      await assert.rejects(async()=>supportClient.agents({pageNum:1,pageSize:100,groupId}),/MALFORMED/);
    }
    assert.equal(urls.length,2);
  }finally{globalThis.fetch=original;}
});
test('group route PATCH carries frozen route/group versions, key and reason; 403 is never a success',async()=>{
  const payload={targetGroupId:'8',expectedRouteVersion:7,sourceGroupVersion:null,targetGroupVersion:11,reason:'真实客服调整组范围原因'};
  let seen;
  try {
    globalThis.fetch=async(url,init)=>{seen={url,init};return envelope({id:'92',customerId:'71',groupId:'8',version:8});};
    const result=await setSupportPoolRoute('71',payload,'fixed-key-r11');
    assert.equal(result.version,8);assert.equal(seen.url,'/api/admin/content/support-agents/groups/customer-routes/71');
    assert.equal(seen.init.method,'PATCH');assert.equal(seen.init.headers.get('Idempotency-Key'),'fixed-key-r11');
    assert.deepEqual(JSON.parse(seen.init.body),{...payload,targetGroupId:8});
    globalThis.fetch=async()=>envelope(null,403);
    await assert.rejects(setSupportPoolRoute('71',payload,'fixed-key-r11'),error=>error instanceof SupportClientError&&error.status===403);
    globalThis.fetch=async()=>envelope({id:'92',customerId:'72',groupId:'8',version:8});
    await assert.rejects(setSupportPoolRoute('71',payload,'fixed-key-r11'),/acknowledgement/);
    await assert.rejects(async()=>setSupportPoolRoute('71',{...payload,targetGroupVersion:null},'fixed-key-r11'),/targetVersion/);
  }finally{globalThis.fetch=original;}
});

const customerFacts = overrides => ({customer:{customerId:71,assignmentId:91,assignmentVersion:4,agentAdminId:17,preferenceVersion:7,nickname:null,activityStatus:'UNKNOWN',windowStatus:'UNKNOWN',enabled:true,due:null,openCycleId:null,lastEffectiveAt:null,nextDueAt:null,waitingReply:false,firstContact:false,pendingReplyCount:0,pendingConversationNo:null,pendingThroughMessageId:null,...overrides}});
test('real supportRequest recovery reads authorized current assignments and preserves failed unassigned group scope',async()=>{
 const bound={targetAgentAdminId:21,customers:[{id:'71',expectedAssignmentId:'91',expectedVersion:4}],reason:'正式转绑操作理由'},seen=[];
 try {
  globalThis.fetch=async(url,init)=>{seen.push([url,init]);return envelope(customerFacts({assignmentId:92,assignmentVersion:5,agentAdminId:21}));};await verifySupportTransfer(bound,'SUCCEEDED');assert.match(seen[0][0],/support-workbench\/customers\/71$/);assert.equal(seen[0][1].credentials,'same-origin');assert.equal(seen[0][1].cache,'no-store');
  for(const facts of [{assignmentId:91,agentAdminId:21},{assignmentId:92,agentAdminId:22},{customerId:72,assignmentId:92,agentAdminId:21}]){globalThis.fetch=async()=>envelope(customerFacts(facts));await assert.rejects(verifySupportTransfer(bound,'SUCCEEDED'),/FACTS_CHANGED/);}
  globalThis.fetch=async()=>envelope(customerFacts({}));await verifySupportTransfer(bound,'FAILED');globalThis.fetch=async()=>envelope(customerFacts({assignmentVersion:5}));await assert.rejects(verifySupportTransfer(bound,'FAILED'),/FACTS_CHANGED/);
  globalThis.fetch=async()=>envelope(null,403);await assert.rejects(verifySupportTransfer(bound,'SUCCEEDED'),e=>e.status===403);
  const unassigned={...bound,customers:[{id:'71',expectedAssignmentId:null,expectedVersion:4}]};globalThis.fetch=async(url,init)=>{seen.push([url,init]);return envelope(page([row]));};await verifySupportTransfer(unassigned,'FAILED',8);assert.equal(new URL(seen.at(-1)[0],'http://local').searchParams.get('groupId'),'8');assert.equal(new URL(seen.at(-1)[0],'http://local').searchParams.get('keyword'),'71');
  globalThis.fetch=async()=>envelope(page([]));await assert.rejects(readSupportPoolCustomer('71',8),/FACTS_UNAVAILABLE/);
 }finally{globalThis.fetch=original;}
});
