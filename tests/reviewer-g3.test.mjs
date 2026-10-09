import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'), ts=createRequire(import.meta.url)('typescript');
function load(file, dependencies={}, globals={}) {
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(name.endsWith('.css'))return {};if(name in dependencies)return dependencies[name];throw Error(name);},URL,URLSearchParams,AbortController,Date,Event,crypto,console,...globals});
  return module.exports;
}
function storage() {const rows=new Map();return {rows,quota:false,getItem:key=>rows.get(key)??null,setItem(key,value){if(this.quota)throw Error('quota');rows.set(key,value);},removeItem:key=>rows.delete(key),get length(){return rows.size;},key:i=>[...rows.keys()][i]??null};}
const item={customerId:'71',version:4,reason:'NO_INVITER',routeState:'AVAILABLE',routeId:'91',routeGroupId:'8',routeVersion:7};
const groups=[{id:'8',name:'来源组',status:'ENABLED',version:11},{id:'9',name:'目标组',status:'ENABLED',version:12}];
const candidate={adminId:21,name:'专属客服甲',version:4,enabled:true,serviceTypes:['advisor'],seatType:'DEDICATED',assignedUserCount:0,maxConcurrent:5,busy:false};
const reason='独立审查真实操作理由';
function nodes(value){if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object')return [];return [value,...nodes(value.props?.children),...nodes(value.props?.footer)];}
function text(value){if(Array.isArray(value))return value.map(text).join('');return value&&typeof value==='object'?text(value.props?.children):value??'';}
function harness({quota=false,routeError,receipt='UNKNOWN',factsFailure=false,factsMismatch=false}={}) {
  const persisted=storage(), stores=new Map(), calls=[];
  const window={sessionStorage:persisted,dispatchEvent(){}}, pending=load('lib/admin/pending-mutation-store.ts',{}, {window});
  let activeHooks; const auth={session:{adminId:17},authEpoch:1}, useAdminAuth=selector=>selector(auth);useAdminAuth.getState=()=>auth;
  const imports={react:{useState:x=>activeHooks.state(x),useEffect:(f,d)=>activeHooks.effect(f,d),useRef:x=>activeHooks.ref(x)},'react/jsx-runtime':{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key}),Fragment:'fragment'},'../design-kit':{Modal:'Modal'},'./support-random-assignment':{SupportRandomAssignment:()=>null,hasPendingRandomAssignment:()=>false},'./support-avatar':{SupportAvatar:()=>null,advisorAvatarPath:()=>''}};
  const supportClient={overview:async()=>({scope:{mode:'ALL'}}),bindingPool:async()=>{calls.push('pool');return {records:[receipt === 'SUCCEEDED' ? {...item,routeGroupId:null,routeVersion:8}:item],total:1,pageNum:1,pageSize:8};},agents:async()=>({records:[candidate],total:1,pageNum:1,pageSize:100}),transfer:async()=>{calls.push('transfer');throw Error('unknown');},command:async()=>({status:receipt})};
  const groupClient={groups:async()=>groups,detail:async id=>{calls.push('detail');return {group:groups.find(g=>g.id===id)};},command:async()=>({status:receipt})};
  const dependency=new Proxy(imports,{has:(obj,name)=>name in obj||name.includes('m-support-client')||name.includes('support-group-client')||name.includes('pending-mutation-store')||name.includes('admin-auth')||name.includes('shell-authorities')||name.includes('business-time'),get:(obj,name)=>{if(name in obj)return obj[name];if(name.includes('m-support-client'))return {supportClient,isIndeterminateSupportError:()=>false,readSupportPoolCustomer:async()=>{calls.push('pool');if(factsFailure)throw{status:403};if(factsMismatch)return{...item,routeGroupId:'9',routeVersion:90};return receipt === 'SUCCEEDED' ? {...item,routeGroupId:null,routeVersion:8}:item;},verifySupportTransfer:async()=>{calls.push('transfer-facts');if(factsFailure)throw{status:403};if(factsMismatch)throw Error('mismatch');},setSupportPoolRoute:async()=>{calls.push('route');if(routeError)throw routeError;return {};}};if(name.includes('support-group-client'))return {supportGroupClient:groupClient};if(name.includes('pending-mutation-store'))return {createPendingMutationStore:options=>{const store=pending.createPendingMutationStore(options);stores.set(options.storageKey,store);return store;}};if(name.includes('admin-auth'))return {useAdminAuth};if(name.includes('shell-authorities'))return {adminShellSessionKey:()=>`${auth.authEpoch}:${auth.session.adminId}`};if(name.includes('business-time'))return {parseBusinessTime:Date.parse};}});
  const exports=load('app/components/domain-views/m-tabs/m1-supervisor-pool.tsx',dependency,{window});
  function mount(component,props){const cells=[],effects=[];let cursor=0,dirty=true,tree;function render(){let count=0;do{cursor=0;dirty=false;const pendingEffects=[];activeHooks={state(initial){const i=cursor++;if(!(i in cells))cells[i]=typeof initial==='function'?initial():initial;return [cells[i],next=>{cells[i]=typeof next==='function'?next(cells[i]):next;dirty=true;}];},ref(initial){const i=cursor++;return cells[i]??(cells[i]={current:initial});},effect(run,deps){const i=cursor++;if(!effects[i]||deps.some((d,j)=>!Object.is(d,effects[i].deps[j])))pendingEffects.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:run()};});}};tree=component(props);pendingEffects.forEach(fn=>fn());if(++count>30)throw Error('hook loop');}while(dirty);return tree;}return {render,get tree(){return tree;},button(label){const b=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(b,label);return b;},unmount(){effects.forEach(e=>e?.cleanup?.());}};}
  persisted.quota=quota;
  return {exports,mount,persisted,stores,calls};
}
const flush=async mounted=>{for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));mounted.render();}};

