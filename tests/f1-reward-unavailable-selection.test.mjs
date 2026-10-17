import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const read = p => readFileSync(new URL('../'+p, import.meta.url), 'utf8');
const kit = read('app/components/domain-views/design-kit.tsx');
const page = read('app/components/domain-views/f-tabs/f1-vrank.tsx');
function declaration(source, name) {
  const sf = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(n) {
    if ((ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) && n.name?.getText(sf) === name) found = n;
    ts.forEachChild(n, visit);
  }
  visit(sf); assert.ok(found, name);
  return ts.isVariableDeclaration(found) ? 'const '+found.getText(sf)+';' : found.getText(sf);
}
function load(source, names, bindings={}) {
  const code = names.map(n=>declaration(source,n)).join('\n')+'\nexports.result={'+names.join(',')+'};';
  const js = ts.transpileModule(code,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const exports={}; new Function('exports','require',...Object.keys(bindings),js)(exports,require,...Object.values(bindings));
  return exports.result;
}
const { initBusinessForm, missingBusinessFields, BusinessFormBlock } = load(kit,['initBusinessForm','missingBusinessFields','BusinessFormBlock'],{
  useState: v=>[typeof v==='function'?v():v,()=>{}], useRef:v=>({current:v}), useEffect:f=>f()
});
const canConfirmSource=declaration(kit,'canConfirm');
function confirmAllowed(missing) {
  return new Function('businessMissing','reasonPolicyReady','covBlocked','businessSelectionLoading','submitting','reasonOk','editValueOk','uploadBlocked',canConfirmSource+'return canConfirm;')(missing,true,false,false,false,true,true,false);
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node!=='object') return [];
  return [node,...nodes(node.props?.children)];
}
function setup(type, options=['valid']) {
  let captured, updates=[];
  const ctx={voucherOptions:type==='voucher'?options:[],skuOptions:type==='sku'?options:[],voucherLabels:{valid:'本轮有效券'},skuLabels:{valid:'在售商品'},openActionConfirm:x=>captured=x,updateReward:async(...args)=>updates.push(args),toast:()=>{}};
  const {openEditReward}=load(page,['rewardFields','rewardFormBase','openEditReward'],{ctx,isFund:()=>false,rewardLabel:()=>type});
  openEditReward({v:'V1'},{id:'reward-1',type,[type==='voucher'?'voucherId':'skuId']:'expired'});
  const spec=captured.businessForm; let value=initBusinessForm(spec);
  const render=()=>BusinessFormBlock({spec,value,onChange:v=>value=v,onUploadStateChange:()=>{}});
  return {spec,captured,updates,render,get value(){return value;}};
}
for (const type of ['voucher','sku']) {
  test(type+': unavailable current reference stays visible and cannot submit unchanged',()=>{
    const s=setup(type); const key=type==='voucher'?'voucherId':'skuId';
    assert.equal(s.value[key],'expired','opening editor must not silently replace a configured reward');
    const select=nodes(s.render()).find(n=>n.type==='select' && n.props.value==='expired');
    assert.ok(select);
    const selected=nodes(select).find(n=>n.type==='option' && n.props.value==='expired');
    assert.ok(selected,'controlled old value needs a visible option, otherwise browser displays first valid option');
    assert.equal(selected.props.disabled,true);
    assert.match(String(selected.props.children),/不可用|失效/);
    assert.equal(confirmAllowed(missingBusinessFields(s.spec,s.value)),false);
  });
  test(type+': explicit choice of sole valid option reaches actual F1 update callback',async()=>{
    const s=setup(type);const key=type==='voucher'?'voucherId':'skuId';
    const select=nodes(s.render()).find(n=>n.type==='select' && n.props.value==='expired');
    select.props.onChange({target:{value:'valid'}});
    assert.equal(s.value[key],'valid');
    assert.equal(confirmAllowed(missingBusinessFields(s.spec,s.value)),true);
    await s.captured.run('更换失效引用',s.value);
    assert.equal(s.updates.length,1); assert.equal(s.updates[0][2][key],'valid');
    assert.equal(s.updates[0][0],'V1');assert.equal(s.updates[0][1],'reward-1');
  });
  test(type+': stale nonempty reference blocked with empty catalogue',()=>{
    const s=setup(type,[]); assert.equal(confirmAllowed(missingBusinessFields(s.spec,s.value)),false);
  });
  test(type+': existing valid reference remains valid',()=>{
    const s=setup(type,['expired','valid']); assert.equal(confirmAllowed(missingBusinessFields(s.spec,s.value)),true);
  });
}
