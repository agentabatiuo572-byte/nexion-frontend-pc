import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as contract from '../lib/admin/phone-replacement-contract.ts';
import * as routes from '../lib/admin/phone-replacement-routes.ts';
import * as registry from '../lib/admin/high-ops-registry.ts';
import * as outcome from '../lib/admin/outcome-classification.ts';
import * as a2Policy from '../lib/admin/a2-policy.ts';
import {createPendingMutationStore, claimPendingCommandOwner} from '../lib/admin/pending-mutation-store.ts';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function load(file, modules={}, globals={}) {
  const exports={};
  const js=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',...Object.keys(globals),js)(id=>{
    if (id in modules) return modules[id];
    throw new Error(`Unexpected import: ${id}`);
  },exports,...Object.values(globals));
  return exports;
}
function storage() {
  const cells=new Map();
  const sessionStorage={getItem:k=>cells.get(k)??null,setItem:(k,v)=>cells.set(k,String(v)),removeItem:k=>cells.delete(k),key:i=>[...cells.keys()][i]??null,get length(){return cells.size;}};
  globalThis.window={sessionStorage};claimPendingCommandOwner('71');return sessionStorage;
}
let sequence=0;
function client(fetch) {
  return load('lib/admin/phone-replacement-client.ts',{
    '@/lib/admin/error-messages':{guardedFetch:fetch},
    '@/lib/admin/outcome-classification':outcome,
    '@/lib/admin/pending-mutation-store':{createPendingMutationStore},
    '@/lib/admin/a2-client':{createA2CommandKey:()=>`phone-original-${++sequence}`},
    '@/lib/admin/phone-replacement-contract':contract,
  });
}
const ok=data=>Response.json({code:0,data});
const receipt={operationId:'PRO123',commandType:'PHONE_GRANT_ISSUE',status:'SUCCEEDED',submittedAt:1000,completedAt:1001,originalResult:{status:'ACTIVE',expiresAt:5000},currentResource:{status:'CONSUMED',expiresAt:5000},auditRef:'audit-1'};
const body={requestId:'PRQ1',expectedBindingVersion:3,waiveCount:true,waiveInterval:false,evidenceRef:'PRV1',reason:'已核实用户关联客服记录',confirmed:true};
const policy={available:true,allowReplacement:false,minReplacementIntervalDays:0,replacementWindowDays:30,maxReplacementsInWindow:2,policyVersion:8};

test('complete policy and unknown facts never become permissive defaults',()=>{
  assert.deepEqual(contract.parsePhonePolicy(policy),policy);
  for(const patch of [{policyVersion:undefined},{replacementWindowDays:0},{maxReplacementsInWindow:0},{minReplacementIntervalDays:'0'},{available:undefined}]) assert.equal(contract.parsePhonePolicy({...policy,...patch}),null);
  const unknown={available:false,allowReplacement:null,minReplacementIntervalDays:null,replacementWindowDays:null,maxReplacementsInWindow:null,policyVersion:8};
  assert.deepEqual(contract.parsePhonePolicy(unknown),unknown);
  assert.equal(contract.parsePhonePolicy({...unknown,allowReplacement:false}),null);
  for(const values of [['0','0','2'],['0','30','101'],['1.5','30','2'],['1e2','30','2'],[String(Number.MAX_SAFE_INTEGER),'30','2']]) assert.ok(contract.phoneDraftError(values));
  assert.equal(contract.phoneDraftError(['0','365','100']),'');
  assert.equal(Object.keys(contract.phonePolicyValues(false,['0','30','2'])).length,4);
});

test('fine permissions distinguish checker and grant/revoke',()=>{
  assert.equal(contract.canReadPolicyReceipt(['device_e6_read','platform_a2_operation_approve']),true);
  for(const rights of [[],['device_e6_read'],['platform_a2_operation_approve']])assert.equal(contract.canReadPolicyReceipt(rights),false);
  assert.equal(contract.phoneCommandAllowed('PHONE_GRANT_REVOKE',[contract.PHONE_GRANT]),false);
  assert.equal(contract.phoneCommandAllowed('PHONE_VERIFY',[contract.PHONE_REVOKE]),false);
});

