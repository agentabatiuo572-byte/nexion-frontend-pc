import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { compareM3Messages } from '../lib/admin/m3-message-order.ts';
const source=readFileSync(new URL('../app/components/domain-views/m-tabs/use-m3-message-pages.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const row=(id='current',version=1)=>({id,customerId:id==='other'?'99':'42',ownerAdminId:12,assignmentId:null,version,status:'open',unread:0,lastPublicMessageId:69,messages:[]});
const page=(first,last=first+9,version=1,id='current')=>({conversation:row(id,version),messages:Array.from({length:last-first+1},(_,i)=>({id:first+i,ts:(first+i)*100,sender:'user',sourceSenderType:'USER',sourceConversationNo:'legacy-'+Math.floor((first+i)/20),text:String(first+i)})),hasMore:first>1,nextBeforeMessageId:first>1?first:null,customerIdentity:{customerId:id==='other'?99:42,userNo:'REAL-UID',nickname:'Current name',phoneMasked:null},replyContext:{ready:true,targets:[{conversationNo:'legacy-outside-page',throughMessageId:2}]},readContexts:[]});
function harness(){
 const slots=[],effects=[],calls=[],denied=[];let cursor=0,dirty=true,value,summary=row(),scope='actor1',opening=0;
 const sandbox={exports:{},AbortController,Map,Set,
  require(name){return name==='react'?hooks:name==='@/lib/admin/m-client'?{fetchM3MessagePage:(no,before,signal)=>new Promise((resolve,reject)=>calls.push({no,before,signal,resolve,reject}))}:name==='@/lib/admin/error-messages'?{displayAdminError:error=>error.message}:name==='@/lib/admin/m3-message-order'?{compareM3Messages}:assert.fail(name);}};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const val=typeof next==='function'?next(slots[i]):next;if(!Object.is(val,slots[i])){slots[i]=val;dirty=true;}}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((dep,j)=>!Object.is(dep,old.deps[j])))slots[i]={deps,fn};return slots[i].fn;},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((dep,j)=>!Object.is(dep,old.deps[j])))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});}};
 vm.runInNewContext(compiled,sandbox);
 function render(changes={}){summary=changes.summary??summary;scope=changes.scope??scope;opening=changes.opening??opening;dirty=true;let n=0;while(dirty){assert.ok(++n<30,'hook convergence');dirty=false;cursor=0;value=sandbox.exports.useM3MessagePages(summary,scope,opening,(...args)=>denied.push(args));effects.splice(0).forEach(fn=>fn());}return value;}
 render();return {calls,denied,render,get value(){return value;},async resolve(data,index=calls.length-1){calls[index].resolve(data);await tick();return render();},async reject(error,index=calls.length-1){calls[index].reject(error);await tick();return render();},close(){slots.forEach(slot=>slot?.cleanup?.());}};
}

