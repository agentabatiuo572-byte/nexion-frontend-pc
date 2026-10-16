import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const owner=60723153007, member=60723153019;
const record={ownerUserId:owner,memberUserId:member,leg:null,assignedBy:null,assignedAt:null,assignmentSource:null};
const page=(records=[record],extra={})=>({ownerUserId:owner,status:'ALL',page:1,pageSize:20,total:records.length,records,...extra});
class PlacementError extends Error{constructor(message,outcome,status){super(message);this.outcome=outcome;this.status=status;}}
function harness({write=async i=>({...i,replayed:false}),read=async()=>page(),writable=true}={}){
  const auth={session:{adminId:1,authorities:['network_f3_read',...(writable?['network_f3_write']:[])]},authEpoch:1},calls=[];
  const key=(s,e)=>`${s?.adminId}:${e}:${s?.authorities.join(',')}`;
  const useAdminAuth=selector=>selector(auth);useAdminAuth.getState=()=>auth;
  const states=[],effects=[];let cursor=0,scheduled=[],component;
  const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef(initial){const i=cursor++;return states[i]??(states[i]={current:initial});},useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((v,n)=>!Object.is(v,effects[i].deps[n])))scheduled.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
  const jsx=(type,props)=>({type,props}),module={exports:{}};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../app/components/domain-views/f-tabs/f3-placements.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,Error,require:id=>{
    if(id==='react')return react;if(id==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'fragment'};
    if(id.endsWith('admin-auth'))return {useAdminAuth};if(id.endsWith('shell-authorities'))return {adminShellSessionKey:key};
    if(id.endsWith('error-messages'))return {displayAdminError:e=>e.message};if(id==='../design-kit')return {Modal:'Modal'};
    if(id.endsWith('f3-placements-client'))return {PlacementError,readPlacements:async(...args)=>{calls.push(['GET',...args]);return read(...args);},assignPlacement:async i=>{calls.push(['POST',i]);return write(i);}};
    throw Error(id);
  }});component=module.exports.F3Placements;
  function render(){for(let i=0;i<10;i++){cursor=0;scheduled=[];const tree=component();if(!scheduled.length)return tree;scheduled.forEach(fn=>fn());}throw Error('render loop');}
  return {render,calls,auth};
}
function nodes(v){if(Array.isArray(v))return v.flatMap(nodes);return v&&typeof v==='object'?[v,...nodes(v.props?.children),...nodes(v.props?.footer)]:[];}
function text(v){if(Array.isArray(v))return v.map(text).join('');return v&&typeof v==='object'?text(v.props?.children):String(v??'');}
const button=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&text(n)===label);
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function query(h){let tree=h.render();nodes(tree).find(n=>n.type==='input').props.onChange({target:{value:String(owner)}});tree=h.render();nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();return h.render();}
async function choose(h){const tree=await query(h);button(tree,'安置到 A 轨').props.onClick();return h.render();}

test('real component queries owner, displays fixed identities and cancel sends no mutation',async()=>{
  const h=harness();const tree=await choose(h);assert.match(text(tree),new RegExp(String(owner)));assert.match(text(tree),new RegExp(String(member)));assert.match(text(tree),/目标轨道：A 轨/);
  button(tree,'取消').props.onClick();assert.equal(nodes(h.render()).some(n=>n.type==='Modal'),false);assert.equal(h.calls.filter(c=>c[0]==='POST').length,0);
});
test('read permission and write permission remain distinct; assigned rows cannot move',async()=>{
  const h=harness({writable:false});assert.equal(button(await query(h),'安置到 A 轨'),undefined);
  const assigned=harness({read:async()=>page([{...record,leg:'B',assignmentSource:'MANUAL'}])});assert.equal(button(await query(assigned),'安置到 A 轨'),undefined);
  h.auth.session.authorities=[];assert.equal(h.render(),null);
});
test('same-track replay and successful response refresh original owner; double click sends once',async()=>{
  let resolve;const h=harness({write:i=>new Promise(r=>resolve=()=>r({...i,replayed:true}))});let tree=await choose(h);
  const click=button(tree,'确认安置').props.onClick;click();click();assert.equal(h.calls.filter(c=>c[0]==='POST').length,1);
  resolve();await flush();tree=h.render();assert.match(text(tree),/无需重复安置/);assert.equal(h.calls.filter(c=>c[0]==='GET').length,2);
});
test('unknown auto-reads exact original member, never POST retries; unassigned remains unknown',async()=>{
  const h=harness({write:async()=>{throw new PlacementError('结果待确认','unknown',503);}});let tree=await choose(h);const click=button(tree,'确认安置').props.onClick;click();await flush();tree=h.render();
  assert.match(text(tree),/原提交结果尚未确认/);assert.deepEqual(h.calls.at(-1),['GET',owner,'ALL',1,member]);
  click();button(tree,'查询原成员结果').props.onClick();await flush();assert.equal(h.calls.filter(c=>c[0]==='POST').length,1);
});
test('409 reads actual opposite leg and does not overwrite; absent member cannot imply failure',async()=>{
  for(const rows of [[{...record,leg:'B'}],[]]){
    const h=harness({write:async()=>{throw new PlacementError('已变化','rejected',409);},read:async(o,s,p,m)=>m?page(rows):page()});
    button(await choose(h),'确认安置').props.onClick();await flush();const tree=h.render();
    assert.match(text(tree),rows.length?/不能改到 A 轨/:/无法确认原成员/);assert.equal(h.calls.filter(c=>c[0]==='POST').length,1);
  }
});
test('account switch rejects old confirm callback and ignores delayed GET',async()=>{
  const h=harness();const tree=await choose(h);h.auth.authEpoch++;button(tree,'确认安置').props.onClick();await flush();assert.equal(h.calls.filter(c=>c[0]==='POST').length,0);h.render();assert.doesNotMatch(text(h.render()),new RegExp(String(member)));
  let resolve;const delayed=harness({read:()=>new Promise(r=>resolve=r)});let t=delayed.render();nodes(t).find(n=>n.type==='input').props.onChange({target:{value:String(owner)}});t=delayed.render();nodes(t).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});delayed.auth.authEpoch++;delayed.render();resolve(page());await flush();assert.doesNotMatch(text(delayed.render()),new RegExp(String(member)));
});
test('pagination and status send backend filters, not local counts',async()=>{
  const h=harness({read:async(o,s,p)=>page([record],{status:s,page:p,total:21})});let tree=await query(h);button(tree,'下一页').props.onClick();await flush();assert.deepEqual(h.calls.at(-1),['GET',owner,'ALL',2]);
  tree=h.render();nodes(tree).find(n=>n.type==='select').props.onChange({target:{value:'UNASSIGNED'}});tree=h.render();nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();assert.deepEqual(h.calls.at(-1),['GET',owner,'UNASSIGNED',1]);
});