for(const response of [()=>Response.json({code:503,message:'UNAVAILABLE',data:null}),()=>Response.json({}),()=>Response.json({code:'0'}),()=>Response.json({code:0,data:{}}),()=>Response.json({code:0,data:receipt},{status:503}),()=>Response.json({code:0,data:receipt},{status:302}),()=>{throw new Error('lost response');}]) {
  test(`unknown write retains frozen request and only GET recovery (${response.toString()})`,async()=>{
    const store=storage(),calls=[];
    const c=client(async(url,init)=>{calls.push({url,init});return response();});
    const saved=c.preparePhoneCommand(71,'42','PHONE_GRANT_ISSUE','PRQ1',body);
    await assert.rejects(c.submitPhoneCommand(saved),error=>error.unknownOutcome===true);
    assert.equal(c.pendingPhoneCommands(71,'42').length,1);
    assert.throws(()=>c.preparePhoneCommand(71,'42','PHONE_GRANT_ISSUE','PRQ1',body),/还没确认/);
    const raw=JSON.parse(store.getItem('nexion-admin-phone-commands-v1'));
    raw[saved.commandKey].createdAt=Date.now()-3*86400000;raw[saved.commandKey].expiresAt=Date.now()-2*86400000;
    store.setItem('nexion-admin-phone-commands-v1',JSON.stringify(raw));
    const reloaded=client(async(url,init)=>{calls.push({url,init});return ok(receipt);});
    const pending=reloaded.pendingPhoneCommands(71,'42');assert.equal(pending.length,1);
    assert.deepEqual(pending[0].body,body);
    const result=await reloaded.recoverPhoneCommand(pending[0]);
    assert.equal(result.originalResult.status,'ACTIVE');assert.equal(result.currentResource.status,'CONSUMED');
    assert.equal(calls.filter(c=>c.init.method==='POST').length,1);
    assert.equal(calls[1].init.method,'GET');assert.ok(calls[1].url.includes(saved.commandKey));
    assert.equal(reloaded.pendingPhoneCommands(71,'42').length,0);
  });
}

test('wrapped unknown 404 preserves key and verification recovers without re-attesting',async()=>{
  storage();let result=Response.json({code:404,message:'OPERATION_RESULT_UNKNOWN',data:null});const calls=[];
  const c=client(async(url,init)=>{calls.push({url,init});return result;});
  const row=c.preparePhoneCommand(71,'42','PHONE_VERIFY','PRQ1',{reason:'已人工核实关联客服记录',confirmed:true});
  assert.equal(await c.recoverPhoneCommand(row),null);assert.equal(c.pendingPhoneCommands(71,'42').length,1);
  result=ok({evidenceRef:'PRV1',requestId:'PRQ1',supportRef:'C1',verifiedBy:71,verifiedAt:100});
  assert.equal((await c.recoverPhoneCommand(row)).evidenceRef,'PRV1');
  assert.ok(calls.every(c=>c.init.method==='GET'&&c.url.includes('/profiles/42/phone-replacement-verifications/by-idempotency-key?')));
});

test('explicit conflict preserves editable input; permission loss retains recovery evidence',async()=>{
  storage();const c=client(async()=>Response.json({code:409,message:'BINDING_VERSION_CHANGED',data:{reason:'账户绑定已变化，请刷新当前绑定。'}}));
  const row=c.preparePhoneCommand(71,'42','PHONE_GRANT_ISSUE','PRQ1',body);
  await assert.rejects(c.submitPhoneCommand(row),e=>!e.unknownOutcome&&e.status===409);
  assert.equal(c.pendingPhoneCommands(71,'42').length,0);assert.deepEqual(row.body,body);
  const d=client(async()=>Response.json({code:403,message:'PERMISSION_DENIED',data:null}));
  const retained=d.preparePhoneCommand(71,'42','PHONE_GRANT_ISSUE','PRQ1',body);
  await assert.rejects(d.submitPhoneCommand(retained),e=>e.status===403);
  assert.equal(d.pendingPhoneCommands(71,'42').length,1);assert.equal(d.pendingPhoneCommands(72,'42').length,0);
  claimPendingCommandOwner('72');assert.equal(d.pendingPhoneCommands(71,'42').length,0);
});