test('opens latest ten only and traverses all 69 messages in seven explicit batches without duplicates',async()=>{
 const h=harness();try{
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].before,undefined);
 await h.resolve(page(60,69));for(let i=0;i<5;i++)h.render();assert.equal(h.calls.length,1);
 for(const [first,last] of [[50,59],[40,49],[30,39],[20,29],[10,19],[1,9]]){
  const before=h.value.cursor;h.value.loadOlder();h.value.loadOlder();assert.equal(h.calls.at(-1).before,before);
  const count=h.calls.length;await h.resolve(page(first,last));assert.equal(h.calls.length,count);
 }
 assert.equal(h.calls.length,7);assert.equal(h.value.hasMore,false);assert.deepEqual(Array.from(h.value.messages,m=>m.id),Array.from({length:69},(_,i)=>i+1));
 h.value.loadOlder();assert.equal(h.calls.length,7);assert.equal(h.value.page.replyContext.targets[0].throughMessageId,2);
 }finally{h.close();}
});
test('page failure retains read history and retries the same cursor with one in-flight request',async()=>{
 const h=harness();try{await h.resolve(page(60,69));h.value.loadOlder();await h.reject(new Error('page timeout'));
 assert.equal(h.value.messages.length,10);assert.equal(h.value.cursor,60);assert.match(h.value.error,/page timeout/);assert.equal(h.value.contextReady,true,'older-page failures do not remove current reply metadata');
 h.value.retry();assert.equal(h.calls.at(-1).before,60);await h.resolve(page(50,59));assert.equal(h.value.messages.length,20);assert.equal(h.value.error,'');
 }finally{h.close();}
});
test('customer/identity/assignment changes cancel and hide old pages before a late result can mix',async()=>{
 const h=harness();try{const old=h.calls[0];h.render({summary:row('other'),scope:'actor2'});assert.equal(old.signal.aborted,true);assert.equal(h.value.messages.length,0);
 await h.resolve(page(60,69),0);assert.equal(h.value.messages.length,0);await h.resolve(page(10,19,1,'other'),1);assert.ok(h.value.messages.every(m=>m.id>=10&&m.id<=19));
 h.render({summary:{...row('other'),assignmentId:'new-assignment'}});assert.equal(h.value.messages.length,0);
 }finally{h.close();}
});
test('permission denial clears all private pages and reports the current customer once',async()=>{
 const h=harness();try{await h.resolve(page(60,69));h.value.loadOlder();await h.reject({status:403,message:'denied'});assert.equal(h.value.messages.length,0);assert.deepEqual(h.denied,[['current','42']]);}finally{h.close();}
});
test('reopening the same customer resets to the newest ten instead of restoring an old scroll page',async()=>{
 const h=harness();try{await h.resolve(page(60,69));h.value.loadOlder();await h.resolve(page(50,59));h.render({opening:1});assert.equal(h.value.messages.length,0);assert.equal(h.calls.at(-1).before,undefined);await h.resolve(page(60,69));assert.equal(h.value.messages.length,10);assert.equal(h.value.change,'reset');}finally{h.close();}
});
test('burst larger than ten never creates a hidden tail gap and keeps a bridge from the latest cursor',async()=>{
 const h=harness();try{await h.resolve(page(60,69));h.render({summary:row('current',2)});assert.equal(h.calls.at(-1).before,undefined);await h.resolve(page(81,90,2));
 assert.equal(h.value.gap,true);assert.equal(h.value.contextReady,false);assert.deepEqual(Array.from(h.value.messages,m=>m.id),Array.from({length:10},(_,i)=>60+i));assert.equal(h.value.cursor,60);
 h.value.loadOlder();await h.resolve(page(50,59,2));assert.equal(h.value.messages.length,20);assert.equal(h.value.gap,true,'older reading remains available without pretending the new tail is contiguous');
 h.value.newest();await h.resolve(page(81,90,2));assert.equal(h.value.gap,false);assert.equal(h.value.cursor,81);h.value.loadOlder();await h.resolve(page(71,80,2));h.value.loadOlder();await h.resolve(page(61,70,2));
 assert.deepEqual(Array.from(h.value.messages,m=>m.id),Array.from({length:30},(_,i)=>61+i));
 }finally{h.close();}
});
test('new version cancels an older in-flight page, merges an overlapping tail and keeps the history cursor',async()=>{
 const h=harness();try{await h.resolve(page(60,69));h.value.loadOlder();const stale=h.calls.at(-1);h.render({summary:row('current',2)});assert.equal(stale.signal.aborted,true);
 await h.resolve(page(65,74,2));assert.equal(h.value.cursor,60);assert.equal(h.value.messages.length,15);assert.equal(h.value.change,'latest');assert.equal(h.value.gap,false);
 stale.resolve(page(50,59));await tick();h.render();assert.equal(h.value.messages.length,15);
 }finally{h.close();}
});
test('a version change during the first page cancels it and cannot leave reply/read authority permanently pending',async()=>{
 const h=harness();try{const stale=h.calls[0];h.render({summary:row('current',2)});assert.equal(stale.signal.aborted,true);assert.equal(h.calls.length,2);
 stale.resolve(page(60,69,1));await tick();h.render();assert.equal(h.value.messages.length,0);
 await h.resolve(page(60,69,2),1);assert.equal(h.value.contextReady,true);assert.equal(h.value.readReady,true);
 }finally{h.close();}
});
test('receipt recovery can revalidate the failed older page after an intervening latest update',async()=>{
 const h=harness();try{await h.resolve(page(60,69));h.value.loadOlder();await h.resolve(page(50,59));const failed={beforeMessageId:h.value.readCursor};assert.equal(failed.beforeMessageId,60);
 h.render({summary:row('current',2)});await h.resolve(page(65,74,2));assert.equal(h.value.readCursor,undefined);
 h.value.refreshReadContexts(failed);assert.equal(h.calls.at(-1).before,60);await h.resolve(page(50,59,2));assert.equal(h.value.readCursor,60);assert.equal(h.value.messages.length,25);
 }finally{h.close();}
});

