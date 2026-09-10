import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../lib/admin/conversation-realtime.ts',import.meta.url),'utf8');
function fixture(reconcile=async()=>{},ticket=async()=>({ticket:'one-time'})) {
  let now=100000,id=0;const timers=new Map();const sockets=[];
  const clock={setTimeout(fn,delay){timers.set(++id,{at:now+delay,fn});return id},clearTimeout(id){timers.delete(id)}};
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports:module.exports,module,AbortController,Date:{now:()=>now},Math,Map,Set,Promise,Error,JSON,...clock});
  const client=new module.exports.ConversationRealtime({url:'ws://test',ticket,reconcile,
    socket:()=>{const socket={sent:[],send(data){this.sent.push(JSON.parse(data))},close(){}};sockets.push(socket);return socket}});
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
  const tick=async(ms)=>{const end=now+ms;await flush();for(;;){const due=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();await flush()}now=end;await flush()};
  const frame=(socket,data)=>socket.onmessage?.({data:JSON.stringify(data)});
  return {client,sockets,tick,frame};
}
test('M3 waits for catch-up, coalesces invalidations, and does not poll a healthy socket',async()=>{
  let release,calls=0;const f=fixture(async()=>{calls++;if(calls===1)await new Promise(r=>release=r)});
  f.client.start();await f.tick(0);const socket=f.sockets[0];socket.onopen();f.frame(socket,{type:'ready'});
  assert.equal(f.client.ready,false);f.frame(socket,{type:'event',eventId:'e1'});release();await f.tick(1);
  assert.equal(f.client.ready,true);assert.equal(calls,2);
  f.frame(socket,{type:'event',eventId:'e1'});await f.tick(6000);assert.equal(calls,2);f.client.stop();
});
test('M3 disconnect falls back to snapshots and rejects an uncertain send without inventing another key',async()=>{
  let calls=0;const f=fixture(async()=>{calls++});f.client.start();await f.tick(0);const socket=f.sockets[0];socket.onopen();f.frame(socket,{type:'ready'});await f.tick(0);
  const pending=f.client.command('reply','CV-1',{body:'hello'},'original-key');const rejected=assert.rejects(pending,/CONVERSATION_DELIVERY_UNKNOWN/);
  socket.onclose({code:1006});await rejected;await f.tick(5100);assert.ok(calls>=2);
  assert.equal(socket.sent.filter(x=>x.type==='command').length,1);assert.equal(socket.sent.find(x=>x.type==='command').idempotencyKey,'original-key');f.client.stop();
});
test('M3 ready cancels the five-second fallback, while a disconnected socket resumes it exactly on the bounded cadence',async()=>{
  let calls=0;const f=fixture(async()=>{calls++});f.client.start();await f.tick(0);
  const socket=f.sockets[0];socket.onopen();f.frame(socket,{type:'ready'});await f.tick(0);
  assert.equal(calls,1,'the ready socket performs its authoritative catch-up once');
  await f.tick(5000);assert.equal(calls,1,'a ready authenticated socket must not retain the fallback poll');
  socket.onclose({code:1006});await f.tick(4999);assert.equal(calls,1,'the disconnect fallback must remain bounded before five seconds');
  await f.tick(1);assert.equal(calls,2,'the disconnected socket must reconcile at its five-second fallback boundary');f.client.stop();
});
test('M3 recovers a failed initial snapshot through the five-second fallback before reopening writes',async()=>{
  let conversationsAvailable=false,reconciles=0,tickets=0;
  const canWrite=()=>true&&conversationsAvailable;
  const f=fixture(async()=>{
    reconciles++;
    if(reconciles===1)throw new Error('initial snapshot unavailable');
    conversationsAvailable=true;
  },async()=>{tickets++;return {ticket:'one-time'}});

  // The M view begins this read-only recovery channel after it has published
  // its fail-closed snapshot.  No M3 write is enabled until reconciliation
  // itself has obtained the complete authoritative snapshot.
  assert.equal(canWrite(),false);
  f.client.start();await f.tick(0);assert.equal(tickets,1,'authorized recovery obtains a realtime ticket');
  const socket=f.sockets[0];socket.onopen();f.frame(socket,{type:'ready'});await f.tick(0);
  assert.equal(reconciles,1);assert.equal(conversationsAvailable,false);assert.equal(f.client.ready,false);
  await f.tick(5000);
  assert.equal(reconciles,2,'the bounded fallback retries the failed initial reconciliation');
  assert.equal(conversationsAvailable,true);assert.equal(canWrite(),true);
  f.client.stop();
});
test('M3 terminal ticket failures stop reconnect and fallback polling',async()=>{
  for(const status of [401,403,428]){
    let tickets=0,reconciles=0;
    const f=fixture(async()=>{reconciles++},async()=>{tickets++;throw Object.assign(new Error('ticket denied'),{status})});
    f.client.start();await f.tick(0);await f.tick(30000);
    assert.equal(tickets,1,`ticket ${status} must be terminal rather than retrying`);
    assert.equal(f.sockets.length,0,`ticket ${status} must not open a socket`);
    assert.equal(reconciles,0,`ticket ${status} must stop the five-second fallback`);
    assert.equal(f.client.ready,false);f.client.stop();
  }
});
test('M3 ignores old connection messages after logout or lifecycle cancellation',async()=>{
  const f=fixture();f.client.start();await f.tick(0);const socket=f.sockets[0];f.client.stop();f.frame(socket,{type:'ready'});await f.tick(60000);assert.equal(f.client.ready,false);assert.equal(f.sockets.length,1);
});
test('M3 binding acquires a one-time ticket and observes auth and page visibility boundaries',()=>{
  const hook=fs.readFileSync(new URL('../lib/admin/use-conversation-stream.ts',import.meta.url),'utf8');
  assert.match(hook,/realtime-ticket/);assert.match(hook,/authEpoch/);assert.match(hook,/visibilitychange/);assert.match(hook,/lifecycleSignal/);assert.doesNotMatch(hook,/new EventSource/);
});
function createHookHarness(){
  const slots=[];let cursor=0;let pending=[];
  const changed=(a,b)=>!a||a.length!==b.length||a.some((value,index)=>!Object.is(value,b[index]));
  const react={
    useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},
    useState(initial){const index=cursor++;const slot=slots[index]??(slots[index]={value:typeof initial==='function'?initial():initial});return [slot.value,(next)=>{slot.value=typeof next==='function'?next(slot.value):next;}];},
    useEffect(effect,deps){const index=cursor++;const previous=slots[index];if(!previous||changed(previous.deps,deps)){slots[index]={deps,effect,cleanup:previous?.cleanup};pending.push(index);}}
  };
  return {react,render(render){cursor=0;pending=[];render();for(const index of pending){const slot=slots[index];slot.cleanup?.();slot.cleanup=slot.effect()??undefined;}},unmount(){for(const slot of slots)slot?.cleanup?.();}};
}
test('M3 hook implementation follows simulated lifecycle cleanup across visibility, auth epoch, abort, and unmount',()=>{
  const hookSource=fs.readFileSync(new URL('../lib/admin/use-conversation-stream.ts',import.meta.url),'utf8');
  const hooks=createHookHarness();const auth={authEpoch:1,isAuthenticated:true,logoutPending:false};const instances=[];const installs=[];
  class Realtime {constructor(options){this.options=options;this.startCount=0;this.stopCount=0;instances.push(this);}start(){this.startCount++;}stop(){this.stopCount++;}}
  const listeners=new Map();const document={visibilityState:'visible',addEventListener(type,listener){listeners.set(type,listener);},removeEventListener(type,listener){if(listeners.get(type)===listener)listeners.delete(type);}};
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(hookSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,require(id){
    if(id==='react')return hooks.react;
    if(id==='./conversation-realtime')return {ConversationRealtime:Realtime};
    if(id==='./admin-conversation-realtime')return {installAdminRealtime:value=>installs.push(value),updateAdminRealtime(){},receiveAdminPresence(){}};
    if(id==='@/lib/store/admin-auth')return {useAdminAuth:selector=>selector(auth)};
    throw new Error(`unexpected import: ${id}`);
  },window:{},document,location:{origin:'http://console.test'},AbortController,Error,Promise,console});
  const lifecycle=new AbortController();const options={onEvent(){},onReconnectSnapshot:async()=>{},lifecycleSignal:lifecycle.signal};
  const render=(enabled=true)=>hooks.render(()=>module.exports.useConversationStream({...options,enabled}));
  // A caller that lacks M3 read authority passes enabled:false: the hook must
  // not construct a realtime client, so it cannot obtain a ticket.
  render(false);assert.equal(instances.length,0,'no M3 read authority must not construct realtime or request a ticket');
  render();assert.equal(instances.length,1);assert.equal(instances[0].startCount,1);assert.equal(installs.at(-1),instances[0]);
  document.visibilityState='hidden';listeners.get('visibilitychange')();assert.equal(instances[0].stopCount,1);assert.equal(installs.at(-1),null);
  document.visibilityState='visible';listeners.get('visibilitychange')();assert.equal(instances[0].startCount,2);assert.equal(installs.at(-1),instances[0]);
  auth.authEpoch=2;render();assert.equal(instances[0].stopCount,2,'auth epoch replacement must clean up its old socket');assert.equal(instances.length,2);assert.equal(instances[1].startCount,1);
  auth.isAuthenticated=false;render();assert.equal(instances[1].stopCount,1);assert.equal(instances.length,2,'unauthorized render must not construct a socket');
  auth.isAuthenticated=true;render();assert.equal(instances.length,3);lifecycle.abort();assert.equal(instances[2].stopCount,1,'lifecycle abort must stop the current socket');
  hooks.unmount();assert.ok(instances[2].stopCount>=1);assert.equal(installs.at(-1),null);
});