test('storage failure stops before any POST',async()=>{
  storage();globalThis.window.sessionStorage.setItem=()=>{throw new Error('quota');};let calls=0;const c=client(async()=>{calls++;return ok(receipt);});
  assert.throws(()=>c.preparePhoneCommand(71,'42','PHONE_GRANT_ISSUE','PRQ1',body),/无法保存/);assert.equal(calls,0);
});

test('cross-account request rows and incomplete envelopes fail closed',async()=>{
  storage();const c=client(async()=>ok({items:[{requestId:'PRQ1',requestNo:'1',userId:43,targetInstallationId:'i',bindingVersion:1,status:'PENDING',supportLinkStatus:'LINKED',expiresAt:100,createdAt:1}],pageNum:1,pageSize:10,hasMore:false}));
  await assert.rejects(c.fetchPhoneRequests('42'),/当前账号不匹配/);
  assert.throws(()=>contract.parsePhoneOverview({eligibility:{...policy}}),/不完整/);
});

const guard=load('lib/admin/require-password-change-cleared.ts');
function proxy(file,{token='fixture-token',upstream=async()=>ok(receipt)}={}) {
  const calls=[];
  const api=load(file,{'next/headers':{cookies:async()=>({get:name=>name==='nexion_admin_token'&&token?{value:token}:undefined})},'@/lib/admin/require-password-change-cleared':guard,'@/lib/admin/phone-replacement-routes':routes,'@/lib/admin/support-image-proxy':{},'@/lib/admin/account-avatar-contract':{avatarProxyRoute:()=>null}},{process:{env:{NEXION_BACKEND_URL:'http://fixture-backend'}},fetch:async(url,init)=>{calls.push({url,init});return upstream(url,init);}});
  return {calls,request:(parts,method='GET',query='',body)=>api[method](new Request(`http://fixture/api/${parts.join('/')}?${query}`,{method,...(body?{body,headers:{'Content-Type':'application/json','Idempotency-Key':'original-key'}}:{})}),{params:Promise.resolve({path:parts})})};
}

test('real user proxy allows only exact phone paths/methods and preserves status/body/key/query',async()=>{
  const g=proxy('app/api/admin/users/[...path]/route.ts',{upstream:async()=>Response.json({code:409,data:{conflictType:'BINDING_VERSION_CHANGED'}},{status:409})});
  const target=['profiles','42','phone-replacement-requests','PRQ1','close'];
  assert.equal((await g.request(target,'GET')).status,405);assert.equal(g.calls.length,0);
  const response=await g.request(target,'POST','',JSON.stringify(body));assert.equal(response.status,409);assert.equal((await response.json()).data.conflictType,'BINDING_VERSION_CHANGED');
  assert.equal(g.calls[0].init.headers.get('Idempotency-Key'),'original-key');assert.equal(g.calls[0].init.headers.get('Authorization'),'Bearer fixture-token');assert.deepEqual(JSON.parse(g.calls[0].init.body),body);
  for(const parts of [['profiles','42','phone-binding','extra'],['profiles','42','phone-replacement-grants','..','revoke'],['profiles','bad','phone-binding']])assert.equal((await g.request(parts)).status,404);
  const query='idempotencyKey=a%2Bb';await g.request(['profiles','42','phone-replacement-verifications','by-idempotency-key'],'GET',query);assert.ok(g.calls.at(-1).url.endsWith(query));
});

test('operation proxy only reads, keeps error payload and requires authentication',async()=>{
  const g=proxy('app/api/admin/phone-replacement-operations/[...path]/route.ts');
  assert.equal((await g.request(['PRO123','extra'])).status,404);assert.equal(g.calls.length,0);
  await g.request(['by-idempotency-key'],'GET','commandType=PHONE_GRANT_ISSUE&idempotencyKey=original');assert.ok(g.calls[0].url.endsWith('commandType=PHONE_GRANT_ISSUE&idempotencyKey=original'));
  assert.equal(g.calls[0].init.body,undefined);
  const denied=proxy('app/api/admin/phone-replacement-operations/[...path]/route.ts',{token:null});assert.equal((await denied.request(['PRO123'])).status,401);assert.equal(denied.calls.length,0);
});