const chat=readFileSync(new URL('../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('chat.tsx',chat,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const main=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='M3DedicatedChat');
const layout=main.body.statements.find(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(ast)==='useLayoutEffect'&&node.getText(ast).includes('messagePages.revision'));
const layoutCode=ts.transpileModule(layout.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
test('actual layout opens at bottom, anchors prepended old messages, and leaves old reading unchanged on a new tail',()=>{
 const body={scrollTop:0,scrollHeight:2000,clientHeight:400,getBoundingClientRect:()=>({top:100}),querySelector:()=>({getBoundingClientRect:()=>({top:175})})};
 const scope={useLayoutEffect:fn=>fn(),messagePages:{key:'current',revision:1,change:'reset',gap:false},messageBodyRef:{current:body},messageAnchor:{current:null},messageScroll:{current:{top:0,bottom:true,touchY:0}},olderScrollIntent:{current:{up:false,scrollbar:false,pointerY:0}}};
 vm.runInNewContext(layoutCode,scope);assert.equal(body.scrollTop,2000);
 scope.messagePages.change='older';body.scrollTop=300;scope.messageAnchor.current={id:'60',offset:25};vm.runInNewContext(layoutCode,scope);assert.equal(body.scrollTop,350,'visible message offset is preserved after prepend');
 scope.messagePages.change='latest';scope.messageScroll.current.bottom=false;body.scrollTop=350;vm.runInNewContext(layoutCode,scope);assert.equal(body.scrollTop,350,'new arrivals must not pull an older reader to the bottom');
 scope.olderScrollIntent.current={up:true,scrollbar:true,pointerY:150};scope.messageScroll.current.touchY=180;scope.messagePages.key='other-customer';scope.messagePages.revision=0;
 vm.runInNewContext(layoutCode,scope);assert.equal(scope.olderScrollIntent.current.up,false);assert.equal(scope.olderScrollIntent.current.scrollbar,false);assert.equal(scope.olderScrollIntent.current.pointerY,0);assert.equal(scope.messageScroll.current.touchY,0,'a new customer cannot inherit an old input gesture');
});
test('image load grows the latest view at bottom without dragging a user who has scrolled upward',()=>{
 const handler=main.body.statements.flatMap(node=>ts.isVariableStatement(node)?[...node.declarationList.declarations]:[]).find(node=>node.name.getText(ast)==='onMessageAssetLoad');
 const code=ts.transpileModule(`globalThis.handler=${handler.initializer.getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const body={scrollTop:300,scrollHeight:1800},scope={messageBodyRef:{current:body},messageScroll:{current:{bottom:true,top:300}},olderScrollIntent:{current:{up:false,scrollbar:false,pointerY:0}}};
 vm.runInNewContext(code,scope);scope.handler();assert.equal(body.scrollTop,1800);
 scope.messageScroll.current.bottom=false;body.scrollTop=300;body.scrollHeight=2400;scope.handler();assert.equal(body.scrollTop,300);
 assert.match(chat,/onLoadCapture=\{onMessageAssetLoad\}/);
});
function scrollHandlers() {
 const names=['loadOlderMessages','onMessageScroll','onMessageUpInput','onMessageWheel','onMessageTouchMove','onMessageKeyDown','onMessagePointerDown','onMessagePointerMove','onMessageAssetLoad'];
 const declarations=main.body.statements.flatMap(node=>ts.isVariableStatement(node)?[...node.declarationList.declarations]:[]);
 const code=names.map(name=>`const ${name}=${declarations.find(node=>node.name.getText(ast)===name).initializer.getText(ast)};`).join('\n')+`\nglobalThis.handlers={${names.join(',')}};`;
 let reads=0;
 const body={scrollTop:105.333,scrollHeight:813,clientHeight:707,clientWidth:200,clientLeft:0,getBoundingClientRect:()=>({top:0,left:0}),querySelectorAll:()=>[]};
 const scope={messageBodyRef:{current:body},messageAnchor:{current:null},messageScroll:{current:{top:105.333,bottom:true,touchY:100}},olderScrollIntent:{current:{up:false,scrollbar:false,pointerY:0}},messagePages:{loading:false,hasMore:true,loadOlder(){reads++;}}};
 vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
 return {...scope,body,get reads(){return reads;},event:extra=>({currentTarget:body,...extra})};
}
test('footer layout 707→754 and scrollTop105.33→58.67 cannot authorize an older page without upward input',()=>{
 const h=scrollHandlers();h.body.clientHeight=754;h.body.scrollTop=58.667;h.handlers.onMessageScroll(h.event({isTrusted:true}));assert.equal(h.reads,0);
 h.messageScroll.current.top=50;h.body.clientHeight=400;h.body.scrollHeight=449.333;h.body.scrollTop=49.333;h.handlers.onMessageScroll(h.event({isTrusted:true}));assert.equal(h.reads,0,'DPR rounding is also layout, not input');
 h.handlers.onMessageAssetLoad();h.body.scrollTop=48.667;h.handlers.onMessageScroll(h.event({isTrusted:true}));assert.equal(h.reads,0,'image positioning cannot fetch another page');
});
test('wheel, touch and keyboard upward input can cross the top threshold but one input cannot auto-chain pages',()=>{
 for(const method of ['wheel','touch','key']){
  const h=scrollHandlers();h.body.scrollTop=105.333;
  if(method==='wheel')h.handlers.onMessageWheel(h.event({deltaY:-100}));
  if(method==='touch')h.handlers.onMessageTouchMove(h.event({touches:[{clientY:150}]}));
  if(method==='key')h.handlers.onMessageKeyDown(h.event({key:'PageUp'}));
  h.body.scrollTop=30;h.handlers.onMessageScroll(h.event());assert.equal(h.reads,1,method);
  h.body.scrollTop=20;h.handlers.onMessageScroll(h.event());assert.equal(h.reads,1,'a later layout scroll cannot reuse the input');
  h.body.scrollTop=0;
  if(method==='wheel')h.handlers.onMessageWheel(h.event({deltaY:-10}));
  if(method==='touch')h.handlers.onMessageTouchMove(h.event({touches:[{clientY:180}]}));
  if(method==='key')h.handlers.onMessageKeyDown(h.event({key:'ArrowUp'}));
  assert.equal(h.reads,2,'explicit upward input at an unscrollable top still loads one page');
  h.body.scrollTop=-0.666;h.handlers.onMessageScroll(h.event());assert.equal(h.reads,2);
 }
});
test('scrollbar upward drag grants one page while content clicks, stationary thumb and downward inputs do not',()=>{
 const h=scrollHandlers();h.handlers.onMessagePointerDown(h.event({button:0,clientX:100,clientY:150}));h.body.scrollTop=30;h.handlers.onMessageScroll(h.event());assert.equal(h.reads,0,'content click');
 h.body.scrollTop=105.333;h.messageScroll.current.top=105.333;h.handlers.onMessagePointerDown(h.event({button:0,clientX:205,clientY:150}));h.body.scrollTop=58.667;h.handlers.onMessageScroll(h.event());assert.equal(h.reads,0,'stationary scrollbar does not count as dragging upward');
 h.body.scrollTop=105.333;h.messageScroll.current.top=105.333;h.handlers.onMessagePointerMove(h.event({clientY:80}));h.body.scrollTop=30;h.handlers.onMessageScroll(h.event());assert.equal(h.reads,1);
 h.body.scrollTop=20;h.handlers.onMessageScroll(h.event());assert.equal(h.reads,1);
 h.handlers.onMessageWheel(h.event({deltaY:20}));h.body.scrollTop=10;h.handlers.onMessageScroll(h.event());assert.equal(h.reads,1,'downward input');
 h.handlers.onMessageWheel(h.event({deltaY:-20,ctrlKey:true}));assert.equal(h.reads,1,'zoom is not an upward scroll');
});
test('M3 has no full-detail/history/preflight bypass and keeps thin UID plus independent reply/read contexts',()=>{
 assert.doesNotMatch(chat,/loadConversationDetail\(|markMConversationRead\(|CustomerHistoryMessages|customerHistory\.map/);
 assert.match(chat,/identity\.userNo/);assert.match(chat,/messagePages\.page\?\.replyContext\.targets/);assert.match(chat,/markM3MessagePageRead\(context/);
 assert.match(chat,/currentReplyTarget && \(intent === "SERVICE" \|\| includeCurrentReply\)/);assert.match(chat,/selectedClosedIds\.has\(row\.conversationNo\)/);
 assert.match(readFileSync(new URL('../app/components/domain-views/m-view.tsx',import.meta.url),'utf8'),/tab !== "M3" && \(event\.eventType/);
});
test('a customer never opened in the message pane is searchable by the real UserOps U-number',()=>{
 const filtered=main.body.statements.flatMap(node=>ts.isVariableStatement(node)?[...node.declarationList.declarations]:[]).find(node=>node.name.getText(ast)==='filtered');
 const code=ts.transpileModule(`globalThis.result=${filtered.initializer.getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const [customerId,query] of [['42','U00000042'],['60723153007','U60723153007']]){
  const scope={identityRows:[{id:'current',customerId,customer:'Customer',profile:{uid:`U-${customerId.padStart(5,'0')}`}}],query,listTab:'all',tabMatch:()=>true,customerIdOf:row=>row.customerId};
  vm.runInNewContext(code,scope);assert.equal(scope.result.length,1);
 }
});
