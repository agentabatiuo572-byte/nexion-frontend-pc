import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const ts=createRequire(import.meta.url)('typescript');
const source=readFileSync('app/components/domain-views/m-tabs/m1-supervisor-pool.tsx','utf8');
const groups=[{id:'8',name:'一组',status:'ENABLED',version:11},{id:'9',name:'二组',status:'ENABLED',version:12}];
const item={customerId:'71',version:4,reason:'NO_INVITER',routeState:'AVAILABLE',routeId:'91',routeGroupId:'8',routeVersion:7};
function harness({mode='ALL',groupRows=groups,scopeFailure=false,writeFailure=false}={}){
  const calls=[],tables=new Map();let hooks;
  const auth={session:{adminId:12},authEpoch:1};
  const useAdminAuth=selector=>selector(auth);useAdminAuth.getState=()=>auth;
  const empty={records:[],total:0,pageNum:1,pageSize:8};
  const supportClient={overview:async()=>{if(scopeFailure)throw{status:403};return{scope:{mode}};},bindingPool:async options=>{calls.push(['pool',options]);return empty;},agents:async options=>{calls.push(['agents',options]);return empty;},transfer:async()=>{},command:async()=>({status:'UNKNOWN'})};
  let receipt='UNKNOWN',commandGate;
  const groupClient={groups:async()=>groupRows,detail:async id=>{calls.push(['detail',id]);return{group:groups.find(g=>g.id===id)};},command:async key=>{calls.push(['command',key]);if(commandGate)await commandGate;return{status:receipt};}};
  const createStore=({storageKey})=>{const rows=tables.get(storageKey)??new Map();tables.set(storageKey,rows);return{list:()=>[...rows.values()],get:f=>[...rows.values()].find(r=>r.fingerprint===f)?.commandKey,isDurablyStored:()=>true,remember:(fingerprint,commandKey,extra)=>rows.set(commandKey,{fingerprint,commandKey,createdAt:1,expiresAt:Number.MAX_SAFE_INTEGER,...extra}),forget:(f,key)=>{for(const[k,r]of rows)if(r.fingerprint===f&&(!key||k===key))rows.delete(k);}};};
  const no=()=>{},jsx=(type,props,key)=>({type,props,key});
  const imports={react:{useState:i=>hooks.state(i),useEffect:(e,d)=>hooks.effect(e,d),useRef:i=>hooks.ref(i)},'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'../design-kit':{Modal:'Modal'},'./support-random-assignment':{SupportRandomAssignment:no,hasPendingRandomAssignment:()=>false},'./support-avatar':{SupportAvatar:no,advisorAvatarPath:no}};
  const module={exports:{}};
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,AbortController,Map,Set,Date,crypto:{randomUUID:()=>`command-${calls.length}`},window:{dispatchEvent:no},require:id=>{
    if(id.endsWith('.css'))return{};if(imports[id])return imports[id];
    if(id.includes('m-support-client'))return{supportClient,isIndeterminateSupportError:()=>false,readSupportPoolCustomer:async()=>{calls.push(['pool-facts']);return item;},verifySupportTransfer:async()=>{},setSupportPoolRoute:async(...args)=>{calls.push(['write',...args]);if(writeFailure)throw Error('timeout');return{};}};
    if(id.includes('support-group-client'))return{supportGroupClient:groupClient};
    if(id.includes('pending-mutation-store'))return{createPendingMutationStore:createStore};
    if(id.includes('admin-auth'))return{useAdminAuth};if(id.includes('shell-authorities'))return{adminShellSessionKey:()=>`${auth.session.adminId}:${auth.authEpoch}`};if(id.includes('business-time'))return{parseBusinessTime:Date.parse};throw Error(id);
  }});
  function mount(component,props){const values=[],effects=[];let index=0;return{render(){for(let pass=0;pass<20;pass++){index=0;const pending=[];hooks={state(initial){const n=index++;if(!(n in values))values[n]=typeof initial==='function'?initial():initial;return[values[n],next=>values[n]=typeof next==='function'?next(values[n]):next];},ref(initial){const n=index++;return values[n]??(values[n]={current:initial});},effect(fn,deps){const n=index++;if(!effects[n]||deps.some((d,i)=>!Object.is(d,effects[n].deps[i]))){pending.push(()=>{effects[n]?.cleanup?.();effects[n]={deps,cleanup:fn()};});}}};const tree=component(props);if(!pending.length)return tree;pending.forEach(fn=>fn());}throw Error('effects loop');}};}
  return{...module.exports,mount,calls,tables,setReceipt:value=>receipt=value,setCommandGate:value=>commandGate=value,auth};
}
function nodes(value){if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object')return[];return[value,...nodes(value.props?.children),...nodes(value.props?.footer)];}
function text(value){if(Array.isArray(value))return value.map(text).join('');return value&&typeof value==='object'?text(value.props?.children):value??'';}
const button=(tree,label)=>nodes(tree).find(node=>node.type==='button'&&text(node)===label);
const flush=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
test('managed empty scope and a denied read never query all pool/agents',async()=>{
  for(const options of [{mode:'MANAGED',groupRows:[]},{scopeFailure:true}]){const h=harness(options),mounted=h.mount(h.M1SupervisorPool,{permission:'supervisor'});mounted.render();await flush();const tree=mounted.render();assert.equal(h.calls.filter(c=>['pool','agents'].includes(c[0])).length,0);assert.match(text(tree),options.scopeFailure?/无权/:/没有可管理/);}
});
test('pool group selection loads pool and candidates in the same authorized group and changes reset it',async()=>{
  const h=harness({mode:'MANAGED'}),mounted=h.mount(h.M1SupervisorPool,{permission:'supervisor',initialGroupId:8});mounted.render();await flush();mounted.render();await flush();let tree=mounted.render();
  assert.ok(h.calls.some(c=>c[0]==='pool'&&c[1].groupId===8));assert.ok(h.calls.some(c=>c[0]==='agents'&&c[1].groupId===8));
  assert.equal(button(tree,'调整组范围'),undefined);
  nodes(tree).find(n=>n.props?.['aria-label']==='选择客服组').props.onChange({target:{value:'9'}});mounted.render();await flush();tree=mounted.render();
  for(const kind of ['pool','agents'])assert.equal(h.calls.filter(c=>c[0]===kind).at(-1)[1].groupId,9);
  assert.equal(h.isAssignable({enabled:true,assignmentEligible:true,seatType:'GENERAL',serviceTypes:['support']}),true);
  assert.equal(h.isAssignable({enabled:false,assignmentEligible:false,seatType:'DEDICATED',serviceTypes:['advisor']}),false);
  for (const assignmentEligible of [false, undefined, null]) assert.equal(h.isAssignable({enabled:true,assignmentEligible,seatType:'DEDICATED',serviceTypes:['support']}), false);
  assert.equal(h.isAssignable({enabled:true,assignmentEligible:true,busy:true}),true);
});
test('route unknown stays blocked; known route preserves its exact version and unknown commands cannot replay even via stale handler',async()=>{
  const unknown=harness(),u=unknown.mount(unknown.PoolRouteModal,{item:{...item,routeState:'UNKNOWN',routeId:null,routeGroupId:null,routeVersion:null},groups,onClose(){},onDone(){}});u.render();await flush();assert.equal(button(u.render(),'确认调整').props.disabled,true);
  const h=harness({writeFailure:true}),m=h.mount(h.PoolRouteModal,{item,groups,onClose(){},onDone(){}});m.render();await flush();let tree=m.render();
  nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value:'真实客服调整组范围原因'}});tree=m.render();
  const stale=button(tree,'确认调整').props.onClick;await stale();await flush();tree=m.render();assert.equal(button(tree,'确认调整').props.disabled,true);
  await stale();assert.equal(h.calls.filter(c=>c[0]==='write').length,1);
  const write=h.calls.find(c=>c[0]==='write');assert.deepEqual(JSON.parse(JSON.stringify(write[2])),{targetGroupId:null,expectedRouteVersion:7,sourceGroupVersion:11,targetGroupVersion:null,reason:'真实客服调整组范围原因'});
  await button(tree,'查询原调整结果').props.onClick();await flush();tree=m.render();assert.equal(h.calls.filter(c=>c[0]==='write').length,1);assert.equal(h.tables.get('nexion-admin-support-pool-route-v1').size,1);
  h.setReceipt('FAILED');await button(tree,'查询原调整结果').props.onClick();await flush();tree=m.render();assert.equal(button(tree,'确认调整').props.disabled,true);assert.equal(button(tree,'重读组资料'),undefined);
});
test('unknown route receipt retains exact key, payload and reason through reload and actor changes cannot close another session',async()=>{
  const h=harness({writeFailure:true});let completed=0;
  const props={item,groups,onClose(){},onDone(){completed++;}};
  const m=h.mount(h.PoolRouteModal,props);m.render();await flush();let tree=m.render();
  nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value:'真实客服调整组范围原因'}});tree=m.render();await button(tree,'确认调整').props.onClick();await flush();
  const stored=[...h.tables.get('nexion-admin-support-pool-route-v1').values()][0],before=JSON.stringify(stored);
  const reloaded=h.mount(h.PoolRouteModal,props);tree=reloaded.render();assert.equal(button(tree,'确认调整').props.disabled,true);
  await button(tree,'查询原调整结果').props.onClick();await flush();assert.equal(JSON.stringify([...h.tables.get('nexion-admin-support-pool-route-v1').values()][0]),before);
  assert.equal(h.calls.filter(c=>c[0]==='write').length,1);assert.equal(h.calls.filter(c=>c[0]==='command').at(-1)[1],stored.commandKey);
  h.setReceipt('SUCCEEDED');let resolveGate;h.setCommandGate(new Promise(resolve=>resolveGate=resolve));
  const check=button(reloaded.render(),'查询原调整结果').props.onClick();h.auth.authEpoch++;resolveGate();await check;await flush();assert.equal(completed,0);
  assert.equal(h.tables.get('nexion-admin-support-pool-route-v1').size,1);
  assert.equal(h.calls.filter(c=>c[0]==='write').length,1);
});