test('E6 proxy rejects wrong methods for aggregate/batch/compatibility routes',async()=>{
  const g=proxy('app/api/admin/devices/[...path]/route.ts');
  assert.equal((await g.request(['compute-config'],'PATCH')).status,405);
  assert.equal((await g.request(['compute-config','params'],'POST')).status,405);
  assert.equal((await g.request(['compute-config','params','E.compute.phoneBinding.allowReplacement'],'GET')).status,405);
  assert.equal(g.calls.length,0);
});

test('A2 four-field command and compatibility command keep expected version, unrelated command unchanged',()=>{

  const values=contract.phonePolicyValues(false,['0','30','2']);
  const batch=registry.findHighOp('e6_compute_config_batch');assert.deepEqual(batch.buildCommand({values,expectedPolicyVersion:8}).params,{values,expectedPolicyVersion:8});
  assert.equal(batch.buildTargets({values}).length,4);
  assert.equal(registry.findHighOp('e6_compute_config').buildCommand({paramKey:'E.compute.phoneBinding.allowReplacement',value:'off',expectedPolicyVersion:8}).params.expectedPolicyVersion,8);
  assert.equal('expectedPolicyVersion' in registry.findHighOp('g2_exchange_param').buildCommand({paramKey:'x',value:'y',expectedPolicyVersion:8}).params,false);
});

function a2Client(fetch) {
  return load('lib/admin/a2-client.ts',{'@/lib/admin/error-messages':{guardedFetch:fetch,formatAdminApiError:(m,f)=>m||f},'@/lib/admin/outcome-classification':outcome,'@/lib/admin/phone-calibration-client':{},'@/lib/admin/a2-policy':a2Policy});
}
test('phone A2 strict mode retains HTTP 200 business-5xx, malformed and missing ticket outcomes',async()=>{
  for(const data of [{code:503,data:null},{},{code:'0'},{code:0,data:{}},{code:0,data:null}]) {
    let posts=0;const c=a2Client(async(_url,init)=>{posts++;assert.equal(init.headers.get('Idempotency-Key'),'original-proposal');return Response.json(data);});
    await assert.rejects(c.createA2OperationProposal({command:{domain:'E',op:'e6_compute_config_batch',params:{}}},'original-proposal',true),c.isA2OutcomeUncertainError);
    assert.equal(posts,1);
  }
});
test('phone A2 success means proposal only and structured version conflict is readable',async()=>{
  const c=a2Client(async()=>ok({id:'A2-1',action:'策略发布',obj:'phone',status:'pending'}));
  assert.equal((await c.createA2OperationProposal({},'original',true)).status,'pending');
  const d=a2Client(async()=>Response.json({code:409,message:'POLICY_VERSION_CHANGED',data:{conflictType:'POLICY_VERSION_CHANGED',reason:'策略已更新'}}));
  await assert.rejects(d.createA2OperationProposal({},'original',true),e=>e.status===409&&e.details.reason==='策略已更新'&&!d.isA2OutcomeUncertainError(e));
});
test('compatibility E6 writes require preserved version/key and batch cannot mix another parameter group',async()=>{
  const calls=[];
  const c=load('lib/admin/e6-client.ts',{'@/lib/admin/error-messages':{guardedFetch:async(url,init)=>{calls.push({url,init});return ok({});},formatAdminApiError:m=>m},'@/lib/admin/e456-overview-contract':{},'@/lib/admin/installer-url':{} });
  await assert.rejects(c.updateE6Param('E.compute.phoneBinding.allowReplacement','off','理由足够用于测试','actor'),/版本/);
  const context={expectedPolicyVersion:8,commandKey:'fixed-key'};
  await c.updateE6Param('E.compute.phoneBinding.allowReplacement','off','理由足够用于测试','actor',context);
  assert.equal(JSON.parse(calls[0].init.body).expectedPolicyVersion,8);assert.equal(calls[0].init.headers.get('Idempotency-Key'),'fixed-key');
  await assert.rejects(c.updateE6Params({'E.compute.phoneBinding.allowReplacement':'off','E.compute.continuityFullHours':'12'},'理由足够用于测试','actor',context),/独立提交/);
  assert.equal(calls.length,1);
});

