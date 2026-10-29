import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source=readFileSync(new URL('../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('chat.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const picker=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='SupportContactPicker');
const code=ts.transpileModule(picker.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'el',jsxFragmentFactory:'Fragment'}}).outputText;
const customer=id=>({customerId:String(id),customerNo:String(id),displayName:`Customer ${id}`,agentAdminId:7,maintenanceEnabled:true});
const data=(first,count,total=13)=>({records:Array.from({length:count},(_,i)=>customer(first+i)),total,pageSize:10});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
  const slots=[],effects=[],calls=[],timers=new Map(),selected=[];let cursor=0,dirty=true,tree,session={adminId:7},epoch=1,nextTimer=0,closed=0;
  const scope={AbortController,JSON,Math,Fragment:'fragment',Modal:'modal',
    el:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity).filter(x=>x!==null&&x!==undefined&&x!==false)}),
    useAdminAuth:selector=>selector({session,authEpoch:epoch}),displayAdminError:e=>e.message,
    supportClient:{customers:options=>new Promise((resolve,reject)=>calls.push({options,resolve,reject}))},
    setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j])))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
  };
  vm.runInNewContext(`${code}\nthis.renderPicker=SupportContactPicker;`,scope);
  function render(){dirty=true;while(dirty){dirty=false;cursor=0;tree=scope.renderPicker({onClose:()=>closed++,onSelect:id=>selected.push(id)});effects.splice(0).forEach(fn=>fn());}return tree;}
  function nodes(node=tree){return typeof node==='object'?[node,...node.children.flatMap(nodes)]:[];}
  const text=node=>typeof node==='object'?node.children.map(text).join(''):String(node);
  function button(name){return nodes().find(n=>n.type==='button'&&text(n)===name);}
  render();
  return {calls,selected,render,text:()=>text(tree),rows:()=>nodes().filter(n=>n.type==='li'),button,get tree(){return tree;},get closed(){return closed;},
    input(value){nodes().find(n=>n.type==='input').props.onChange({target:{value}});render();},
    click(name){const b=button(name);assert.ok(b,`button ${name}`);assert.ok(!b.props.disabled);b.props.onClick();render();},
    flushSearch(){const jobs=[...timers.values()];timers.clear();jobs.forEach(fn=>fn());},
    identity(adminId){session={adminId};epoch++;render();},
    async resolve(value,index=calls.length-1){calls[index].resolve(value);await tick();render();},
    async reject(error,index=calls.length-1){calls[index].reject(error);await tick();render();},
    close(){slots.forEach(s=>s?.cleanup?.());},
  };
}

test('server pages ten records then three, with correct boundaries and canonical user numbers',async()=>{
  const h=harness();try{
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.pageSize,10);assert.equal(h.calls[0].options.mode,'PERSONAL');
    await h.resolve(data(1,10));assert.equal(h.rows().length,10);assert.equal(h.button('上一页').props.disabled,true);assert.equal(h.button('下一页').props.disabled,false);assert.match(h.text(),/U00000001/);
    h.click('下一页');assert.equal(h.rows().length,0);assert.equal(h.calls[1].options.pageNum,2);
    await h.resolve(data(11,3));assert.equal(h.rows().length,3);assert.equal(h.button('下一页').props.disabled,true);assert.match(h.text(),/第 2 \/ 2 页/);
    h.click('上一页');await h.resolve(data(1,10));assert.equal(h.rows().length,10);
  }finally{h.close();}
});
test('searches all three input forms on the server, trims and resets page, and cancels stale responses',async()=>{
  const h=harness();try{
    await h.resolve(data(1,10));h.click('下一页');await h.resolve(data(11,3));
    for(const value of ['Customer','  3778  ','U60723153007']){
      h.input(value);assert.equal(h.rows().length,0);h.flushSearch();assert.equal(h.calls.at(-1).options.keyword,value.trim());assert.equal(h.calls.at(-1).options.pageNum,1);await h.resolve(data(1,1,1));
    }
    h.input('older');h.flushSearch();const old=h.calls.length-1;
    h.input('newer');h.flushSearch();assert.equal(h.calls[old].options.signal.aborted,true);
    await h.resolve(data(9,1,1),old);assert.equal(h.rows().length,0);await h.resolve(data(10,1,1));assert.match(h.text(),/Customer 10/);
    h.input('');assert.equal(h.calls.at(-1).options.keyword,'');await h.resolve(data(1,10));assert.equal(h.rows().length,10);
  }finally{h.close();}
});
test('failure retries the same query, empty results have no next page, and identity changes hide private rows',async()=>{
  const h=harness();try{
    await h.reject(new Error('network down'));assert.match(h.text(),/network down/);h.click('重试客户列表');assert.equal(h.calls.at(-1).options.pageNum,1);
    await h.resolve(data(1,0,0));assert.match(h.text(),/暂无匹配/);assert.equal(h.button('下一页').props.disabled,true);
    h.input('match');h.flushSearch();await h.resolve(data(1,2,2));h.identity(8);assert.equal(h.rows().length,0);h.flushSearch();await h.resolve(data(1,2,2));assert.ok(h.rows().every(n=>n.children[0].props.disabled));
  }finally{h.close();}
});
test('only eligible own customers can be chosen and cancel performs no selection',async()=>{
  const h=harness();try{
    const value=data(1,3,3);value.records[1].maintenanceEnabled=false;value.records[2].agentAdminId=8;await h.resolve(value);
    const buttons=h.rows().map(n=>n.children[0]);assert.deepEqual(buttons.map(b=>b.props.disabled),[false,true,true]);
    buttons[0].props.onClick();assert.deepEqual(h.selected,['1']);
    h.tree.props.onClose();assert.equal(h.closed,1);assert.equal(h.selected.length,1);
  }finally{h.close();}
});
test('a shrinking authorized result set returns to its last valid page instead of showing page two of one',async()=>{
  const h=harness();try{
    await h.resolve(data(1,10));h.click('下一页');await h.resolve(data(1,0,3));
    assert.equal(h.calls.at(-1).options.pageNum,1);assert.equal(h.rows().length,0);
    await h.resolve(data(1,3,3));assert.equal(h.rows().length,3);assert.match(h.text(),/第 1 \/ 1 页/);
  }finally{h.close();}
});
