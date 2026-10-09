import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import {createRequire} from "node:module";
import {parseBulkJob,parseBulkPreview,parseRandomPreview,parseSupportProfile,supportEnhancements,legacySupportDestination,privateMessageRecovery} from "../lib/admin/m-support-enhancements.ts";
import {supportClient,supportObject} from "../lib/admin/m-support-client.ts";
import {boundedUpload} from "../lib/admin/support-image-proxy.ts";
import {createPendingMutationStore} from "../lib/admin/pending-mutation-store.ts";
const now="2026-10-01T01:00:00Z",later="2026-10-01T02:00:00Z";
const group=(data,status="READY")=>({data,status,evaluatedAt:now});
test("timeout GET and PUT share strict parsing without inventing fallback minutes",()=>{
  const source=readFileSync(new URL("../lib/admin/m-client.ts",import.meta.url),"utf8"),parser=source.slice(source.indexOf("export function parseMConversationTimeoutPolicy("),source.indexOf("\nfunction withReason",source.indexOf("export function parseMConversationTimeoutPolicy(")));
  const requests=[],context={supportObject,parseSupportCount:(value)=>{if(!Number.isSafeInteger(value)||value<0)throw new Error("bad count");return value;},currentAdminOperator:()=>"总管",supportRequest:(path,parse,options)=>{requests.push({path,parse,options});return parse(context.response);}};
  runInNewContext(ts.transpileModule(parser.replaceAll("export function","function")+"\nglobalThis.timeout={parseMConversationTimeoutPolicy,fetchMConversationTimeoutPolicy,updateMConversationTimeoutPolicy};",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const policy={policyKey:"GLOBAL",warnMinutes:2,closeMinutes:9,version:7};context.response=policy;
  assert.equal(context.timeout.fetchMConversationTimeoutPolicy().warnMinutes,2);
  context.timeout.updateMConversationTimeoutPolicy(policy,{warnMinutes:3,closeMinutes:10,reason:"调整会话策略"},"original-policy-key");
  assert.equal(requests[0].parse,requests[1].parse);assert.equal(requests[1].options.headers["Idempotency-Key"],"original-policy-key");assert.equal(JSON.parse(requests[1].options.body).expectedVersion,7);
  for(const patch of [{warnMinutes:0},{warnMinutes:1.5},{warnMinutes:31},{closeMinutes:2},{closeMinutes:121},{closeMinutes:null},{version:0.5},{version:"7"},{policyKey:""}]){context.response={...policy,...patch};assert.throws(()=>context.timeout.fetchMConversationTimeoutPolicy(),JSON.stringify(patch));assert.throws(()=>context.timeout.updateMConversationTimeoutPolicy(policy,{warnMinutes:3,closeMinutes:10,reason:"调整会话策略"},"original-policy-key"));}
});

function timeoutHarness(patch={}) {
  const source=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx",import.meta.url),"utf8"),handlers=source.slice(source.indexOf("  const canReadTimeout ="),source.indexOf("\n  return <section",source.indexOf("  const canReadTimeout ="))),records=new Map(),calls=[];
  const policy={policyKey:"GLOBAL",warnMinutes:2,closeMinutes:9,version:7},input={warnMinutes:3,closeMinutes:10,reason:"调整会话策略"};
  const context={session:{role:"superadmin",authorities:["service_m3_read","service_m3_timeout_manage"],operator:"总管"},adminId:12,timeoutPolicy:policy,timeoutInput:input,timeoutSaving:false,timeoutPending:null,timeoutConflict:false,timeoutLatest:null,timeoutReadOnly:false,timeoutIdentityRef:{current:"epoch-1"},identityRef:{current:"epoch-1:customer-0"},useEffect(){},newKey:()=>"original-policy-key",readPending:slot=>records.get(slot),rememberPending:(slot,key,value)=>records.set(slot,JSON.stringify(value)),pendingMessages:{list:()=>[]},pendingTimeoutPolicies:{list:()=>[...records].map(([fingerprint,payload])=>({fingerprint,payload})),remember:(slot,key,value)=>records.set(slot,value.payload),isDurablyStored:()=>true,forget:slot=>records.delete(slot)},isIndeterminateSupportError:cause=>Boolean(cause.unknown),displayAdminError:()=>"读取失败",parseMConversationTimeoutPolicy:row=>{assert.equal(row.policyKey,"GLOBAL");return row;},fetchMConversationTimeoutPolicy:async()=>{calls.push(["GET"]);return {...policy,version:8,warnMinutes:4,closeMinutes:12};},updateMConversationTimeoutPolicy:async(...args)=>{calls.push(["PUT",...args]);return {...policy,version:8};},supportClient:{command:async key=>{calls.push(["COMMAND",key]);return {status:"UNKNOWN"};}},...patch};
  for(const name of ["Open","Policy","Input","Saving","Pending","Conflict","Latest","ReadOnly","Error"])context[`setTimeout${name}`]=value=>{context[`timeout${name}`]=value;};
  runInNewContext(ts.transpileModule(handlers+"\nglobalThis.timeout={canReadTimeout,canTimeout,openTimeout,saveTimeout,checkTimeoutPending,refreshTimeoutLatest};",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return {context,records,calls,policy,input,actions:context.timeout};
}

test("timeout writer requires actual administrator role AND management authority; readers can inspect",async()=>{
  for(const [role,authorities,writable,readable] of [["superadmin",["service_m3_read"],false,true],["support",["service_m3_read","service_m3_timeout_manage"],false,true],["super",["service_m3_read","service_m3_timeout_manage"],true,true],["superadmin",[],false,false]]){
    const h=timeoutHarness({session:{role,authorities}});assert.equal(h.actions.canTimeout,writable);assert.equal(h.actions.canReadTimeout,readable);await h.actions.openTimeout();assert.equal(h.calls.length,readable?1:0);if(!writable){await h.actions.saveTimeout(h.input);assert.equal(h.calls.some(call=>call[0]==="PUT"),false);}
  }
});

test("timeout conflict preserves draft and requires a new baseline; 403 clears private draft and reloads readonly",async()=>{
  const conflict=timeoutHarness({updateMConversationTimeoutPolicy:async()=>{throw {status:409};}});assert.equal(await conflict.actions.saveTimeout(conflict.input),false);assert.equal(conflict.context.timeoutInput,conflict.input);assert.equal(conflict.context.timeoutPolicy.version,7);assert.equal(conflict.context.timeoutLatest.version,8);assert.equal(conflict.context.timeoutConflict,true);assert.equal(conflict.records.size,0);await conflict.actions.saveTimeout(conflict.input);assert.equal(conflict.calls.filter(call=>call[0]==="GET").length,1);
  const denied=timeoutHarness({updateMConversationTimeoutPolicy:async()=>{throw {status:403};}});await denied.actions.saveTimeout(denied.input);assert.equal(denied.context.timeoutReadOnly,true);assert.equal(denied.context.timeoutInput,undefined);assert.equal(denied.context.timeoutPending,null);assert.equal(denied.context.timeoutPolicy.version,8);assert.equal(denied.records.size,0);
  const readDenied=timeoutHarness({fetchMConversationTimeoutPolicy:async()=>{throw {status:403};}});await readDenied.actions.openTimeout();assert.equal(readDenied.context.timeoutReadOnly,true);assert.equal(readDenied.context.timeoutPolicy,null);assert.equal(readDenied.context.timeoutInput,undefined);
});

test("unknown timeout operation never resends PUT or swaps its original key/body; success requires real GET",async()=>{
  const h=timeoutHarness({updateMConversationTimeoutPolicy:async(...args)=>{h.calls.push(["PUT",...args]);throw {unknown:true};}});await h.actions.saveTimeout(h.input);const original=[...h.records.values()][0];assert.equal(h.context.timeoutPending.key,"original-policy-key");
  for(const status of ["UNKNOWN","PROCESSING","PENDING"]){h.context.supportClient.command=async key=>{h.calls.push(["COMMAND",key]);return {status};};await h.actions.checkTimeoutPending();assert.equal([...h.records.values()][0],original);assert.equal(h.context.timeoutPending.input.reason,h.input.reason);}
  await h.actions.saveTimeout({...h.input,reason:"换一个修改理由"});assert.equal(h.calls.filter(call=>call[0]==="PUT").length,1);
  h.context.supportClient.command=async key=>{h.calls.push(["COMMAND",key]);return {status:"SUCCEEDED"};};await h.actions.checkTimeoutPending();assert.equal(h.records.size,0);assert.equal(h.context.timeoutPolicy.version,8);assert.equal(h.context.timeoutPending,null);assert.equal(h.calls.at(-1)[0],"GET");assert.ok(h.calls.filter(call=>call[0]==="COMMAND").every(call=>call[1]==="original-policy-key"));
});

test("timeout known success with failed readback remains recoverable and account-switch late responses cannot mutate state",async()=>{
  const unread=timeoutHarness({fetchMConversationTimeoutPolicy:async()=>{throw {status:409};}});assert.equal(await unread.actions.saveTimeout(unread.input),false);assert.equal(unread.records.size,1);assert.equal(unread.context.timeoutPending.key,"original-policy-key");assert.equal(unread.context.timeoutConflict,false);
  let resolve;const late=timeoutHarness({updateMConversationTimeoutPolicy:()=>new Promise(done=>{resolve=done;})}),saving=late.actions.saveTimeout(late.input);late.context.timeoutIdentityRef.current="epoch-2";late.context.timeoutPolicy=null;late.context.timeoutInput=undefined;resolve({});assert.equal(await saving,false);assert.equal(late.context.timeoutPolicy,null);assert.equal(late.context.timeoutInput,undefined);assert.equal(late.records.size,1);assert.equal(late.calls.length,0);
  const restored=timeoutHarness();restored.records.set("nexion-m3-timeout:12",JSON.stringify({key:"old-policy-key",policy:restored.policy,input:restored.input,operator:"总管"}));await restored.actions.openTimeout();assert.equal(restored.context.timeoutPolicy.version,7);assert.equal(restored.context.timeoutLatest.version,8);assert.equal(restored.context.timeoutPending.policy.version,7);assert.equal(restored.context.timeoutInput.reason,restored.input.reason);
});

test("timeout modal requires a separate old-to-new confirmation and accepts exactly six reason characters",async()=>{
  const source=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-modals.tsx",import.meta.url),"utf8"),require=createRequire(import.meta.url),jsx=require("react/jsx-runtime"),states=[],deps=[],effects=[],saves=[];let cursor=0,effectCursor=0;
  const context={exports:{},require:name=>{if(name==="react")return {useState:initial=>{const index=cursor++;if(!(index in states))states[index]=initial;return [states[index],value=>{states[index]=typeof value==="function"?value(states[index]):value;}];},useEffect:(fn,values)=>{const index=effectCursor++;if(!deps[index]||values.some((value,i)=>value!==deps[index][i]))effects.push(fn);deps[index]=values;}};if(name==="react/jsx-runtime")return jsx;if(name==="../design-kit")return {Modal:"modal",Icon:"icon"};if(name==="./data"||name==="./hd-ui")return {};throw new Error(name);}};
  runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText,context);
  const props={policy:{warnMinutes:2,closeMinutes:9,version:7},canSave:true,saving:false,error:"",onClose(){},onSave:async input=>{saves.push(input);return true;}},render=()=>{cursor=0;effectCursor=0;const result=context.exports.IdlePolicyModal(props);while(effects.length)effects.shift()();return result;},walk=node=>!node||typeof node!=="object"?[]:[node,...[node.props?.children].flat(Infinity).flatMap(walk)];
  let modal=render(),nodes=walk(modal);nodes.find(node=>node.type==="input").props.onChange({target:{value:"3"}});nodes.find(node=>node.type==="textarea").props.onChange({target:{value:"一二三四五"}});modal=render();let save=walk(modal.props.footer).find(node=>node.props?.["data-proof"]);assert.equal(save.props.disabled,true);
  walk(modal).find(node=>node.type==="textarea").props.onChange({target:{value:"一二三四五六"}});modal=render();save=walk(modal.props.footer).find(node=>node.props?.["data-proof"]);assert.equal(save.props.disabled,false);save.props.onClick();assert.equal(saves.length,0);modal=render();assert.ok(JSON.stringify(modal).includes("确认下列变更"));assert.ok(walk(modal).filter(node=>node.type==="input").every(node=>node.props.disabled));save=walk(modal.props.footer).find(node=>node.props?.["data-proof"]);save.props.onClick();await Promise.resolve();assert.equal(saves.length,1);assert.equal(saves[0].reason,"一二三四五六");
  props.pending=true;modal=render();assert.equal(walk(modal.props.footer).find(node=>node.props?.["data-proof"]).props.disabled,true);props.canSave=false;render();modal=render();assert.equal(walk(modal).find(node=>node.type==="textarea").props.value,"");assert.equal(walk(modal).find(node=>node.type==="input").props.value,"2");
});

test("device profile drops idle presentation while keeping live count, individual status, money, dates and pagination",()=>{
  const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8"),profile=read("app/components/domain-views/m-tabs/m3-customer-profile.tsx"),modal=read("app/components/domain-views/m-tabs/m3-modals.tsx"),sessions=read("app/components/domain-views/m-tabs/m3-sessions.tsx");
  assert.doesNotMatch(profile,/idleCount|闲置设备/);assert.doesNotMatch(modal,/profile\.idle|闲置情况/);assert.doesNotMatch(sessions,/p\.idle|闲置情况/);
  for(const field of ["total","onlineCount","hashrateTotal","runtimeStatus","hashrate","dailyUsdt","heartbeatAt","activatedAt","instanceNo"])assert.ok(profile.includes(field),field);assert.match(profile,/pager\(devicePage/);assert.match(profile,/资金流水/);assert.match(profile,/头像|SupportAvatar/);assert.match(profile,/标签与内部备注/);
  const parsed=parseSupportProfile({profile:{identity:group({}),finance:group({byCurrency:[]}),devices:group({total:3,onlineCount:1,idleCount:2}),risk:group({}),annotations:group({}),service:group({}),actions:{}}});assert.equal(parsed.devices.data.idleCount,2);assert.equal(parsed.devices.data.onlineCount,1);
});
test("timeout quota failure forgets only the unsent key and allows one same-draft PUT after storage recovers",async()=>{
  const previous=globalThis.window,values=new Map();let storageWorks=true,nonce=0;
  try {
    globalThis.window={sessionStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(!storageWorks)throw new Error("QuotaExceededError");values.set(key,value);},removeItem:key=>values.delete(key)}};
    const store=createPendingMutationStore({storageKey:"timeout-unsent-quota-check",isValidRecord:row=>typeof row.payload==="string"});store.remember("other-private-message","unrelated-key",{payload:"preserve"});storageWorks=false;
    const h=timeoutHarness({newKey:()=>`timeout-key-${++nonce}`,pendingTimeoutPolicies:store});
    assert.equal(await h.actions.saveTimeout(h.input),false);assert.equal(h.calls.length,0);assert.equal(h.context.timeoutInput,h.input);assert.equal(store.get("nexion-m3-timeout:12"),undefined);assert.equal(store.get("other-private-message"),"unrelated-key");assert.equal(store.list().some(row=>row.commandKey==="timeout-key-1"),false);
    storageWorks=true;assert.equal(await h.actions.saveTimeout(h.input),true);assert.equal(h.calls.filter(call=>call[0]==="PUT").length,1);assert.equal(h.calls.filter(call=>call[0]==="COMMAND").length,0);assert.equal(h.calls.find(call=>call[0]==="PUT")[3],"timeout-key-2");assert.equal(h.calls.find(call=>call[0]==="PUT")[2],h.input);assert.equal(store.get("other-private-message"),"unrelated-key");
    const unknown=timeoutHarness({pendingTimeoutPolicies:store,updateMConversationTimeoutPolicy:async(...args)=>{unknown.calls.push(["PUT",...args]);throw {unknown:true};}});await unknown.actions.saveTimeout(unknown.input);const original=store.list().find(row=>row.fingerprint==="nexion-m3-timeout:12");storageWorks=false;unknown.context.timeoutPending=null;await unknown.actions.saveTimeout(unknown.input);assert.equal(store.get("nexion-m3-timeout:12"),original.commandKey);assert.equal(store.list().find(row=>row.commandKey===original.commandKey).payload,original.payload);assert.equal(unknown.calls.filter(call=>call[0]==="PUT").length,1);assert.equal(unknown.calls.filter(call=>call[0]==="COMMAND").length,0);
  } finally {if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

function actualTimeoutAuthAndRevoke(h) {
  const source=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx",import.meta.url),"utf8"),ast=ts.createSourceFile("chat.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let revoke,stamp,reset;
  function visit(node){ts.forEachChild(node,visit);if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==="revokeCustomer")revoke=node.initializer.arguments[0].getText(ast);if(ts.isExpressionStatement(node)&&node.getText(ast).startsWith("timeoutIdentityRef.current ="))stamp=node.getText(ast);if(ts.isCallExpression(node)&&node.expression.getText(ast)==="useEffect"&&node.arguments[1]?.getText(ast)==="[authEpoch, adminId]")reset=node.arguments[0].getText(ast);}
  visit(ast);assert.ok(revoke&&stamp&&reset);const values=new Map();Object.assign(h.context,{authEpoch:1,scopeGeneration:{current:0},qualificationUnknown:false,all:[{id:"CV-7",customerId:"7"}],selected:{id:"CV-7",customerId:"7"},requestedCustomerId:null,pending:null,firstPending:null,customerIdOf:convo=>convo.customerId,pendingKey:id=>`nexion-m3-dedicated-pending:${id}`,readRecoveries(){},sendAdminTyping(){},watchAdminConversation(){},clearAttachment(){},sessionStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}});
  for(const name of revoke.matchAll(/\b(set[A-Z]\w*)\(/g))if(!(name[1] in h.context))h.context[name[1]]=()=>{};
  runInNewContext(ts.transpileModule(`globalThis.revoke=(${revoke});globalThis.resetTimeoutAuth=(${reset});globalThis.syncTimeoutAuth=()=>{${stamp}};syncTimeoutAuth();`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,h.context);
  return ()=>{h.context.authEpoch=2;h.context.adminId=13;h.context.syncTimeoutAuth();h.context.resetTimeoutAuth();};
}

test("customer revocation during slow timeout GET, PUT or command lookup cannot cancel global recovery or leave it busy",async()=>{
  for(const stage of ["GET","PUT","COMMAND"]){let resolve;const deferred=new Promise(done=>{resolve=done;}),h=timeoutHarness();actualTimeoutAuthAndRevoke(h);h.context.timeoutOpen=true;
    if(stage==="GET")h.context.fetchMConversationTimeoutPolicy=()=>{h.calls.push(["GET"]);return deferred;};
    if(stage==="PUT")h.context.updateMConversationTimeoutPolicy=(...args)=>{h.calls.push(["PUT",...args]);return deferred;};
    if(stage==="COMMAND"){h.context.timeoutPending={key:"original-policy-key",input:h.input,policy:h.policy,operator:"总管"};h.records.set("nexion-m3-timeout:12",JSON.stringify(h.context.timeoutPending));h.context.supportClient.command=key=>{h.calls.push(["COMMAND",key]);return deferred;};}
    const stamp=h.context.timeoutIdentityRef.current,operation=stage==="GET"?h.actions.openTimeout():stage==="PUT"?h.actions.saveTimeout(h.input):h.actions.checkTimeoutPending();h.context.revoke("7",true);assert.notEqual(h.context.identityRef.current,"epoch-1:customer-0");assert.equal(h.context.timeoutIdentityRef.current,stamp);assert.equal(h.context.timeoutOpen,true);
    resolve(stage==="COMMAND"?{status:"SUCCEEDED"}:{...h.policy,version:8});await operation;assert.equal(h.context.timeoutSaving,false,stage);assert.equal(h.context.timeoutPolicy.version,8,stage);assert.equal(h.calls.filter(call=>call[0]==="PUT").length,stage==="PUT"?1:0);assert.equal(h.calls.filter(call=>call[0]==="COMMAND").length,stage==="COMMAND"?1:0);assert.equal(h.records.size,0);
  }
});

test("actual timeout auth stamp and reset reject late GET, PUT and command results after switching accounts",async()=>{
  for(const stage of ["GET","PUT","COMMAND"]){let resolve;const deferred=new Promise(done=>{resolve=done;}),h=timeoutHarness(),switchAccount=actualTimeoutAuthAndRevoke(h);
    if(stage==="GET")h.context.fetchMConversationTimeoutPolicy=()=>deferred;if(stage==="PUT")h.context.updateMConversationTimeoutPolicy=()=>deferred;
    if(stage==="COMMAND"){h.context.timeoutPending={key:"original-policy-key",input:h.input,policy:h.policy,operator:"总管"};h.records.set("nexion-m3-timeout:12",JSON.stringify(h.context.timeoutPending));h.context.supportClient.command=()=>deferred;}
    const operation=stage==="GET"?h.actions.openTimeout():stage==="PUT"?h.actions.saveTimeout(h.input):h.actions.checkTimeoutPending();switchAccount();resolve(stage==="COMMAND"?{status:"SUCCEEDED"}:{...h.policy,version:8});await operation;assert.equal(h.context.timeoutPolicy,null,stage);assert.equal(h.context.timeoutInput,undefined,stage);assert.equal(h.context.timeoutPending,null,stage);assert.equal(h.context.timeoutSaving,false,stage);assert.equal(h.calls.length,0,stage);if(stage!=="GET")assert.equal(h.records.size,1,"previous account command remains unmodified");
  }
});

test("failed recovered timeout compares its original v7 baseline against real current v8 and stays blocked until review",async()=>{
  const h=timeoutHarness(),original={key:"old-policy-key",policy:h.policy,input:h.input,operator:"总管"};h.records.set("nexion-m3-timeout:12",JSON.stringify(original));await h.actions.openTimeout();assert.equal(h.context.timeoutPolicy.version,7);assert.equal(h.context.timeoutLatest.version,8);
  h.context.supportClient.command=async key=>{h.calls.push(["COMMAND",key]);return {status:"FAILED"};};await h.actions.checkTimeoutPending();assert.equal(h.context.timeoutPolicy.version,7);assert.equal(h.context.timeoutLatest.version,8);assert.equal(h.context.timeoutInput.reason,original.input.reason);assert.equal(h.context.timeoutConflict,true);assert.equal(h.records.size,0);await h.actions.saveTimeout(h.input);assert.equal(h.calls.filter(call=>call[0]==="PUT").length,0);
  const source=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx",import.meta.url),"utf8"),ast=ts.createSourceFile("chat.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let review;function visit(node){ts.forEachChild(node,visit);if(ts.isJsxAttribute(node)&&node.name.getText(ast)==="onReviewLatest")review=node.initializer.expression.getText(ast);}visit(ast);assert.ok(review);runInNewContext(ts.transpileModule(`globalThis.review=(${review});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,h.context);h.context.review();assert.equal(h.context.timeoutPolicy.version,8);assert.equal(h.context.timeoutConflict,false);assert.equal(h.context.timeoutInput.reason,original.input.reason);assert.equal(h.calls.filter(call=>call[0]==="PUT").length,0);await h.actions.saveTimeout(h.input);assert.equal(h.calls.filter(call=>call[0]==="PUT").length,1);assert.equal(h.calls.find(call=>call[0]==="PUT")[1].version,8);
});
test("private quota revocation removes private bodies but a fresh page still recovers the durable UNKNOWN timeout without a new PUT or key",async()=>{
  const previous=globalThis.window,values=new Map();let storageWorks=true,minted=0;
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(!storageWorks)throw new Error("QuotaExceededError");values.set(key,value);},removeItem:key=>values.delete(key)};
  const source=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx",import.meta.url),"utf8"),declarations=source.slice(source.indexOf("const pendingKey ="),source.indexOf("export const validCustomerId ="));
  const freshStores=()=>{const context={createPendingMutationStore,Date};runInNewContext(ts.transpileModule(`${declarations}\nglobalThis.stores={pendingMessages,pendingTimeoutPolicies,readPending,rememberPending,recoveryKey};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);return context.stores;};
  try {
    globalThis.window={sessionStorage:storage};const stores=freshStores(),h=timeoutHarness({...stores,newKey:()=>`global-policy-key-${++minted}`,updateMConversationTimeoutPolicy:async(...args)=>{h.calls.push(["PUT",...args]);throw {unknown:true};}});actualTimeoutAuthAndRevoke(h);Object.assign(h.context,{sessionStorage:storage,privateMessageRecovery});
    assert.equal(await h.actions.saveTimeout(h.input),false);const timeoutKey=h.context.timeoutPending.key,original=stores.pendingTimeoutPolicies.list().find(row=>row.commandKey===timeoutKey),timeoutTable=values.get("nexion-admin-m3-timeout-pending-v1");assert.ok(timeoutTable);assert.equal(stores.pendingTimeoutPolicies.isDurablyStored("nexion-m3-timeout:12",timeoutKey),true);
    const secret="PRIVATE_BODY_MUST_NOT_SURVIVE_QUOTA_REVOCATION";stores.rememberPending("nexion-m3-dedicated-pending:12","private-original-key",{key:"private-original-key",clientMessageId:"private-client-message",conversationId:"CV-7",customerId:"7",body:secret,message:{clientMessageId:"private-client-message",text:secret}});assert.ok(values.get("nexion-admin-m3-private-pending-v1").includes(secret));
    storageWorks=false;h.context.revoke("7",true);assert.equal(values.get("nexion-admin-m3-private-pending-v1"),undefined);assert.equal([...values.values()].some(value=>value.includes(secret)),false);assert.equal(values.get("nexion-admin-m3-timeout-pending-v1"),timeoutTable);assert.ok(stores.pendingMessages.list().every(row=>!row.payload.includes(secret)));assert.equal(h.calls.filter(call=>call[0]==="PUT").length,1);
    const refreshed=freshStores();assert.equal(refreshed.pendingMessages.list().length,0);assert.equal(refreshed.pendingTimeoutPolicies.get("nexion-m3-timeout:12"),timeoutKey);assert.equal(refreshed.pendingTimeoutPolicies.list()[0].payload,original.payload);assert.equal(refreshed.pendingTimeoutPolicies.isDurablyStored("nexion-m3-timeout:12",timeoutKey),true);
    const page=timeoutHarness({...refreshed,newKey:()=>{minted++;return "forbidden-second-key";}});await page.actions.openTimeout();assert.equal(page.context.timeoutPending.key,timeoutKey);assert.equal(JSON.stringify(page.context.timeoutPending),original.payload);await page.actions.saveTimeout(page.input);await page.actions.checkTimeoutPending();assert.equal(page.calls.filter(call=>call[0]==="PUT").length,0);assert.equal(page.calls.filter(call=>call[0]==="COMMAND").length,1);assert.equal(page.calls.find(call=>call[0]==="COMMAND")[1],timeoutKey);assert.equal(page.context.timeoutPending.key,timeoutKey);assert.equal(minted,1);assert.equal(refreshed.pendingTimeoutPolicies.list()[0].payload,original.payload);
  } finally {if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
test("funds-flow options use source statuses and reset the exact filter request to page one",async()=>{
  const source=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-customer-profile.tsx",import.meta.url),"utf8"),require=createRequire(import.meta.url),jsx=require("react/jsx-runtime");
  const expected="CREATED PENDING CONFIRMING WAITING_CONFIRMATION OPEN SUBMITTED REVIEW_PENDING REVIEWING EXTENDED_HOLD DELAYED REVIEW_PASSED PENDING_CHAIN FROZEN PROCESSING SENT CHAIN_SUBMITTED CONFIRMED CREDITED PAID SUCCESS POSTED COMPLETED UNSETTLED MANUAL_REVIEW FAILED TX_FAILED TX_ORPHANED DEAD ADDRESS_INVALID REVIEW_REJECTED REJECTED DECLINED EXPIRED ABNORMAL CHARGEBACK DISPUTED CHARGEBACK_REVIEW CHARGEBACK_REFUNDED CHARGEBACK_RECOVERED CHARGEBACK_PARTIAL REFUNDED RETURNED CANCELLED".split(" ");
  const records=[...expected,"UNRECOGNIZED","constructor","toString",null].map((status,i)=>({sourceId:`flow-${i}`,bizNo:`流水${i}`,kind:"DEPOSIT",currency:i%2?"NEX":"USDT",status})),state=[],effects=[],seen=[];
  const walk=node=>!node||typeof node!=="object"?[]:[node,...[node.props?.children].flat(Infinity).flatMap(walk)];
  const profile={identity:group({}),finance:group({byCurrency:[{currency:"USDT"},{currency:"NEX"}]}),devices:group({}),risk:group({}),annotations:group({}),service:group({}),actions:{}};
  let cursor=0;const context={exports:{},AbortController,Date,Intl,JSON,require:name=>{
    if(name==="react")return {useEffect:fn=>effects.push(fn),useRef:value=>({current:value}),useState:initial=>{const index=cursor++;if(!(index in state))state[index]=index===0?profile:index===5?3:index===7?group({records,total:records.length}):initial;return [state[index],value=>{state[index]=typeof value==="function"?value(state[index]):value;}];}};
    if(name==="react/jsx-runtime")return jsx;
    if(name==="@/lib/store/admin-auth")return {useAdminAuth:selector=>selector({session:{adminId:12,authorities:[]},authEpoch:1})};
    if(name==="@/lib/admin/m-support-enhancements")return {supportEnhancements};
    if(name==="@/lib/admin/m-support-client")return {supportClient:{},SupportClientError:class extends Error{}};
    if(name==="@/lib/admin/error-messages")return {displayAdminError:()=>"读取失败"};
    if(name==="../design-kit")return {Modal:props=>jsx.jsx("div",{children:props.children})};
    if(name==="./support-avatar")return {SupportAvatar:props=>jsx.jsx("span",{children:props.name}),customerAvatarPath:id=>`customer/${id}`,advisorAvatarPath:id=>`advisor/${id}`};
    throw new Error(`Unexpected funds-flow dependency ${name}`);
  }};
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
  const render=()=>{cursor=0;effects.length=0;return context.exports.M3CustomerProfile({ctx:{pget:()=>"[]"},customerId:"7",onHistory(){},onRetryMessages(){}});};
  const tree=render(),select=walk(tree).find(node=>node.type==="select"&&walk(node).some(child=>child.type==="option"&&child.props.children==="全部状态")),options=walk(select).filter(node=>node.type==="option");
  assert.ok(select);assert.deepEqual(options.map(node=>node.props.value).filter(Boolean).sort(),expected.toSorted());
  const labels=Object.fromEntries(options.map(node=>[node.props.value,node.props.children]));assert.equal(labels.CONFIRMED,"已确认");assert.equal(labels.CREDITED,"已入账");assert.equal(labels.REVIEW_PENDING,"待审核");assert.equal(labels.REFUNDED,"已退款");assert.notEqual(labels.CONFIRMED,labels.SUCCESS);
  const summaries=walk(tree).filter(node=>node.type==="summary"&&Array.isArray(node.props.children)&&node.props.children.some(value=>typeof value==="string"&&value.startsWith("流水")));
  assert.equal(summaries.length,records.length);for(let i=0;i<records.length;i++)assert.equal(summaries[i].props.children.at(-1),i<expected.length?labels[records[i].status]:"待核对");
  const original=globalThis.fetch;
  try{globalThis.fetch=async url=>{seen.push(new URL(String(url),"http://local.invalid"));return new Response(JSON.stringify({code:0,data:group({records:[],total:0})}),{headers:{"Content-Type":"application/json"}});};
    for(const [status,currency] of [["CONFIRMED","USDT"],["CREDITED","NEX"],["REVIEW_PENDING","USDT"],["REFUNDED","NEX"],["",""]]){
      state[5]=3;state[10]=currency;select.props.onChange({target:{value:status}});render();effects[2]();await new Promise(resolve=>setImmediate(resolve));
      const query=seen.at(-1).searchParams;assert.equal(query.get("status"),status||null);assert.equal(query.get("currency"),currency||null);assert.equal(query.get("pageNum"),"1");assert.equal(query.get("pageSize"),"10");
    }
  }finally{globalThis.fetch=original;}
});
test("unarchive skips only pending replies while archive, close, ticket and batch keep the preflight",async()=>{
  const source=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx",import.meta.url),"utf8"),ready=source.slice(source.indexOf("const checkActionReady = async"),source.indexOf("\n  const closeConversation =")),single=source.slice(source.indexOf("const archiveOne = async"),source.indexOf("\n  const canTimeout =")),others=source.slice(source.indexOf("const closeConversation = async"),source.indexOf("\n  const continueClosed ="));
  for(const [action,archived,patch,allowed] of [["archiveOne",true,{},true],["archiveOne",false,{},false],["closeConversation",false,{},false],["convertToTicket",false,{},false],["archiveBatch",false,{},false],["archiveOne",true,{canWriteM3:false},false],["archiveOne",true,{ownerAdminId:13},false],["archiveOne",true,{agentAdminId:13},false],["archiveOne",true,{assignmentId:null},false],["archiveOne",true,{staleRead:true},false],["archiveOne",true,{actionChecking:true},false]]){
    const conversation={id:"CV-7",customerId:"7",ownerAdminId:patch.ownerAdminId??12,version:9,status:archived?"closed":"open",archived,detailReady:true},confirms=[],writes=[],errors=[],invalid=[];
    const context={canWriteM3:true,adminId:12,pending:null,firstPending:null,actionChecking:false,selected:conversation,writable:!archived,all:[conversation],visible:[conversation],archiveIds:new Set([conversation.id]),activeConversationRef:{current:conversation.id},identityRef:{current:"current"},CONVO_KEY:"I.session.convos",newKey:()=>"original-batch-key",session:{operator:"顾问A"},
      setActionChecking(){},setActionError:value=>errors.push(value),setProfileDetail(){},setArchiveIds(){},lostPermission:()=>false,displayAdminError:()=>"读取失败",ctx:{invalidateScope:(...value)=>invalid.push(value),openActionConfirm:confirm=>confirms.push(confirm),setParam:async(...args)=>{writes.push(args);return true;}},...patch};
    context.supportClient={customerDetail:async()=>{if(patch.staleRead)context.identityRef.current="revoked";return {agentAdminId:patch.agentAdminId??12,assignmentId:"assignment-original",waitingReply:true,...patch};}};
    runInNewContext(ts.transpileModule(`${ready}\n${others}\n${single}\nglobalThis.actions={archiveOne,archiveBatch,closeConversation,convertToTicket};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
    await context.actions[action](conversation);assert.equal(confirms.length,allowed?1:0,`${action} ${JSON.stringify(patch)}`);
    if(allowed){const confirm=confirms[0];assert.equal(confirm.action,"撤销归档");assert.equal(confirm.reasonMin,8);assert.equal(confirm.reasonMax,200);assert.equal(await confirm.run("核对历史归档记录后撤销"),true);assert.equal(JSON.parse(writes[0][1])[0].archived,false);assert.equal(JSON.parse(writes[0][1])[0].status,"closed");assert.equal(JSON.parse(writes[0][1])[0].version,9);assert.equal(writes[0][2].commandKey,"m3:archive:CV-7:9:false");assert.equal(writes[0][2].reason,"核对历史归档记录后撤销");context.identityRef.current="revoked";assert.equal(await confirm.run("核对历史归档记录后撤销"),false);assert.equal(writes.length,1);}
    else assert.equal(writes.length,0);
  }
});
test("M3 and dock reply targets select real customer messages through later maintenance and internal messages",()=>{
  const chat=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx",import.meta.url),"utf8"),dock=readFileSync(new URL("../app/components/domain-views/m-view.tsx",import.meta.url),"utf8");
  const last=chat.slice(chat.indexOf("function lastMessage("),chat.indexOf("\nfunction PrivateImage")),record=chat.slice(chat.indexOf("const record = retry ??"),chat.indexOf("const stored = rememberPending(pendingKey(adminId)"));
  const selectors=[chat.match(/closedReplyCandidates[\s\S]*?const latest = (.*);/)[1],record.match(/const latest = (.*);/)[1],dock.slice(dock.indexOf("const send = async",dock.indexOf("function SessionDock"))).match(/const latest = (.*);/)[1]];
  for(const messages of [[{id:11,sender:"user",sourceSenderType:"USER",text:"客户原消息"},{id:12,sender:"agent",sourceSenderType:"AGENT",intent:"MAINTENANCE",text:"维护"},{id:13,sender:"user",sourceSenderType:"SYSTEM",text:"系统"},{id:14,sender:"user",sourceSenderType:"INTERNAL",text:"内部"}],[{id:12,sender:"agent",text:"维护"},{id:13,sender:"user",sourceSenderType:"SYSTEM"},{id:14,sender:"user",sourceSenderType:"INTERNAL"}]]){
    for(const selector of selectors){const convo={messages},context={convo,conv:convo,selected:convo};runInNewContext(ts.transpileModule(`${last}\nglobalThis.latest=${selector};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);assert.equal(context.latest?.id,messages[0].sender==="user"?11:undefined);}
  }
  const dockSource=dock.slice(dock.indexOf("const send = async",dock.indexOf("function SessionDock")),dock.indexOf("\n  const customer = conv.customer")),input=dockSource.slice(dockSource.indexOf("const latest ="),dockSource.indexOf("\n      if (!pendingDock)"));
  const original={kind:"TEXT",content:"原正文",intent:"SERVICE",clientMessageId:"original-message",expectedAssignmentId:"original-assignment",expectedVersion:2,replyTargets:[{conversationNo:"CV-7",throughMessageId:11}]},context={pendingDock:{payload:JSON.stringify(original)},conv:{id:"CV-OTHER",messages:[{id:99,sender:"user"}]},text:"已改正文",owner:{assignmentId:"new-assignment"},state:{version:10},crypto:{randomUUID:()=>"new-message"}};
  runInNewContext(ts.transpileModule(`${input}\nglobalThis.input=input;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);assert.equal(JSON.stringify(context.input),JSON.stringify(original));
});
test("an owned OPEN conversation exposes explicit old same-customer targets with complete IDs and frozen retries",async()=>{
  const source=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx",import.meta.url),"utf8"),require=createRequire(import.meta.url),jsx=require("react/jsx-runtime"),ast=ts.createSourceFile("chat.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declarations=source.slice(source.indexOf("const requestedConvo ="),source.indexOf("const activeConversationRef=")),last=source.slice(source.indexOf("function lastMessage("),source.indexOf("\nfunction PrivateImage")),identifiers=source.slice(source.indexOf("const customerIdOf ="),source.indexOf("const lostPermission ="));
  let panel,restore,revoke,load,obsoleteClear;function visit(node){ts.forEachChild(node,visit);if(ts.isJsxExpression(node)&&node.expression?.getText(ast).includes("closedCandidateRows.map")&&node.expression.getText(ast).includes("<strong>")&&!panel)panel=node.expression.getText(ast);if(ts.isCallExpression(node)&&node.expression.getText(ast)==="useEffect"){const text=node.getText(ast);if(text.includes('setMetaTarget("")'))restore=text;if(text.includes("[requestedConvo?.id]"))obsoleteClear=text;if(text.includes("void loadConversationDetail(closedCandidateMissing[0]"))load=text;}if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==="revokeCustomer")revoke=node.initializer.arguments[0].getText(ast);}
  visit(ast);assert.ok(panel&&restore&&revoke&&load);
  const closed={id:"CV-OLD",customerId:"7",ownerAdminId:12,status:"closed",detailReady:true,messages:[{id:11,sender:"user",sourceSenderType:"USER",text:"原待回复客户消息"},{id:12,sender:"agent",sourceSenderType:"AGENT",intent:"MAINTENANCE",text:"维护消息"}]},open={id:"CV-OPEN",customerId:"7",ownerAdminId:12,status:"open",detailReady:true,messages:[{id:31,sender:"user",sourceSenderType:"USER",text:"新段客户消息"}],version:4,owner:"顾问A"};
  const visible=[open,closed,{...closed,id:"CV-FOREIGN",customerId:"8"},{...closed,id:"CV-OTHER-OWNER",ownerAdminId:13}],storage={},seen=[];
  const context={exports:{},require:name=>{assert.equal(name,"react/jsx-runtime");return jsx;},AbortController,Date,Number,Set,JSON,validCustomerId:value=>Boolean(value&&/^\d+$/.test(value)),visible,all:visible,requestedCustomerId:null,selectedId:open.id,adminId:12,authEpoch:1,selectedClosedIds:new Set(),closedCandidateError:"",closedCandidateRetry:0,firstPending:null,pending:null,intent:"SERVICE",includeCurrentReply:false,busy:false,canWriteM3:true,conversationsAvailable:true,identityRef:{current:"current"},scopeGeneration:{current:0},
    setSelectedClosedIds:value=>{context.selectedClosedIds=typeof value==="function"?value(context.selectedClosedIds):value;},setIncludeCurrentReply:value=>{context.includeCurrentReply=value;},setIntent:value=>{context.intent=value;},setMetaTarget(){},setContentChoice(){},setSendError(){},setClosedCandidateError(){},setClosedCandidateRetry(){},setRequestedCustomerId(){},useEffect:fn=>fn(),
    sessionStorage:{getItem:key=>storage[key]??null,setItem:(key,value)=>{storage[key]=value;},removeItem:key=>{delete storage[key];}},ctx:{invalidateScope(){}},loadConversationDetail:async id=>seen.push(id),lostPermission:()=>false,displayAdminError:()=>"读取失败"};
  context.qualificationUnknown=false;
  const evaluate=()=>{runInNewContext(ts.transpileModule(`(()=>{${identifiers}\n${last}\n${declarations}\nglobalThis.scope={selected,replyCustomerId,closedCandidateRows,closedCandidateMissing,closedReplyCandidates,closedReplyTargets,closedCandidatesReady,displayedClosedIds};})();`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);Object.assign(context,context.scope);return context.scope;};
  const walk=node=>!node||typeof node!=="object"?[]:[node,...[node.props?.children].flat(Infinity).flatMap(walk)];
  let scope=evaluate();assert.deepEqual(Array.from(scope.closedCandidateRows,row=>row.id),[closed.id]);assert.equal(scope.closedReplyTargets.length,0);
  runInNewContext(ts.transpileModule(`globalThis.panel=(${panel});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText,context);
  const checkbox=walk(context.panel).find(node=>node.type==="input"&&node.props.type==="checkbox");assert.ok(checkbox);assert.equal(checkbox.props.checked,false);checkbox.props.onChange({target:{checked:true}});
  if(obsoleteClear)runInNewContext(ts.transpileModule(obsoleteClear,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  assert.equal(context.selectedClosedIds.has(closed.id),true,"Seeing the OPEN conversation must not discard an explicit old target");scope=evaluate();assert.equal(JSON.stringify(scope.closedReplyTargets),JSON.stringify([{conversationNo:closed.id,throughMessageId:11}]));
  context.visible=visible.map(row=>row.id===closed.id?{...row,detailReady:false,messages:[{id:1,sender:"user",text:"不完整预览"}]}:row);scope=evaluate();assert.equal(scope.closedCandidatesReady,false);assert.equal(scope.closedReplyTargets.length,0);assert.deepEqual(Array.from(scope.closedCandidateMissing),[closed.id]);
  runInNewContext(ts.transpileModule(load,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);await Promise.resolve();assert.deepEqual(seen,[closed.id]);
  context.visible=visible;context.requestedCustomerId="7";scope=evaluate();assert.equal(scope.closedReplyTargets[0].throughMessageId,11);
  const record=source.slice(source.indexOf("const record = retry ??"),source.indexOf("const stored = rememberPending(pendingKey(adminId)")),input=source.slice(source.indexOf("const input = { kind: record.kind"),source.indexOf("\n    let ok = false, submitted = false;"));
  Object.assign(context,{retry:null,selected:open,closedReplyTargets:scope.closedReplyTargets,session:{operator:"顾问A"},body:"处理明确勾选的旧消息",kind:"TEXT",attachmentId:undefined,contentChoice:null,currentProfileDetail:{assignmentId:"assignment-7"},currentVersion:4,crypto:{randomUUID:()=>"original-message"},newKey:()=>"original-key"});
  const compose=()=>runInNewContext(ts.transpileModule(`(()=>{${record}\n${input}\nglobalThis.record=record;globalThis.input=input;})();`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  context.closedReplyTargets=[];compose();assert.equal(JSON.stringify(context.input.replyTargets),JSON.stringify([{conversationNo:open.id,throughMessageId:31}]));context.intent="MAINTENANCE";compose();assert.equal(context.input.replyTargets,undefined);
  context.closedReplyTargets=scope.closedReplyTargets;compose();assert.equal(JSON.stringify(context.input.replyTargets),JSON.stringify([{conversationNo:closed.id,throughMessageId:11}]));context.intent="SERVICE";compose();const original=JSON.stringify(context.input),saved=context.record;assert.equal(saved.conversationId,open.id);assert.equal(saved.message.replyTargets.some(row=>row.conversationNo===closed.id),true);
  Object.assign(context,{retry:saved,closedReplyTargets:[],body:"不能替换原输入",selected:{...open,id:"CV-OTHER",messages:[]},currentVersion:99});compose();assert.equal(context.record,saved);assert.equal(context.record.key,"original-key");assert.equal(JSON.stringify(context.input),original);
  context.selected=open;context.targetKey=open.id;context.visible=visible;storage[`nexion-m3-reply-targets:12:${open.id}`]=JSON.stringify({ids:[closed.id,"CV-FOREIGN","CV-OTHER-OWNER"],include:false,intent:"SERVICE"});runInNewContext(ts.transpileModule(restore,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);assert.deepEqual(Array.from(context.selectedClosedIds),[closed.id]);
  context.selected={...open,id:"CV-OTHER",customerId:"8"};context.targetKey="CV-OTHER";runInNewContext(ts.transpileModule(restore,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);assert.equal(context.selectedClosedIds.size,0);context.selected=open;context.selectedClosedIds=new Set([closed.id]);context.pending=null;
  Object.assign(context,{pendingMessages:{list:()=>[]},readRecoveries(){},setRevokedIds(){},setDrafts(){},setTicketLinks(){},clearAttachment(){},sendAdminTyping(){},watchAdminConversation(){}});for(const name of revoke.matchAll(/\b(set[A-Z]\w*)\(/g))if(!(name[1] in context))context[name[1]]=()=>{};
  runInNewContext(ts.transpileModule(`${identifiers}\nglobalThis.revoke=(${revoke});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);context.revoke("7");assert.equal(context.selectedClosedIds.size,0);assert.equal(context.includeCurrentReply,false);assert.notEqual(context.identityRef.current,"current");
});
test("ticket return links select the exact original M3 conversation regardless of closed or archived state",()=>{
  const tickets=readFileSync(new URL("../app/components/domain-views/m-tabs/m2-tickets.tsx",import.meta.url),"utf8"),chat=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx",import.meta.url),"utf8");
  const linked=tickets.match(/function linkedConversation\([\s\S]*?\n\}/)?.[0],href=tickets.match(/\{conversation \? \(\s*<Link[\s\S]*?href=\{([\s\S]*?)\} style=/)?.[1],entry=chat.match(/useEffect\(\(\) => \{\s*(const params = new URLSearchParams[\s\S]*?)\n  \}, \[\]\);/)?.[1];assert.ok(linked&&href&&entry);
  const ticketContext={encodeURIComponent};runInNewContext(ts.transpileModule(`${linked}\nglobalThis.linked=linkedConversation;globalThis.href=conversation=>(${href});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ticketContext);
  for(const [ticket,no] of [
    [{messages:[{body:"会话号: CV-CONVERTED\n客户原文"}]},"CV-CONVERTED"],
    [{messages:[{body:"即时会话 CV-ESCALATED 已创建"}]},"CV-ESCALATED"],
    [{sourceConversationNo:"CV-SOURCE",messages:[]},"CV-SOURCE"],
    [{sourceConversationNo:"CV-SOURCE",messages:[{body:"会话号: CV-OTHER"}]},"CV-SOURCE"],
  ]){
    const conversation=ticketContext.linked(ticket);assert.ok(conversation);const target=new URL(ticketContext.href(conversation),"http://offline.local");
    let selectedId="CV-OTHER",customerId="2328",screen="list";const selectionRestored={current:false},entryContext={URLSearchParams,window:{location:{search:target.search}},selectionRestored,setSelectedId:value=>{selectedId=value;},setRequestedCustomerId:value=>{customerId=value;},setScreen:value=>{screen=value;}};
    runInNewContext(`(()=>{${entry}})()`,entryContext);assert.equal(selectedId,no);assert.equal(customerId,null);assert.equal(screen,"chat");assert.equal(selectionRestored.current,true);
  }
  assert.equal(ticketContext.linked({sourceConversationNo:"DIRECT",messages:[]}),null);
});
test("canonical conversation conversion receipt reaches the original ticket detail callback",async()=>{
  const client=readFileSync(new URL("../lib/admin/m-client.ts",import.meta.url),"utf8"),chat=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx",import.meta.url),"utf8");
  const method=client.slice(client.indexOf("  convertConversationToTicket("),client.indexOf("  updateSupportAgentProfile(")),callback=chat.match(/onBackendResult: (\(result\) => \{[\s\S]*?\n        \}) \}\);/)?.[1];assert.ok(method&&callback);
  const helpers=["withReason","upper","toBackendConversationStatus","toBackendTicketPriority"].map(name=>{const body=client.match(new RegExp(`(?:export )?function ${name}[^\\n]*\\{[\\s\\S]*?\\n\\}`))?.[0];assert.ok(body);return body.replace(/^export /,"");}).join("\n");
  const canonical={conversation:{conversationNo:"CV-SOURCE",status:"CLOSED",archived:false},ticket:{ticket:{ticketNo:"TK-SOURCE",sourceConversationNo:"CV-SOURCE"},messages:[]}},sent=[];let result=canonical;
  const wire={supportObject,currentAdminOperator:()=>"P3A",apiRequest:async(path,init)=>{sent.push({path,key:init.headers["Idempotency-Key"],body:JSON.parse(init.body)});return result;}};runInNewContext(ts.transpileModule(`${helpers}\nglobalThis.convert={${method}}.convertConversationToTicket;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,wire);
  let links={};const context={requestStamp:"current",identityRef:{current:"current"},conversation:{id:"CV-SOURCE"},adminId:7,ticketLinksKey:id=>`tickets:${id}`,sessionStorage:{setItem(){}},setTicketLinks:fn=>{links=fn(links);}};runInNewContext(ts.transpileModule(`globalThis.receive=${callback};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const input={category:"account",priority:"normal",title:"本轮内部跟进",expectedStatus:"open",expectedVersion:3,assignedAdminId:7,assignedAdminName:"P3A"},reason="本轮生命周期工单跟进";
  context.receive(await wire.convert("CV-SOURCE",input,reason,"original-ticket-key"));assert.equal(links["CV-SOURCE"],"TK-SOURCE");assert.equal(sent[0].path,"/conversations/CV-SOURCE/ticket");assert.equal(sent[0].key,"original-ticket-key");assert.equal(sent[0].body.reason,reason);
  result={ticketNo:"TK-LEGACY"};context.receive(await wire.convert("CV-SOURCE",input,reason,"original-ticket-key"));assert.equal(links["CV-SOURCE"],"TK-LEGACY");assert.deepEqual(sent[1],sent[0]);
  for(const malformed of [{},{ticketNo:""},{...canonical,conversation:{conversationNo:"CV-OTHER"}},{...canonical,ticket:{ticket:{ticketNo:"TK-OTHER",sourceConversationNo:"CV-OTHER"}}}]){result=malformed;await assert.rejects(wire.convert("CV-SOURCE",input,reason,"original-ticket-key"));}
});
test("note deletion transports the confirmation reason and retains its original input after an unknown result",async()=>{
  const profile=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-customer-profile.tsx",import.meta.url),"utf8"),view=readFileSync(new URL("../app/components/domain-views/m-view.tsx",import.meta.url),"utf8"),client=readFileSync(new URL("../lib/admin/m-client.ts",import.meta.url),"utf8");
  const handler=profile.match(/reasonMax:200,run:(.*?)\}\)\}>删除备注<\/button>/)?.[1];assert.ok(handler);
  const reason="本轮误填备注已核对，删除原记录",profileCalls=[],profileContext={r:{id:"19"},annotate:action=>action("CV-7"),ctx:{removeCustomerNote:async(conversationNo,noteId,reason)=>{profileCalls.push({conversationNo,noteId,reason});return true;}}};
  runInNewContext(ts.transpileModule(`globalThis.remove=${handler};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,profileContext);assert.equal(await profileContext.remove(reason),true);assert.deepEqual(profileCalls,[{conversationNo:"CV-7",noteId:"19",reason}]);
  const direct=view.slice(view.indexOf("  const runM3DirectWrite = "),view.indexOf("  // 客户标签(customTags)")),writes=view.slice(view.indexOf("  const addCustomerTag = "),view.indexOf("  const ctx: MCtx = "));
  const methods=client.slice(client.indexOf("  addCustomerTag(conversationNo:"),client.indexOf("  transferConversation(conversationNo:")),withReason=client.match(/function withReason[^\n]*\{[\s\S]*?\n\}/)?.[0];assert.ok(direct&&writes&&methods&&withReason);
  const previous=globalThis.window,disk=new Map(),sent=[],toasts=[];let unknowns=2,nonce=0;
  globalThis.window={sessionStorage:{getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v),removeItem:k=>disk.delete(k)}};
  try {
    const wire={currentAdminOperator:()=>"P3A",apiRequest:async(path,init)=>{sent.push({path,key:init.headers["Idempotency-Key"],body:JSON.parse(init.body)});if(unknowns>0){unknowns--;throw new Error("original response unknown");}return null;}};
    runInNewContext(ts.transpileModule(`${withReason}\nglobalThis.client={${methods}};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,wire);
    const load=()=>{const context={Date,crypto:{randomUUID:()=>`original-key-${++nonce}`},mCommands:createPendingMutationStore({storageKey:"note-reason-check"}),directWriteSlot:fingerprint=>`m3direct|${fingerprint}`,useCallback:fn=>fn,mContentActions:wire.client,reloadMContent:async()=>{},setToast:message=>toasts.push(message),displayAdminError:()=>"offline unknown"};runInNewContext(ts.transpileModule(direct+writes+"\nglobalThis.remove=removeCustomerNote;globalThis.actions={addCustomerTag,removeCustomerTag,addCustomerNote};",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);return context;};
    assert.equal(await load().remove("CV-7","19",reason),false);assert.deepEqual(sent[0].body,{operator:"P3A",reason});assert.equal(sent[0].path,"/conversations/CV-7/customer-notes/19");
    assert.equal(await load().remove("CV-7","19","改写理由也必须先核对原请求"),false);assert.deepEqual(sent[1],sent[0]);assert.match(toasts.at(-1),/继续使用原提交理由/);
    assert.equal(await load().remove("CV-7","19","继续核对原删除请求"),true);assert.deepEqual(sent[2],sent[0]);assert.equal(createPendingMutationStore({storageKey:"note-reason-check"}).list().length,0);
    assert.equal(await load().remove("CV-7","20"),true);assert.equal(sent[3].body.reason,"客服删除客户备注");
    createPendingMutationStore({storageKey:"note-reason-check"}).remember("m3direct|m3:remove-note:CV-7:21","m3-existing-key");
    assert.equal(await load().remove("CV-7","21",reason),true);assert.equal(sent[4].key,"m3-existing-key");assert.equal(sent[4].body.reason,"客服删除客户备注");
    for(const name of ["addCustomerTag","removeCustomerTag","addCustomerNote"]){unknowns=1;const index=sent.length;assert.equal(await load().actions[name]("CV-7","本轮标注"),false);assert.equal(await load().actions[name]("CV-7","本轮标注"),true);assert.deepEqual(sent[index+1],sent[index]);}
  } finally {if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
test("random preview preserves its backend UTC deadline and actual confirm handler across wire formats",async()=>{
  const input={id:"original-preview",count:1,rulesVersion:2,customers:[{id:7,poolVersion:3}],excluded:[]};
  const clock=Date.parse("2026-10-03T00:00:00Z");
  for(const expiry of ["2026-10-03 00:05:00","2026-10-03T00:05:00","2026-10-03T00:05:00Z","2026-10-03T09:05:00+09:00"]){
    const preview=parseRandomPreview({...input,expiresAt:expiry});assert.equal(preview.expiresAt,"2026-10-03T00:05:00.000Z");assert.equal(Date.parse(preview.expiresAt)-clock,300000);
  }
  assert.ok(Date.parse(parseRandomPreview({...input,expiresAt:"2026-10-02 23:59:59"}).expiresAt)<clock);
  assert.throws(()=>parseRandomPreview({...input,expiresAt:"invalid"}));
  const source=readFileSync(new URL("../app/components/domain-views/m-tabs/support-random-assignment.tsx",import.meta.url),"utf8"),handler=source.slice(source.indexOf("  async function confirm("),source.indexOf("  const selected=pending?.customers"));
  class ClockDate extends Date {static now(){return clock;}}
  for(const [expiry,expected]of [["2026-10-03 00:05:00",1],["2026-10-02 23:59:59",0]]){
    let posts=0;const context={busy:false,pending:null,preview:parseRandomPreview({...input,expiresAt:expiry}),ack:true,reason:"明确核对原客户名单",actorId:12,customers:[],mounted:{current:true},Date:ClockDate,crypto:{randomUUID:()=>"original-key"},currentStamp:()=>"1:12",useAdminAuth:{getState:()=>({authEpoch:1,session:{adminId:12}})},commands:{remember(){},isDurablyStored:()=>true,forget(){}},supportClient:{},supportEnhancements:{randomConfirm:async(body,key)=>{posts++;assert.equal(key,"original-key");assert.equal(body.previewId,input.id);return {operationId:key,customers:[{customerId:"7"}]};}},setPending(){},setBusy(){},setError(){},setAck(){},setResult(){},onDone(){}};
    runInNewContext(ts.transpileModule(handler+"\nglobalThis.action=confirm;",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);await context.action();assert.equal(posts,expected);
  }
});
test("first-contact customer profiles require verified scope without inventing a conversation or write target",async()=>{
  const main=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx",import.meta.url),"utf8");
  const gate=main.match(/const firstProfileCustomer = (.*);/)[1];
  const detail={customerId:"7",assignmentId:"9",agentAdminId:12,version:1};
  for(const [patch,allowed] of [[{},true],[{firstDetail:null},false],[{firstDetail:{...detail,assignmentId:null}},false],[{requestedCustomerId:"8"},false],[{adminId:13},false],[{adminId:13,canReviewAll:true},true],[{conversationsAvailable:false},false],[{selected:{id:"CV-7"}},false]]){
    const context={selected:null,conversationsAvailable:true,firstDetail:detail,requestedCustomerId:"7",canReviewAll:false,adminId:12,...patch};
    assert.equal(Boolean(runInNewContext(gate,context)),allowed);
  }
  const require=createRequire(import.meta.url),jsx=require("react/jsx-runtime"),render=require("react-dom/server").renderToStaticMarkup;
  const source=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-customer-profile.tsx",import.meta.url),"utf8");
  const walk=node=>!node||typeof node!=="object"?[]:[node,...[node.props?.children].flat(Infinity).flatMap(walk)];
  for(const mode of ["first","read-only","write"]){
    const calls=[],profile={identity:group({nickname:"已核客户",userNo:"U-7"}),finance:group({byCurrency:[]}),devices:group({}),risk:group(null,"UNKNOWN"),annotations:group({systemTags:[],customTags:[],notes:[]}),service:group({agentAdminId:12,agentName:"当前顾问",conversationCount:mode==="first"?0:1,assignmentState:"BOUND"}),actions:{}};
    let state=0;const session={adminId:12,role:"support",authorities:mode==="read-only"?[]:["service_m3_write"]};
    const context={exports:{},AbortController,Date,Intl,JSON,require:name=>{
      if(name==="react")return {useEffect(){},useRef:value=>({current:value}),useState:initial=>{const index=state++;return [index===0?profile:index===14?"新标签":index===15?"新备注":initial,()=>{}];}};
      if(name==="react/jsx-runtime")return jsx;
      if(name==="@/lib/store/admin-auth")return {useAdminAuth:selector=>selector({session,authEpoch:1})};
      if(name==="@/lib/admin/m-support-enhancements")return {supportEnhancements:{profile:async()=>profile}};
      if(name==="@/lib/admin/m-support-client")return {supportClient:{},SupportClientError:class extends Error{}};
      if(name==="@/lib/admin/error-messages")return {displayAdminError:()=>"读取失败"};
      if(name==="../design-kit")return {Modal:props=>jsx.jsx("div",{children:props.children})};
      if(name==="./support-avatar")return {SupportAvatar:props=>jsx.jsx("span",{children:props.name}),customerAvatarPath:id=>`customer/${id}`,advisorAvatarPath:id=>`advisor/${id}`};
      throw new Error(`Unexpected profile dependency ${name}`);
    }};
    runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
    const ctx={pget:()=>"[]",addCustomerTag:async(id,tag)=>{calls.push({id,tag});return true;}};
    const tree=context.exports.M3CustomerProfile({ctx,customerId:"7",conversation:mode==="first"?undefined:{id:"CV-7",customerId:"7",ownerAdminId:12,owner:"历史显示名",detailReady:true,messages:[]},onHistory(){},onRetryMessages(){}});
    const buttons=walk(tree).filter(node=>node.type==="button"),add=buttons.find(node=>node.props.children==="添加标签"),save=buttons.find(node=>node.props.children==="保存备注");
    assert.equal(add.props.disabled,mode!=="write");assert.equal(save.props.disabled,mode!=="write");
    const html=render(tree);assert.match(html,/已核客户/);assert.match(html,/当前顾问/);
    if(mode==="first"){assert.match(html,/暂无会话/);assert.match(html,/尚未建立服务会话/);assert.match(html,/暂无服务记录/);}
    add.props.onClick();await Promise.resolve();assert.deepEqual(calls,mode==="write"?[{id:"CV-7",tag:"新标签"}]:[]);
  }
});
test("revoked private messages retain only the original recovery locator",()=>{
  for(const original of [{key:"first-key",clientMessageId:"first-message",customerId:"7",body:"private",replyTargets:[{conversationNo:"private-target"}]},{key:"reply-key",conversationId:"CV-7",message:{clientMessageId:"reply-message",text:"private",skuId:"private-sku"},attachmentId:"private-image",body:"private"}]){
    const locator=privateMessageRecovery(original);assert.equal(locator.key,original.key);assert.equal(locator.clientMessageId,original.clientMessageId??original.message.clientMessageId);assert.equal(locator.readOnlyRecovery,true);
    assert.ok(!JSON.stringify(locator).includes("private"));assert.deepEqual(privateMessageRecovery(locator),locator);
  }
  assert.equal(privateMessageRecovery({key:"unknown"}),null);
});
test("service profile preserves exact decimals and separates zero, unknown, forbidden and errors",()=>{
  const fields=["creditedDepositTotal","depositRefundTotal","successfulWithdrawalPrincipalTotal","successfulWithdrawalFeeTotal","successfulWithdrawalNetTotal","processingWithdrawalPrincipalTotal","balance","availableBalance"];
  const finance={byCurrency:[{currency:"USDT",balance:"9007199254740993.12345678",availableBalance:"0",creditedDepositTotal:null,fieldStatuses:{...Object.fromEntries(fields.map(f=>[f,"UNKNOWN"])),balance:"READY",availableBalance:"READY"}}]};
  const profile={identity:group({userNo:"UX-7"}),finance:group(finance),devices:group(null,"ERROR"),risk:group(null,"UNKNOWN"),annotations:group(null,"FORBIDDEN"),service:group({}),actions:{freeze:{allowed:false}}};
  const parsed=parseSupportProfile({profile});
  assert.equal(parsed.finance.data.byCurrency[0].balance,"9007199254740993.12345678");
  assert.equal(parsed.finance.data.byCurrency[0].availableBalance,"0");
  assert.equal(parsed.finance.data.byCurrency[0].creditedDepositTotal,null);
  assert.equal(parsed.devices.status,"ERROR");assert.equal(parsed.annotations.status,"FORBIDDEN");assert.equal(parsed.risk.status,"UNKNOWN");
  assert.throws(()=>parseSupportProfile({profile:{...profile,finance:group({byCurrency:[{...finance.byCurrency[0],balance:0.1}]})}}),/DECIMAL_INVALID/);
  assert.throws(()=>parseSupportProfile({profile:{...profile,finance:group({byCurrency:[{...finance.byCurrency[0],fieldStatuses:{balance:"READY"}}]})}}),/ENUM_INVALID/);
});
test("batch counts never double count unknown and restricted replay discards private material",()=>{
  const job={batchId:"batch-1",actorId:12,state:"RUNNING",version:2,frozenCount:3,visibleCount:2,key:"stable-command-123",contentRestricted:true,content:"private",assetId:"private-asset",counts:{total:3,pending:2,sent:1,failed:0,skipped:0,cancelled:0,unknown:1}};
  const parsed=parseBulkJob(job);assert.equal(parsed.counts.pending-parsed.counts.unknown,1);assert.equal(parsed.content,undefined);assert.equal(parsed.assetId,undefined);
  assert.throws(()=>parseBulkJob({...job,counts:{...job.counts,unknown:3}}),/COUNT_INVALID/);
  assert.throws(()=>parseBulkJob({...job,state:"COMPLETED"}),/STATE_INVALID/);
  assert.throws(()=>parseBulkPreview({selectionId:"preview-1",actorId:12,customers:[{id:7,expectedAssignmentId:9},{id:7,expectedAssignmentId:9}],excluded:[],count:2,evaluatedAt:now,expiresAt:later}),/COUNT_INVALID/);
});
test("canonical SKU pages use skuId while preserving the original UI id contract",async()=>{
  const original=globalThis.fetch,seen=[];
  try{
    for(const [row,id] of [[{skuId:"S1",name:"在售商品"},"S1"],[{id:"legacy-S1",name:"旧样本"},"legacy-S1"],[{skuId:"S1",id:"wrong",name:"在售商品"},"S1"]]){
      globalThis.fetch=async(url)=>{seen.push(String(url));return new Response(JSON.stringify({code:0,data:{records:[row],total:11,pageNum:2,pageSize:10}}),{headers:{"Content-Type":"application/json"}});};
      const result=await supportEnhancements.skus(2,"S1 与 名称");assert.equal(result.total,11);assert.equal(result.pageNum,2);assert.deepEqual(result.records,[{id,name:row.name}]);
    }
    for(const url of seen){const query=new URL(url,"http://offline.local").searchParams;assert.equal(query.get("pageNum"),"2");assert.equal(query.get("pageSize"),"10");assert.equal(query.get("keyword"),"S1 与 名称");}
    globalThis.fetch=async()=>new Response(JSON.stringify({code:0,data:{records:[{skuId:"",id:"fallback",name:"坏编号"}],total:1,pageNum:1,pageSize:10}}),{headers:{"Content-Type":"application/json"}});
    await assert.rejects(supportEnhancements.skus(1,""),/STRING_INVALID/);
  }finally{globalThis.fetch=original;}
});
test("image sending after a recommendation stores only fields for the actual kind and preserves retries",async()=>{
  const source=readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx",import.meta.url),"utf8"),start=source.indexOf("    const record = retry ?? (() => {"),record=source.slice(start,source.indexOf("    const stored = rememberPending",start)),input=source.match(/    const input = \{ kind: record\.kind,[^\n]+\};/)?.[0];assert.ok(start>0&&record&&input);
  const original=globalThis.fetch,seen=[];
  try{
    globalThis.fetch=async(_url,init)=>{seen.push(JSON.parse(init.body));return new Response(JSON.stringify({code:0,data:{conversationNo:"CV-7"}}),{headers:{"Content-Type":"application/json"}});};
    for(const choice of [null,{kind:"SKU",skuId:"S1"},{kind:"LINK",linkTarget:{type:"WALLET",params:{}}}]){
      const context={Date,Number,crypto:{randomUUID:()=>"message-original-123"},newKey:()=>"command-original-123",retry:null,selected:{id:"CV-7",messages:[]},intent:"MAINTENANCE",includeCurrentReply:false,closedReplyTargets:[],session:{operator:"顾问A"},body:"",kind:"IMAGE",attachmentId:"attachment-7",contentChoice:choice,currentProfileDetail:{assignmentId:"9"},currentVersion:2};
      runInNewContext(ts.transpileModule("(()=>{\n"+record+input+"\nglobalThis.stored=record;globalThis.input=input;})();",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
      const stored=JSON.stringify(context.stored);await supportClient.sendConversationReply("CV-7",context.input,context.stored.key);assert.equal(JSON.stringify(context.stored),stored);
      const sent=seen.at(-1);assert.equal(sent.kind,"IMAGE");assert.equal(sent.attachmentId,"attachment-7");assert.equal(sent.skuId,undefined);assert.equal(sent.linkTarget,undefined);assert.equal(sent.clientMessageId,"message-original-123");
      context.retry=context.stored;context.contentChoice={kind:"SKU",skuId:"changed"};runInNewContext(ts.transpileModule("(()=>{\n"+record+input+"\nglobalThis.restored=record;globalThis.restoredInput=input;})();",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);assert.equal(context.restored,context.retry);assert.equal(JSON.stringify(context.restored),stored);await supportClient.sendConversationReply("CV-7",context.restoredInput,context.restored.key);assert.deepEqual(seen.at(-1),sent);
    }
  }finally{globalThis.fetch=original;}
});
test("shared writer transports SKU and legal links through the original message transaction",async()=>{
  const original=globalThis.fetch,seen=[];
  try {globalThis.fetch=async(url,init)=>{seen.push({url,headers:init.headers,body:JSON.parse(init.body)});return new Response(JSON.stringify({code:0,data:{conversationNo:"CV-7",version:3}}),{headers:{"Content-Type":"application/json"}});};
    const common={content:"真实文案",intent:"SERVICE",clientMessageId:"real-message",expectedAssignmentId:"9",expectedVersion:2};
    await supportClient.sendConversationReply("CV-7",{...common,kind:"SKU",skuId:"sku-7"},"stable-key-123");
    await supportClient.createConversation({...common,customerId:"7",kind:"LINK",linkTarget:{type:"WALLET",params:{}}},"stable-key-456");
    assert.equal(seen[0].body.skuId,"sku-7");assert.equal(seen[0].body.body,"真实文案");assert.deepEqual(seen[1].body.linkTarget,{type:"WALLET",params:{}});assert.equal(seen[1].headers.get("Idempotency-Key"),"stable-key-456");
    globalThis.fetch=async(_url,init)=>{assert.equal(init.body.get("clientUploadId"),"upload-123");assert.equal(init.headers.get("Content-Type"),null);return new Response(JSON.stringify({code:0,data:{assetId:"asset-7",status:"READY"}}),{headers:{"Content-Type":"application/json"}});};
    assert.equal((await supportEnhancements.bulkUpload(new File(["png"],"a.png",{type:"image/png"}),"upload-123","stable-key-789")).assetId,"asset-7");
  } finally {globalThis.fetch=original;}
});
test("binary ceiling counts streamed bytes and cancels oversized content",async()=>{
  let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3,4]));},cancel(){cancelled=true;}});
  assert.equal(await boundedUpload({body:stream},3),null);assert.equal(cancelled,true);
  const valid=new ReadableStream({start(c){c.enqueue(new Uint8Array([137,80]));c.enqueue(new Uint8Array([78,71]));c.close();}});
  assert.deepEqual([...new Uint8Array(await boundedUpload({body:valid},4))],[137,80,78,71]);
});
test("retained recovery survives the ordinary TTL and rejects a memory-only command",()=>{
  const previous=globalThis.window,clock=Date.now,values=new Map();let time=1000;
  try{Date.now=()=>time;globalThis.window={sessionStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}};
    const options={storageKey:"support-retained-check",ttlMs:Number.MAX_SAFE_INTEGER-Date.now()};
    const store=createPendingMutationStore(options);store.remember("actor:random","same-key",{previewId:"original-preview"});
    assert.equal(store.isDurablyStored("actor:random","same-key"),true);
    time+=25*60*60*1000;assert.equal(createPendingMutationStore(options).get("actor:random"),"same-key");
    globalThis.window.sessionStorage.setItem=()=>{throw new Error("QuotaExceededError");};
    const blocked=createPendingMutationStore({storageKey:"support-quota-check"});blocked.remember("actor:create","blocked-key");
    assert.equal(blocked.get("actor:create"),"blocked-key");assert.equal(blocked.isDurablyStored("actor:create","blocked-key"),false);
    assert.equal(createPendingMutationStore({storageKey:"support-quota-check"}).get("actor:create"),undefined);
  }finally{Date.now=clock;if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
test("random recovery maps only its proven wire states while rejecting unrelated enums",async()=>{
  const fetch=globalThis.fetch;
  try{for(const [wire,expected] of [["RUNNING","PENDING"],["COMPLETED","SUCCEEDED"]]){globalThis.fetch=async()=>new Response(JSON.stringify({code:0,data:{status:wire,operationId:"original-key",previewId:"original-preview",customers:[{customerId:7,status:"ASSIGNED",agentAdminId:12}]}}));const result=await supportClient.command("original-key");assert.equal(result.status,expected);assert.equal(result.result.operationId,"original-key");}
    globalThis.fetch=async()=>new Response(JSON.stringify({code:0,data:{status:"COMPLETED"}}));await assert.rejects(()=>supportClient.command("unrelated-key"),/SUPPORT_CONTRACT_MALFORMED/);
  }finally{globalThis.fetch=fetch;}
});
test("retiring one old recovery cannot delete another customer's unknown message",()=>{
  const previous=globalThis.window, disk=new Map();globalThis.window={sessionStorage:{getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v),removeItem:k=>disk.delete(k)}};
  try {
    const options={storageKey:"private-locator-isolation"},store=createPendingMutationStore(options);
    store.remember("actor:pending","unknown-A");store.remember("actor:pending","unknown-B");
    store.forget("actor:pending","unknown-A");store.remember("actor:recovery:unknown-A","unknown-A");
    const refreshed=createPendingMutationStore(options);assert.equal(refreshed.get("actor:pending"),"unknown-B");
    refreshed.forget("actor:recovery:unknown-A");assert.equal(createPendingMutationStore(options).get("actor:pending"),"unknown-B");
    refreshed.remember("actor:recovery:unknown-A","unknown-A");refreshed.forget("actor:pending");assert.equal(createPendingMutationStore(options).get("actor:recovery:unknown-A"),"unknown-A");
  } finally {if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
test("legacy TEXT recognizes only exact terminal public targets and preserves the body",()=>{
  for(const [old,current] of [["/store","/devices/pricing"],["/staking","/finance-products/staking"],["/genesis","/finance-products/genesis"]])assert.equal(legacySupportDestination("旧正文 "+old),current);
  for(const text of ["只提到商城","/store?x=1","https://example.com/store","/api/admin/store","javascript:/store","文字 /store 后续","/users/accounts"])assert.equal(legacySupportDestination(text),undefined);
});
test("a real idle-timeout list row preserves the inbox without weakening other message kinds",()=>{
  const source=readFileSync(new URL("../lib/admin/m-client.ts",import.meta.url),"utf8"),adapter=source.slice(source.indexOf("function parseSupportMessageKind("),source.indexOf("function adaptFaq("));
  const context={conversationType:v=>v.toLowerCase(),conversationStatus:v=>v.toLowerCase(),roleKey:v=>v,asTs:v=>Date.parse(v),asArray:v=>Array.isArray(v)?v:[],upper:(v,f)=>v?.toUpperCase()??f,str:(v,f="")=>v==null?f:String(v),num:(v,f=0)=>typeof v==="number"?v:f,adaptCustomerProfile:()=>({nickname:"客户"})};
  runInNewContext(ts.transpileModule(adapter+"\nglobalThis.adapt=adaptConversation;",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const row={id:7,conversationNo:"CV-7",customerId:7,ownerAdminId:12,conversationType:"ADVISOR",status:"CLOSED",unreadCount:0,version:3,updatedAt:now,lastMessageKind:"IDLE_TIMEOUT_CLOSE",archived:false};
  const inbox=[{...row,conversationNo:"CV-6",lastMessageKind:"TEXT"},row].map(context.adapt);assert.equal(inbox.length,2);assert.equal(inbox[1].lastMessageKind,"TEXT");assert.equal(inbox[1].archived,false);assert.equal(inbox[1].status,"closed");
  assert.throws(()=>context.adapt({...row,lastMessageKind:"UNPROVEN_KIND"}),/MESSAGE_PAYLOAD_INVALID/);
});
test("recovery query rejection preserves the original command; only definite POST rejection retires it",async()=>{
  class SupportClientError extends Error{constructor(status){super("rejected");this.status=status;}}
  const selection={selectionId:"original-selection",count:1,expiresAt:new Date(Date.now()+3600000).toISOString()};
  const preview={id:"original-preview",count:1,rulesVersion:2,expiresAt:selection.expiresAt,customers:[{id:"7"}]};
  for(const kind of ["bulk","random"]){
    const source=readFileSync(new URL(`../app/components/domain-views/m-tabs/support-${kind==="bulk"?"bulk-composer":"random-assignment"}.tsx`,import.meta.url),"utf8");
    const name=kind==="bulk"?"submit":"confirm",end=kind==="bulk"?"  async function mutate()":"  const selected=pending?.customers";
    const handler=source.slice(source.indexOf(`  async function ${name}(`),source.indexOf(end));assert.ok(handler.includes("supportClient.command"));
    for(const query of [403,409,"POST",...(kind==="bulk"?[404,"UNKNOWN","PENDING","PROCESSING"]:[])]){
      const calls={get:0,post:0,forget:0},entries=new Map(),payload={selectionId:selection.selectionId,previewId:preview.id,expectedRulesVersion:2,intent:"SERVICE",kind:"TEXT",content:"original body",reason:"original reason"};
      const pending=query==="POST"?null:{fingerprint:"original-slot",commandKey:"original-key",actorId:12,payload,preview,customers:[],readOnlyRecovery:typeof query==="string"||query===404};
      if(pending)entries.set(pending.fingerprint,pending);
      const auth={authEpoch:1,session:{adminId:12}},post=async(_body,key)=>{assert.equal(key,"original-key");calls.post++;throw new SupportClientError(403);};
      const context={busy:false,ready:true,input:payload,pending,selection,preview,reason:payload.reason,ack:true,customers:[],actorId:12,stamp:{current:"1:12"},mounted:{current:true},currentStamp:()=>"1:12",useAdminAuth:{getState:()=>auth},
        crypto:{randomUUID:()=>"original-key"},Date,SupportClientError,isIndeterminateSupportError:()=>false,displayAdminError:e=>e.message,
        commands:{remember:(fp,key,record)=>entries.set(fp,{...record,commandKey:key}),isDurablyStored:()=>true,forget:fp=>{calls.forget++;entries.delete(fp);}},
        supportClient:{command:async key=>{assert.equal(key,"original-key");calls.get++;if(typeof query==="number")throw new SupportClientError(query);return {status:query};}},
        supportEnhancements:{bulkCreate:post,bulkMutate:post,randomConfirm:post},
        setPending(){},setBusy(){},setError(){},setPreview(){}};
      runInNewContext(ts.transpileModule(handler+`\nglobalThis.action=${name};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
      await context.action(query!=="POST");
      assert.deepEqual(calls,query==="POST"?{get:0,post:1,forget:1}:{get:1,post:0,forget:0},`${kind} ${query}`);
      assert.equal(entries.size,query==="POST"?0:1,`${kind} ${query} locator`);
    }
  }
});
test("late action preflight and image decode cannot restore a revoked or unmounted view",async()=>{
  const read=name=>readFileSync(new URL(`../app/components/domain-views/m-tabs/${name}.tsx`,import.meta.url),"utf8"),js=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const m3=read("m3-dedicated-chat"),bulk=read("support-bulk-composer"),ready=m3.slice(m3.indexOf("const checkActionReady = async"),m3.indexOf("\n  const closeConversation ="));
  const revokeStart=m3.indexOf("const revokeCustomer = useCallback("),revokeEnd=m3.indexOf("    const affected",revokeStart);assert.ok(revokeStart>=0&&revokeEnd>revokeStart,"Actual revoke callback boundaries are required");const revoke=m3.slice(m3.indexOf("\n",revokeStart),revokeEnd);
  for(const stale of [false,true]){
    let finish;const detail=new Promise(resolve=>{finish=resolve;});let profiles=0;const checking=[],busy=[];
    const context={activeConversationRef:{current:"CV-2"},actionChecking:false,adminId:1,authEpoch:0,scopeGeneration:{current:0},identityRef:{current:"0:1:0"},qualificationUnknown:false,supportClient:{customerDetail:()=>detail},setActionChecking:v=>checking.push(v),setRecoveryBusy(){},setBusy:v=>busy.push(v),setActionError(){},setProfileDetail(){profiles++;},sendAdminTyping(){},watchAdminConversation(){},ctx:{invalidateScope(){}},lostPermission:()=>false,displayAdminError:()=>""};
    runInNewContext(js(`${ready}\nglobalThis.run=checkActionReady;`),context);
    const result=context.run({customerId:2,id:"CV-2"});if(stale)runInNewContext(js(`(()=>{${revoke}})();`),context);
    finish({agentAdminId:1,assignmentId:"old-assignment",waitingReply:false});assert.equal(await result,!stale);assert.equal(profiles,stale?0:1);assert.deepEqual(checking,[true,false]);assert.deepEqual(busy,stale?[false]:[]);
  }
  const choose=bulk.slice(bulk.indexOf("async function chooseFile("),bulk.indexOf("\n  async function upload()")),cleanup=bulk.match(/useEffect\(\(\)=>\{return\(\)=>\{(generation\.current\+\+;.*?)\};\},\[\]\);/s)?.[1];assert.ok(cleanup);
  let finishDecode,startDecode;const decode=new Promise(r=>{finishDecode=r;}),started=new Promise(r=>{startDecode=r;});let created=0,closed=0;const revoked=[];
  const context={busy:false,imageSelection:{current:0},stamp:{current:"0:1:0"},generation:{current:0},imageRef:{current:{url:"old-blob"}},supportClient:{attachmentPolicy:async()=>({available:true,allowedMimeTypes:["image/png"],maxBytes:100,maxPixels:100})},createImageBitmap:()=>{startDecode();return decode;},setUploadError(){},setChoice(){},setImage(){},URL:{createObjectURL:()=>{created++;return "new-blob";},revokeObjectURL:u=>revoked.push(u)},crypto:{randomUUID:()=>"id"},SupportClientError:class extends Error{},displayAdminError:()=>""};
  runInNewContext(js(`${choose}\nglobalThis.run=chooseFile;`),context);const image=context.run({type:"image/png",size:1});await started;runInNewContext(js(cleanup),context);finishDecode({width:1,height:1,close(){closed++;}});await image;
  assert.equal(created,0);assert.equal(closed,1);assert.deepEqual(revoked,["old-blob"]);assert.equal(context.imageRef.current,null);assert.equal(context.imageSelection.current,2);
});
test("image proxies preserve binary bounds, cancellation, MIME rejection and unknown outcomes",async()=>{
  const load=(kind,fetchStub)=>{
    const seen=[],source=readFileSync(new URL(`../app/api/admin/${kind}/[...path]/route.ts`,import.meta.url),"utf8");
    const context={exports:{},process:{env:{NEXION_SUPPORT_ATTACHMENT_PROXY_MAX_BYTES:"8",NEXION_BACKEND_TIMEOUT_MS:"1000"}},Headers,Response,Request,URL,ReadableStream,Uint8Array,ArrayBuffer,AbortSignal,
      fetch:async(url,init)=>{seen.push({url,init});return fetchStub(url,init);},require:name=>{
        if(name==="next/headers")return {cookies:async()=>({get:name=>name==="unit-admin-cookie"?{value:"unit-token"}:undefined})};
        if(name==="@/lib/admin/require-password-change-cleared")return {ADMIN_TOKEN_COOKIE:"unit-admin-cookie",requirePasswordChangeCleared:()=>null};
        if(name==="@/lib/admin/support-image-proxy")return {boundedUpload};throw new Error(`Unexpected dependency ${name}`);
      }};
    runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
    return {seen,handlers:context.exports};
  };
  const invoke=(proxy,kind,{signal,method="GET",parts=kind==="content"?["support-agents","7","avatar"]:["accounts","7","avatar"]}={})=>proxy.handlers[method](new Request(`http://localhost/api/admin/${kind}/${parts.join("/")}?customerId=23`,{method,signal,...(method==="POST"?{headers:{"Content-Type":"application/json"},body:"{}"}:{})}),{params:Promise.resolve({path:parts})});
  const bytes=new Uint8Array([137,80,78,71,1,2,3,4]);
  for(const kind of ["content","platform"]){
    const upstream=new Response(bytes,{headers:{"Content-Type":"image/png"}});upstream.text=()=>{throw new Error("Binary converted to text");};
    const valid=load(kind,async()=>upstream),binary=await invoke(valid,kind);assert.equal(binary.status,200);assert.deepEqual([...new Uint8Array(await binary.arrayBuffer())],[...bytes]);
    assert.equal(binary.headers.get("Cache-Control"),"no-store");assert.equal(binary.headers.get("X-Content-Type-Options"),"nosniff");assert.equal(valid.seen[0].init.redirect,"manual");assert.equal(valid.seen[0].init.headers.get("Authorization"),"Bearer unit-token");assert.ok(valid.seen[0].url.endsWith("?customerId=23"));
    let cancelled=false;const oversized=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(5));c.enqueue(new Uint8Array(5));},cancel(){cancelled=true;}}),{headers:{"Content-Type":"image/png"}});
    assert.equal((await invoke(load(kind,async()=>oversized),kind)).status,502);assert.equal(cancelled,true);
    const stopped=new AbortController();stopped.abort();const preAborted=load(kind,async()=>new Response(bytes));assert.equal((await invoke(preAborted,kind,{signal:stopped.signal})).status,503);assert.equal(preAborted.seen.length,0);
    const active=new AbortController();let enter;const entered=new Promise(r=>{enter=r;});
    const aborting=load(kind,(_url,init)=>new Promise((_resolve,reject)=>{assert.ok(init.signal);init.signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});enter();}));
    const pending=invoke(aborting,kind,{signal:active.signal});await entered;active.abort();assert.equal((await pending).status,503);assert.equal(aborting.seen[0].init.signal.aborted,true);
    for(const status of [200,409,422]){const body=JSON.stringify({code:status===200?0:status,message:"pending",data:null}),uncertain=load(kind,async()=>new Response(body,{status,headers:{"Content-Type":"application/json","X-Nexion-Upstream-Outcome":"unknown"}}));
      const result=await invoke(uncertain,kind,{method:"POST",parts:kind==="content"?["support-workbench","bulk"]:["accounts"]});assert.equal(result.status,status);assert.equal(result.headers.get("X-Nexion-Upstream-Outcome"),"unknown");assert.equal(await result.text(),body);
    }
  }
  const rejected=await invoke(load("content",async()=>new Response("event: update\ndata: private\n\n",{headers:{"Content-Type":"text/event-stream"}})),"content");assert.equal(rejected.status,502);assert.equal(rejected.headers.get("Content-Type"),"application/json");
});