test('legacy 24h pending remains retained when upgraded long-TTL store loads after 25h',()=>{
  const persisted=storage();let now=Date.now();class Clock extends Date{static now(){return now;}}
  const shared=load('lib/admin/pending-mutation-store.ts',{}, {window:{sessionStorage:persisted},Date:Clock});
  const legacy=shared.createPendingMutationStore({storageKey:'nexion-admin-m-pool-transfer-v1'});
  legacy.remember('pool-transfer:71','legacy-original-key',{actorId:17,payload:{customers:[{id:'71'}],reason},selected:[item],target:candidate});
  now+=25*60*60*1000;
  const upgraded=shared.createPendingMutationStore({storageKey:'nexion-admin-m-pool-transfer-v1',ttlMs:Math.floor(Number.MAX_SAFE_INTEGER/2),retainExpiredRecords:true});
  assert.equal(upgraded.list().length,1);
  assert.ok(persisted.getItem('nexion-admin-m-pool-transfer-v1').includes('legacy-original-key'));
});

test('pool transfer must persist original intent before any dispatch when sessionStorage quota fails',async()=>{
  const h=harness({quota:true}), m=h.mount(h.exports.M1SupervisorPool,{permission:'supervisor'});m.render();await flush(m);
  m.button('分配此客户').props.onClick();m.render();
  nodes(m.tree).find(n=>n.type==='select'&&n.props.value===''&&!n.props['aria-label']).props.onChange({target:{value:'21'}});m.render();
  nodes(m.tree).find(n=>n.type==='textarea').props.onChange({target:{value:reason}});m.render();
  await m.button('确认分配 1 位').props.onClick();await flush(m);
  assert.equal(h.calls.filter(x=>x==='transfer').length,0);m.unmount();
});

test('route write 403 cannot erase original command evidence',async()=>{
  const h=harness({routeError:{status:403}}), m=h.mount(h.exports.PoolRouteModal,{item,groups,onClose(){},onDone(){}});m.render();await flush(m);
  nodes(m.tree).find(n=>n.type==='textarea').props.onChange({target:{value:reason}});m.render();await m.button('确认调整').props.onClick();await flush(m);
  assert.equal(h.calls.filter(x=>x==='route').length,1);
  assert.equal(h.stores.get('nexion-admin-support-pool-route-v1').list().length,1);m.unmount();
});