test('A2 exact original-key lookup has no recent-log dependency and never posts',async()=>{
  const calls=[];let data={code:0,data:{id:'old-ticket',action:'发布',obj:'phone',status:'approved'}};
  const c=a2Client(async(url,init)=>{calls.push({url,init});return Response.json(data);});
  assert.equal((await c.fetchA2ProposalByKey('older-than-500-logs')).id,'old-ticket');
  assert.ok(calls[0].url.endsWith('/operations/proposals/by-idempotency-key?idempotencyKey=older-than-500-logs'));assert.equal(calls[0].init.body,undefined);
  data={code:404,message:'OPERATION_RESULT_UNKNOWN',data:null};assert.equal(await c.fetchA2ProposalByKey('absent'),null);
});
test('A2 exact recovery proxy allows only GET and preserves original key query',async()=>{
  const g=proxy('app/api/admin/platform/[...path]/route.ts');const path=['audit','operations','proposals','by-idempotency-key'];
  assert.equal((await g.request(path,'POST')).status,405);assert.equal(g.calls.length,0);
  await g.request(path,'GET','idempotencyKey=original%2Bkey');assert.ok(g.calls[0].url.endsWith('/audit/operations/proposals/by-idempotency-key?idempotencyKey=original%2Bkey'));assert.equal(g.calls[0].init.method,'GET');
  assert.equal((await g.request([...path,'extra'])).status,404);
});
test('policy structured errors expose readable field labels without engineering codes',()=>{
  assert.equal(contract.phoneConflictMessage({fieldErrors:{'E.compute.phoneBinding.replacementWindowDays':'滚动窗口须为1至365天'}}),'滚动窗口：滚动窗口须为1至365天');
  assert.equal(contract.phoneConflictMessage({conflictType:'BINDING_VERSION_CHANGED'}),'绑定已变化，请刷新当前账号');
});

