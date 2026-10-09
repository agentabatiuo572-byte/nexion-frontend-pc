import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const personal=fs.readFileSync('app/components/domain-views/m-tabs/m1-personal-workbench.tsx','utf8');
const pool=fs.readFileSync('app/components/domain-views/m-tabs/m1-supervisor-pool.tsx','utf8');
const storeSource=fs.readFileSync('lib/admin/pending-mutation-store.ts','utf8');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function storage(){const rows=new Map();return{rows,quota:false,getItem:k=>rows.get(k)??null,setItem(k,v){if(this.quota)throw Error('quota');rows.set(k,v);},removeItem:k=>rows.delete(k)};}
function shared(storage,clock=Date){const module={exports:{}};vm.runInNewContext(compile(storeSource),{module,exports:module.exports,window:{sessionStorage:storage},console,Date:clock});return module.exports;}
function callback(name,globals){const ast=ts.createSourceFile('personal.tsx',personal,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let source;function walk(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)source=node.initializer.getText(ast);ts.forEachChild(node,walk);}walk(ast);assert.ok(source,name);const code=compile(`module.exports = (${source});`),module={exports:{}};vm.runInNewContext(code,{module,...globals});return module.exports;}
function personalHarness({quota=false,writeError,receipt='UNKNOWN',factsFailure=false,mismatch=false}={}){
 const persisted=storage(),stores=shared(persisted),calls=[],auth={session:{adminId:17},authEpoch:1};
 const maintenanceCommands=stores.createPendingMutationStore({storageKey:'maintenance',retainExpiredRecords:true}),transferCommands=stores.createPendingMutationStore({storageKey:'transfer',retainExpiredRecords:true});persisted.quota=quota;
 const detail={customerId:'71',assignmentId:'91',agentAdminId:17,assignmentVersion:4,maintenanceVersion:7};
 const globals={detail,adminId:17,maintenanceAction:'resume',saving:false,maintenancePending:null,transferPending:null,permission:'supervisor',transferSaving:false,transferAgents:[{adminId:21,enabled:true,assignmentEligible:true}],transferTarget:21,transferReason:'真实正式转绑操作理由',reason:'真实维护操作理由',detailsGeneration:{current:1},maintenanceCommands,transferCommands,crypto:{randomUUID:()=> 'original-key'},actorStamp:()=>`${auth.session.adminId}:${auth.authEpoch}`,useAdminAuth:{getState:()=>auth},window:{dispatchEvent(){}},Event,Error,verifySupportTransfer:async()=>{calls.push('facts');if(factsFailure)throw {status:403};if(mismatch)throw Error('mismatch');},supportClient:{setMaintenance:async()=>{calls.push('maintenance-write');if(writeError)throw writeError;return {customerId:'71',assignmentId:'91',enabled:true};},transfer:async()=>{calls.push('transfer-write');if(writeError)throw writeError;return {};},command:async key=>{calls.push(['query',key]);return{status:receipt};},customerDetail:async()=>{calls.push('facts');if(factsFailure)throw {status:403};return{...detail,maintenanceEnabled:receipt==='FAILED'?false:true,maintenanceVersion:receipt==='FAILED'?7:8,assignmentId:mismatch?'92':'91'};}},closeDetail:()=>calls.push('close'),openDetail:async()=>{},invalidateCustomerOnDenied:()=>false};
 for(const setter of ['setSaveError','setMaintenancePending','setSaving','setMaintenanceAction','setReason','setRowsRefresh','setNotice','setSnapshot','setTransferError','setTransferSaving','setTransferPending','setTransferOpen'])globals[setter]=()=>{};
 return {maintenanceCommands,transferCommands,calls,globals,invoke:name=>callback(name,globals)()};
}
test('personal maintenance and transfer require durable intent before dispatch',async()=>{
 for(const name of ['saveMaintenance','submitTransfer']){const h=personalHarness({quota:true});await h.invoke(name);assert.equal(h.calls.filter(x=>typeof x==='string'&&x.endsWith('-write')).length,0);}
});
test('all personal direct denial and conflict outcomes retain original evidence and never replay',async()=>{
 for(const name of ['saveMaintenance','submitTransfer'])for(const status of [403,409]){const h=personalHarness({writeError:{status}});await h.invoke(name);await h.invoke(name);const store=name==='saveMaintenance'?h.maintenanceCommands:h.transferCommands;assert.equal(store.list().length,1);assert.equal(store.list()[0].commandKey,'original-key');assert.equal(h.calls.filter(x=>typeof x==='string'&&x.endsWith('-write')).length,1);assert.ok(h.calls.includes('close'));}
});
test('personal terminal success or failure needs current authorized matching facts before forget',async()=>{
 for(const name of ['checkMaintenance','checkTransfer'])for(const receipt of ['SUCCEEDED','FAILED'])for(const failure of ['none','denied','mismatch']){
  const h=personalHarness({receipt,factsFailure:failure==='denied',mismatch:failure==='mismatch'});const store=name==='checkMaintenance'?h.maintenanceCommands:h.transferCommands;
  const payload=name==='checkMaintenance'?{customerId:'71',assignmentId:'91',expectedVersion:7,enabled:true,reason:'原维护操作理由'}:{targetAgentAdminId:21,customers:[{id:'71',expectedAssignmentId:'91',expectedVersion:4}],reason:'原转绑操作理由'};
  store.remember('fingerprint','original-key',{actorId:17,payload});const record=store.list()[0];await callback(name,h.globals)(record);
  assert.ok(h.calls.includes('facts'));assert.equal(store.list().length,failure==='none'?0:1);assert.deepEqual(h.calls.find(x=>Array.isArray(x)),['query','original-key']);
 }
});
test('opt-in expired evidence preserves valid old dates and keeps default expiry and malformed rejection',()=>{
 const persisted=storage();class Clock extends Date{static now(){return 100000000;}}const stores=shared(persisted,Clock);
 const valid={fingerprint:'fp',commandKey:'key',createdAt:1,expiresAt:2,actorId:17,payload:{reason:'原理由'}};
 for(const retainExpiredRecords of [true,false]){persisted.rows.set('test',JSON.stringify({key:valid}));assert.equal(stores.createPendingMutationStore({storageKey:'test',retainExpiredRecords}).list().length,retainExpiredRecords?1:0);}
 for(const bad of [{createdAt:-1},{createdAt:1.5},{expiresAt:1},{expiresAt:2.5},{expiresAt:'2'},{commandKey:'other'},{fingerprint:''}]){persisted.rows.set('bad',JSON.stringify({key:{...valid,...bad}}));assert.equal(stores.createPendingMutationStore({storageKey:'bad',retainExpiredRecords:true}).list().length,0);}
});
test('generic personal recovery never rehydrates stored reason or target into editable detail UI',()=>{
 assert.doesNotMatch(personal,/setReason\(pending\?\.payload\.reason/);assert.doesNotMatch(personal,/setTransferReason\(existing\?\.payload\.reason/);assert.doesNotMatch(personal,/setTransferTarget\(existing\?\.payload\.targetAgentAdminId/);
 assert.match(personal,/查询维护结果/);assert.match(personal,/查询转绑结果/);
});

test('stale personal handlers cannot dispatch a changed reason or target while an original customer command awaits query',async()=>{
 for(const name of ['saveMaintenance','submitTransfer']){const h=personalHarness({writeError:{status:409}});await h.invoke(name);h.globals.reason='另一条真实维护调整理由';h.globals.transferReason='另一条真实正式转绑理由';h.globals.detail={...h.globals.detail,assignmentVersion:5};await h.invoke(name);assert.equal(h.calls.filter(x=>typeof x==='string'&&x.endsWith('-write')).length,1);}
});