test('terminal route receipt must read current authorized facts before discarding evidence',async()=>{
  const h=harness({routeError:Error('unknown'),receipt:'SUCCEEDED'});let done=0;
  const m=h.mount(h.exports.PoolRouteModal,{item,groups,onClose(){},onDone(){done++;}});m.render();await flush(m);
  nodes(m.tree).find(n=>n.type==='textarea').props.onChange({target:{value:reason}});m.render();await m.button('确认调整').props.onClick();await flush(m);
  const before=h.calls.filter(x=>x==='pool'||x==='detail').length;
  await m.button('查询原调整结果').props.onClick();await flush(m);
  assert.ok(h.calls.filter(x=>x==='pool'||x==='detail').length>before,'authorized facts read must occur before forget/onDone');
  assert.equal(done,1);m.unmount();
});

test('route quota prevents the fourth operation family dispatch',async()=>{
 const h=harness({quota:true}),m=h.mount(h.exports.PoolRouteModal,{item,groups,onClose(){},onDone(){}});m.render();await flush(m);nodes(m.tree).find(n=>n.type==='textarea').props.onChange({target:{value:reason}});m.render();await m.button('确认调整').props.onClick();assert.equal(h.calls.filter(x=>x==='route').length,0);m.unmount();
});
test('route direct ordinary 409 keeps exact original evidence and generic recovery',async()=>{
 const h=harness({routeError:{status:409}}),m=h.mount(h.exports.PoolRouteModal,{item:{...item,displayName:'旧私密客户'},groups,onClose(){},onDone(){}});m.render();await flush(m);nodes(m.tree).find(n=>n.type==='textarea').props.onChange({target:{value:reason}});m.render();await m.button('确认调整').props.onClick();await flush(m);const before=JSON.stringify(h.stores.get('nexion-admin-support-pool-route-v1').list()[0]);assert.doesNotMatch(text(m.tree),/旧私密客户|独立审查真实操作理由/);await m.button('查询原调整结果').props.onClick();await flush(m);assert.equal(JSON.stringify(h.stores.get('nexion-admin-support-pool-route-v1').list()[0]),before);assert.equal(h.calls.filter(x=>x==='route').length,1);m.unmount();
});
test('route success and failure receipts retain evidence when current facts deny or differ',async()=>{
 for(const receipt of ['SUCCEEDED','FAILED'])for(const failure of ['denied','mismatch']){const h=harness({routeError:Error('unknown'),receipt,factsFailure:failure==='denied',factsMismatch:failure==='mismatch'});let done=0;const m=h.mount(h.exports.PoolRouteModal,{item,groups,onClose(){},onDone(){done++;}});m.render();await flush(m);nodes(m.tree).find(n=>n.type==='textarea').props.onChange({target:{value:reason}});m.render();await m.button('确认调整').props.onClick();await flush(m);await m.button('查询原调整结果').props.onClick();await flush(m);assert.equal(h.stores.get('nexion-admin-support-pool-route-v1').list().length,1);assert.equal(done,0);assert.equal(h.calls.filter(x=>x==='route').length,1);m.unmount();}
});

test('pool terminal success and failure require current authorized transfer facts, preserve evidence on denial and mismatch',async()=>{
 for(const receipt of ['SUCCEEDED','FAILED'])for(const failure of ['none','denied','mismatch']){
  const h=harness({receipt,factsFailure:failure==='denied',factsMismatch:failure==='mismatch'}),m=h.mount(h.exports.M1SupervisorPool,{permission:'supervisor'});m.render();await flush(m);m.button('分配此客户').props.onClick();m.render();nodes(m.tree).find(n=>n.type==='select'&&n.props.value===''&&!n.props['aria-label']).props.onChange({target:{value:'21'}});m.render();nodes(m.tree).find(n=>n.type==='textarea').props.onChange({target:{value:reason}});m.render();await m.button('确认分配 1 位').props.onClick();await flush(m);assert.doesNotMatch(text(m.tree),/专属客服甲|独立审查真实操作理由/);await m.button('查询上次结果').props.onClick();await flush(m);assert.ok(h.calls.includes('transfer-facts'));assert.equal(h.stores.get('nexion-admin-m-pool-transfer-v1').list().length,failure==='none'?0:1);assert.equal(h.calls.filter(x=>x==='transfer').length,1);m.unmount();
 }
});