// Execute complete production handlers, including their result acceptance, against the real client.
// Only React setters and the fetch transport are supplied by this harness; classification/storage stay real.
function phonePanelHandlers(fetch) {
  storage();
  const api=client(fetch),state={receipt:null,receiptIndependent:false,message:'',verification:null,error:''};
  const source=ts.createSourceFile('panel.tsx',read('app/components/domain-views/c-tabs/phone-replacement-panel.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const component=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='AccountPhonePanel');
  const names=['acceptResult','query','recover','submit'];
  const functions=component.body.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text));
  assert.equal(functions.length,names.length);
  const scope={...api,phoneCommandAllowed:contract.phoneCommandAllowed,
    live:{current:true},mutation:{current:false},canGrant:true,canRevoke:true,
    owner:71,userId:'42',rights:[contract.PHONE_GRANT,contract.PHONE_REVOKE],
    lookup:'other-account-operation',lookupMode:'id',lookupType:'PHONE_GRANT_ISSUE',
    confirm:{type:'PHONE_VERIFY',target:'PRQ1'},confirmed:true,reason:'人工核实关联客服记录',overview:{},
    setBusy:()=>{},setConfirm:()=>{},setReason:()=>{},syncPending:()=>{},load:()=>{},loadHistory:()=>{},
    fail:failure=>{state.error=failure.message;},
    ...Object.fromEntries(Object.keys(state).map(key=>[`set${key[0].toUpperCase()}${key.slice(1)}`,value=>{state[key]=value;}]))};
  const code=ts.transpileModule(functions.map(node=>node.getText(source)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return {state,api,...new Function(...Object.keys(scope),`${code}\nreturn {query,recover,submit};`)(...Object.values(scope))};
}

for(const outcome of ['missing','failed'])test(`phone panel clears previous independent receipt before current-account query is ${outcome}`,async()=>{
  let release;const calls=[];
  const panel=phonePanelHandlers(async(url,init)=>{
    calls.push({url,init});
    if(calls.length===1)return ok(receipt);
    return new Promise((resolve,reject)=>{release=()=>outcome==='missing'?resolve(Response.json({code:404,data:null})):reject(new Error('network failed'));});
  });
  await panel.query();
  assert.equal(panel.state.receipt.operationId,receipt.operationId);assert.equal(panel.state.receiptIndependent,true);
  const next=panel.query('current-account-operation');
  assert.equal(panel.state.receipt,null);assert.equal(panel.state.message,'');
  release();await next;
  assert.equal(panel.state.receipt,null);
  assert.equal(panel.state.receiptIndependent,true,'no nonexistent result may relabel the former receipt');
  assert.ok(outcome==='missing'?panel.state.message.includes('待核实'):panel.state.error);
  assert.ok(calls.every(call=>call.init.method==='GET'));
});

for(const action of ['submit','recover'])test(`phone panel ${action} verification never relabels an earlier independent receipt`,async()=>{
  const evidence={evidenceRef:'PRV1',requestId:'PRQ1',supportRef:'C1',verifiedBy:71,verifiedAt:100};
  let release;const calls=[];
  const panel=phonePanelHandlers(async(url,init)=>{
    calls.push({url,init});
    if(calls.length===1)return ok(receipt);
    return new Promise(resolve=>{release=()=>resolve(ok(evidence));});
  });
  await panel.query();assert.equal(panel.state.receipt.operationId,receipt.operationId);
  const saved=action==='recover'?panel.api.preparePhoneCommand(71,'42','PHONE_VERIFY','PRQ1',{reason:'人工核实关联客服记录',confirmed:true}):null;
  const next=action==='recover'?panel.recover(saved):panel.submit();
  assert.equal(panel.state.receipt,null);assert.equal(panel.state.message,'');
  release();await next;
  assert.deepEqual(panel.state.verification,evidence);assert.equal(panel.state.receipt,null);
  assert.equal(panel.state.receiptIndependent,true);
  assert.equal(calls[1].init.method,action==='recover'?'GET':'POST');
  assert.equal(panel.api.pendingPhoneCommands(71,'42').length,0);
});

function phoneAccountReadHandlers(fetch) {
  storage();
  const api=client(fetch),state={overview:{private:true},requests:{items:[]},history:{items:[{private:true}]},
    receipt,verification:{evidenceRef:'PRV1'},confirm:{target:'PRQ1'},pendingRows:[],message:'原操作成功',
    error:'',historyError:'',denied:false,loading:false,historyLoading:false,selected:''};
  const source=ts.createSourceFile('panel.tsx',read('app/components/domain-views/c-tabs/phone-replacement-panel.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const component=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='AccountPhonePanel');
  const names=['syncPending','fail','load','loadHistory'];
  const handlers=component.body.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>names.includes(d.name.getText(source))));
  assert.equal(handlers.length,names.length);
  const scope={...api,useCallback:fn=>fn,live:{current:true},generation:{current:0},historyGeneration:{current:0},
    owner:71,userId:'42',requestPage:1,kind:'GRANT',page:1,
    ...Object.fromEntries(Object.keys(state).map(key=>[`set${key[0].toUpperCase()}${key.slice(1)}`,value=>{state[key]=typeof value==='function'?value(state[key]):value;}]))};
  const code=ts.transpileModule(handlers.map(node=>node.getText(source)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return {state,api,...new Function(...Object.keys(scope),`${code}\nreturn {load,loadHistory};`)(...Object.values(scope))};
}
const phoneOverview={eligibility:{policy,serverNow:1000,historyComplete:true,canReplace:false,usedCount:0,
  remainingCount:2,binding:null,grant:null,blockedReasons:[]},sessions:[],pendingOperations:[],pendingRequest:null};
const phonePage={items:[],pageNum:1,pageSize:10,hasMore:false};
function assertAccountFactsHidden(state) {
  assert.equal(state.denied,true);
  for(const key of ['overview','requests','history','receipt','verification','confirm'])assert.equal(state[key],null,key);
  assert.deepEqual(state.pendingRows,[]);assert.equal(state.message,'');assert.equal(state.historyError,'');
  assert.equal(state.loading,false);assert.equal(state.historyLoading,false);
  assert.match(state.error,/不存在或不在可访问范围/);
}
for(const failedEndpoint of ['phone-binding','phone-replacement-requests'])test(`account ${failedEndpoint} 404 clears prior private facts and rejects late history without deleting command`,async()=>{
  let releaseHistory;const calls=[];
  const panel=phoneAccountReadHandlers(async(url,init)=>{
    calls.push({url,init});
    if(url.includes('/phone-replacements?'))return new Promise(resolve=>{releaseHistory=()=>resolve(ok({...phonePage,items:[{grantId:'late-private'}]}));});
    if(url.includes(`/${failedEndpoint}`))return Response.json({code:404,message:'SUPPORT_CUSTOMER_NOT_FOUND',data:null},{status:404});
    return ok(url.includes('/phone-binding')?phoneOverview:phonePage);
  });
  const saved=panel.api.preparePhoneCommand(71,'42','PHONE_GRANT_ISSUE','PRQ1',body);
  panel.state.pendingRows=[saved];
  const late=panel.loadHistory();await panel.load();assertAccountFactsHidden(panel.state);
  releaseHistory();await late;assertAccountFactsHidden(panel.state);
  assert.deepEqual(panel.api.pendingPhoneCommands(71,'42'),[saved]);
  assert.ok(calls.every(c=>c.init.method==='GET'));
});
test('account history 404 rejects the late overview and request pair and clears the displayed receipt',async()=>{
  let releaseOverview,releaseRequests;
  const panel=phoneAccountReadHandlers(async url=>{
    if(url.includes('/phone-binding'))return new Promise(resolve=>{releaseOverview=()=>resolve(ok(phoneOverview));});
    if(url.includes('/phone-replacement-requests?'))return new Promise(resolve=>{releaseRequests=()=>resolve(ok(phonePage));});
    return Response.json({code:404,message:'USER_NOT_FOUND',data:null},{status:404});
  });
  const saved=panel.api.preparePhoneCommand(71,'42','PHONE_GRANT_ISSUE','PRQ1',body);
  const late=panel.load();await panel.loadHistory();assertAccountFactsHidden(panel.state);
  releaseOverview();releaseRequests();await late;assertAccountFactsHidden(panel.state);
  assert.deepEqual(panel.api.pendingPhoneCommands(71,'42'),[saved]);
});
test('normal account refresh accepts current facts and retains durable recovery evidence',async()=>{
  const panel=phoneAccountReadHandlers(async url=>ok(url.includes('/phone-binding')?phoneOverview:phonePage));
  const saved=panel.api.preparePhoneCommand(71,'42','PHONE_GRANT_ISSUE','PRQ1',body);
  await Promise.all([panel.load(),panel.loadHistory()]);
  assert.equal(panel.state.denied,false);assert.deepEqual(panel.state.overview,phoneOverview);
  assert.deepEqual(panel.state.history,phonePage);assert.deepEqual(panel.state.pendingRows,[saved]);
  assert.deepEqual(panel.api.pendingPhoneCommands(71,'42'),[saved]);
});
test('independent original-operation 404 stays unknown and retains its exact durable command',async()=>{
  const calls=[];
  const panel=phonePanelHandlers(async(url,init)=>{calls.push({url,init});return Response.json({code:404,message:'OPERATION_RESULT_UNKNOWN',data:null},{status:404});});
  const saved=panel.api.preparePhoneCommand(71,'42','PHONE_GRANT_ISSUE','PRQ1',body);
  await panel.recover(saved);
  assert.equal(panel.state.receipt,null);assert.match(panel.state.message,/结果仍待核实/);assert.equal(panel.state.error,'');
  assert.deepEqual(panel.api.pendingPhoneCommands(71,'42'),[saved]);
  assert.ok(calls.every(c=>c.init.method==='GET'));assert.equal(calls.length,1);
});
