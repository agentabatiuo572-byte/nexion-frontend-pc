import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const read = p => readFileSync(new URL('../'+p, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, {compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function declaration(source, name) {
  const sf = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(n) {
    if ((ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) && n.name?.getText(sf) === name) found=n;
    ts.forEachChild(n,visit);
  }
  visit(sf); assert.ok(found,name);
  return ts.isVariableDeclaration(found) ? 'const '+found.getText(sf)+';' : found.getText(sf);
}
function load(source,names,bindings={}) {
  const exports={};
  new Function('exports','require',...Object.keys(bindings),compile(names.map(n=>declaration(source,n)).join('\n')+'\nexports.result={'+names.join(',')+'};'))(exports,require,...Object.values(bindings));
  return exports.result;
}
const brand={};new Function('exports',compile(read('lib/admin/brand-copy.ts')))(brand);
const kit=read('app/components/domain-views/design-kit.tsx');
const {initBusinessForm,BusinessFormBlock}=load(kit,['initBusinessForm','BusinessFormBlock'],{
  useState:v=>[typeof v==='function'?v():v,()=>{}],useRef:v=>({current:v}),useEffect:f=>f()
});
function nodes(node) {
  if(Array.isArray(node)) return node.flatMap(nodes);
  if(!node || typeof node!=='object') return [];
  return [node,...nodes(node.props?.children)];
}
function text(node) {
  if(Array.isArray(node))return node.map(text).join('');
  if(node==null)return '';
  return typeof node==='object'?text(node.props?.children):String(node);
}
function setup(skus,mode) {
  const source=read('app/components/domain-views/h-tabs/h7-voucher-config.tsx');
  let captured, calls=[];
  const data={skus},original=JSON.stringify(skus);
  const {openAdd,openEdit}=load(source,['skuList','activeSkus','skuOptions','skuLabels','toMs','toDateInput','parseVoucher','openAdd','openEdit'],{
    data,openActionConfirm:v=>captured=v,
    createH7Voucher:async(...args)=>{calls.push(args);return {};},updateH7Voucher:async(...args)=>{calls.push(args);return {};},applyResponse:()=>{},toast:()=>{}
  });
  const voucher={id:'voucher-1',name:'Custom NexGrid coupon',type:'fixed',amountUSD:1,minPurchaseUSD:10,applicableSkus:['stellarbox-s1'],claimSurfaces:['store'],status:'active',audience:'all',version:7,startAt:0,endAt:0,issuanceLimit:10};
  if(mode==='edit')openEdit(voucher);else openAdd();
  const spec=captured.businessForm;let value=initBusinessForm(spec);
  const render=()=>BusinessFormBlock({spec,value,onChange:v=>value=v,onUploadStateChange:()=>{}});
  return {captured,spec,calls,render,get value(){return value;},assertRaw:()=>assert.equal(JSON.stringify(skus),original)};
}
const official=[['stellarbox-s1','NexGridBox S1','NexGridBox S1'],['stellarbox-pro','UVELBox Pro','UVELBox Pro'],['stellarrack-p1','StellarRack P1','StellarRack P1']];
for(const mode of ['add','edit']){
  for(const [id,name,expected] of official)test(`${mode}: actual H7 selector displays ${expected}`,async()=>{
    const s=setup([Object.freeze({id,name,status:'on'})],mode);
    const button=nodes(s.render()).find(n=>n.type==='button' && text(n).includes(expected));
    assert.ok(button,'actual voucher-config SKU button uses current brand');
    assert.deepEqual(s.spec.applicableSkuOptions,[id]);
    if(mode==='edit' && id==='stellarbox-s1')assert.equal(s.value.applicableSkus,id);
    else button.props.onClick();
    assert.ok(s.value.applicableSkus.split(',').includes(id));
    await s.captured.run('TEST display',undefined,{...s.value,name:'Custom NexGrid coupon'});
    const payload=s.calls[0][mode==='edit'?1:0];
    assert.ok(payload.applicableSkus.includes(id));assert.equal(payload.name,'Custom NexGrid coupon');
    if(mode==='edit'){assert.equal(s.calls[0][0],'voucher-1');assert.equal(s.calls[0][3],7);}
    s.assertRaw();
  });
  test(`${mode}: custom, unknown, mismatched and idless catalog labels stay exact`,()=>{
    const cases=[{id:'custom',name:'StellarBox Pro'},{id:'stellarbox-pro',name:'My StellarBox Pro'},{id:'stellarbox-s1',name:'StellarRack P1'},{name:'NexGridBox S1'},{id:'stellarbox-pro',name:'StellarBox Pro '},{id:'stellarbox-pro',name:'stellarbox pro'},{id:'cloud-share',name:'Cloud Share'},{id:'hdpay1u',name:'HDPay1U'},{id:'stellarbox-pro',name:'UVELBox Pro'}];
    for(const row of cases){const s=setup([row],mode);assert.equal(s.spec.applicableSkuLabels[row.id??row.name],row.name);s.assertRaw();}
  });
}
test('H7 still excludes inactive SKUs and retains unchanged empty selection semantics',()=>{
  const s=setup([{id:'stellarbox-pro',name:'StellarBox Pro',status:'off'}],'add');
  assert.deepEqual(s.spec.applicableSkuOptions,[]);assert.equal(s.value.applicableSkus,'');
});
