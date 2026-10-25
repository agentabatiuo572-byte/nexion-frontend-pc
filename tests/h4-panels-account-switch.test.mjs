import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const flush = async () => { for (let i=0;i<8;i++) await Promise.resolve(); };
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree==='object' ? [tree,...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree==='object' ? text(tree.props?.children) : String(tree??'');
const button = (tree,label) => nodes(tree).find(node=>node.type==='button' && text(node)===label);
function mount(kind, ruleOverrides={}) {
  const auth={operator:'admin-a',read:true,voucherRead:true}, slots=[], effects=[], voucherRequests=[]; let cursor=0,jobs=[],confirm,resolve;
  const write = () => new Promise(done=>{resolve=done;});
  const row = () => kind==='rules' ? {eventCode:'evt-test',kind:'wheel',revision:1,enabled:false,rulesLocked:false,startsAt:null,endsAt:null,rules:{},readiness:{ready:false,missing:[]},...ruleOverrides}
    : {id:'raffle',titleZh:auth.operator,titleEn:'Raffle',titleVi:'Raffle',startsAt:'2030-01-01T00:00:00Z',drawAt:'2030-01-02T00:00:00Z',status:'DRAFT',revision:1,totalEntries:0,prizes:[]};
  const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((v,n)=>!Object.is(v,effects[i].deps[n])))jobs.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
  const jsx=(type,props)=>({type,props}),module={exports:{}};
  const source=readFileSync(new URL(`../app/components/domain-views/h-tabs/h4-${kind==='rules'?'event-rules':'genesis-raffle'}.tsx`,import.meta.url),'utf8');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,require:id=>{
    if(id==='react')return react;if(id==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'fragment'};
    if(id.endsWith('current-operator'))return{currentAdminOperator:()=>auth.operator};
    if(id.endsWith('error-messages'))return{displayAdminError:e=>e.message};
    if(id.endsWith('event-rules-client'))return{fetchEventRules:async()=>[row()],updateEventRule:write,fetchEventVouchers:()=>new Promise((resolve,reject)=>voucherRequests.push({resolve,reject}))};
    if(id.endsWith('event-rule-form'))return{EVENT_KIND_LABELS:{wheel:'转盘',seasonal:'节日促销'},eventRuleDraftRules:r=>r.rules,eventRuleFields:r=>r.kind==='seasonal'?[{key:'voucherId',label:'关联全场八折券',type:'voucher'}]:[],eventRuleMissingLabel:k=>k,eventRegionText:()=>'',parseEventRegions:()=>[]};
    if(id.endsWith('genesis-raffle-client'))return{fetchAdminRaffles:async()=>[row()],saveAdminRaffle:write,raffleDraftError:()=>''};
    throw Error(id);
  }});
  const ctx={can:p=>p==='growth_h7_read'?auth.voucherRead:!p.endsWith('_read')||auth.read,openActionConfirm:value=>{confirm=value;},toast:()=>{}};
  function render(){for(let i=0;i<8;i++){cursor=0;jobs=[];const tree=module.exports.default({ctx});if(!jobs.length)return tree;jobs.forEach(fn=>fn());}throw Error('render loop');}
  return{auth,row,render,voucherRequests,start:()=>confirm.run('change'),finish:()=>resolve(row())};
}
for(const kind of ['rules','raffle'])for(const change of ['operator','read'])test(`${kind}: ${change} change clears old saving state and ignores late save`,async()=>{
  const h=mount(kind);h.render();await flush();let tree=h.render();
  const entry=nodes(tree).find(node=>node.type==='button' && text(node).includes(kind==='rules'?'evt-test':'admin-a'));
  entry.props.onClick();tree=h.render();button(tree,'保存配置').props.onClick();const pending=h.start();
  assert.match(text(h.render()),/正在保存/);
  if(change==='operator')h.auth.operator='admin-b';else h.auth.read=false;
  h.render();if(change==='read'){h.auth.read=true;h.render();}await flush();tree=h.render();
  assert.equal(button(tree,'刷新').props.disabled,false);
  h.finish();await pending;tree=h.render();
  assert.equal(button(tree,'刷新').props.disabled,false);assert.doesNotMatch(text(tree),/正在保存/);
  assert.equal(button(tree,'保存配置'),undefined);
});

const voucherPicker = tree => nodes(tree).find(node=>node.type==='select' && node.props['aria-label']==='关联全场八折券');
async function seasonalPanel(){
  const h=mount('rules',{kind:'seasonal',rules:{voucherId:'BF20'}});
  h.render();await flush();nodes(h.render()).find(node=>node.type==='button' && text(node).includes('evt-test')).props.onClick();h.render();return h;
}
test('seasonal picker retains a configured voucher on lookup failure and recovers from the real catalogue',async()=>{
  const h=await seasonalPanel();
  assert.equal(voucherPicker(h.render()).props.value,'BF20');
  h.voucherRequests[0].reject(new Error('目录读取失败'));await flush();let tree=h.render();
  assert.equal(voucherPicker(tree).props.disabled,true);assert.equal(voucherPicker(tree).props.value,'BF20');
  assert.match(text(tree),/目录读取失败/);
  button(tree,'重试读取优惠券').props.onClick();h.render();
  h.voucherRequests[1].resolve([{id:'BF20',name:'黑五八折',percent:20,status:'active'},{id:'OLD20',name:'旧券',percent:20,status:'paused'}]);await flush();tree=h.render();
  assert.equal(voucherPicker(tree).props.disabled,false);assert.match(text(tree),/黑五八折/);
  assert.equal(nodes(tree).find(node=>node.type==='option'&&node.props.value==='OLD20').props.disabled,true);
});
test('seasonal picker clears options after H7 permission loss and ignores the late catalogue',async()=>{
  const h=await seasonalPanel();h.auth.voucherRead=false;h.render();
  h.voucherRequests[0].resolve([{id:'BF20',name:'旧账号券',percent:20,status:'active'}]);await flush();const tree=h.render();
  assert.equal(voucherPicker(tree).props.disabled,true);assert.equal(voucherPicker(tree).props.value,'BF20');
  assert.match(text(tree),/需要 H7 查看权限/);assert.doesNotMatch(text(tree),/旧账号券/);
});
test('seasonal picker ignores the previous account catalogue after switching operators',async()=>{
  const h=await seasonalPanel();h.auth.operator='admin-b';h.render();await flush();h.render();
  h.voucherRequests[0].resolve([{id:'BF20',name:'旧账号券',percent:20,status:'active'}]);await flush();let tree=h.render();
  assert.equal(voucherPicker(tree),undefined);
  nodes(tree).find(node=>node.type==='button' && text(node).includes('evt-test')).props.onClick();tree=h.render();
  assert.doesNotMatch(text(tree),/旧账号券/);assert.equal(voucherPicker(tree).props.disabled,true);
});
