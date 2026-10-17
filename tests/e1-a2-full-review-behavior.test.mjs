import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {summarizeSkuCreation,summarizeSkuProposal} from '../lib/admin/e1-a2-proposal-summary.ts';
import {formToSku,skuToForm,validateGateForm} from '../app/components/domain-views/e-tabs/data.ts';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../app/components/domain-views/e-view.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('e-view.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let open,submit;
function visit(n){
 if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='openSkuSaveConfirm')open=n.initializer.getText(ast);
 if(ts.isJsxAttribute(n)&&n.name.getText(ast)==='onConfirm'&&n.initializer?.expression?.getText(ast).includes('sku-save'))submit=n.initializer.expression.getText(ast);
 ts.forEachChild(n,visit);
}visit(ast);
function compile(expression,bindings){const js=ts.transpileModule('const fn='+expression,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;return new Function(...Object.keys(bindings),js+';return fn;')(...Object.values(bindings));}
const full={id:'uvelbox-s1-trade-in',name:'UVELBox S1 Trade-in',tier:'Entry',lifecycle:'active',status:'on',price:1499,dailyEarn:1,dailyEarnNEX:1,inventoryMode:'FINITE',stock:1,unlock:'seed',tag:'',datacenter:'US-EAST-2',gpu:'4090',vram:'96GB',hashRate:'120THs',power:'65W',tagline:'完整规格卖点'.repeat(50),features:['原始真实规格','<script>不得执行</script>'],aiImageGenPerMin:2,aiLlmTokensPerSec:50,trialEligible:false};
function fixture(edit=false,version=1){
 const old={...full,price:1299,stock:3,datacenter:'旧机房',gpu:'旧GPU',tagline:'旧卖点'};
 const opened=[],toasts=[],proposals=[],closed=[];const form=skuToForm(full);
 const b={e1Gates:{skuReviewContractVersion:version},skuMediaUploading:false,skuMedia:null,form,skuDatacenterDefault:'US-EAST-2',skuDatacenterSet:new Set(['US-EAST-2']),editSkuId:edit?full.id:null,skus:edit?[old]:[],validateSkuUnlockPool:()=>'',validateGateForm,attachSkuMedia:s=>s,formToSku,summarizeSkuCreation,summarizeSkuProposal,setToast:v=>toasts.push(v),openActionConfirm:v=>opened.push(v),setSkuDrawer:v=>closed.push(v),mc:{op:'sku-save',name:'商品变更'},isE2TaskMutation:()=>false,isE2ConfigMutation:()=>false,setActionConfirm:v=>closed.push(v),setEditSkuId:()=>{},resetSkuMedia:()=>{},ctx:{toast:()=>{}},findHighOp:()=>({type:'param',gateLabel:'门槛者',buildCommand:v=>({domain:'E',op:edit?'e1_sku_update':'e1_sku_create',params:v}),buildTarget:v=>({domain:'E',type:'device_sku',id:v.skuId})}),propose:async(_toast,p)=>proposals.push(p)};
 return {b,opened,toasts,proposals,closed,open:()=>compile(open,b)(),submit:()=>compile(submit,b)('真实完整商品修改理由')};
}
for(const edit of [false,true])test(`actual E1 ${edit?'update':'create'} opens confirmation and submits every field`,async()=>{
 const f=fixture(edit);f.open();assert.equal(f.opened.length,1);assert.deepEqual(f.toasts,[]);await f.submit();assert.equal(f.proposals.length,1);
 const p=f.proposals[0];assert.equal(p.command.params.gpu,full.gpu);assert.equal(p.command.params.datacenter,full.datacenter);assert.deepEqual(p.command.params.features,full.features);assert.ok(p.after.includes(full.tagline));assert.equal(p.target.id,full.id);assert.equal(p.reason,'真实完整商品修改理由');
});
for(const version of [undefined,0,2,'1'])test(`older/unrecognized BE ${version} preserves draft and never proposes`,async()=>{
 const f=fixture(false,version);f.b.e1Gates.skuReviewContractVersion=version;f.open();assert.equal(f.opened.length,0);assert.deepEqual(f.closed,[]);await assert.rejects(f.submit(),/完整审核服务尚未就绪/);assert.equal(f.proposals.length,0);
});
test('actual E1 still rejects invalid stock and missing edit snapshot',()=>{
 const f=fixture();f.b.form.stock='1.5';f.open();assert.equal(f.opened.length,0);assert.match(f.toasts[0],/库存/);
 const g=fixture(true);g.b.skus=[];g.open();assert.equal(g.opened.length,0);assert.match(g.toasts[0],/原商品快照/);
});
const a2source=readFileSync(new URL('../app/components/domain-views/a-tabs/a2-audit.tsx',import.meta.url),'utf8');
const a2ast=ts.createSourceFile('a2.tsx',a2source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const fn=a2ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='A2ChangeReview');
const js=ts.transpileModule(fn.getText(a2ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const exports={};new Function('require','exports',js)(require,exports);
test('new SKU empty canonical before snapshot is explicit',()=>{
 const html=renderToStaticMarkup(React.createElement(exports.A2ChangeReview,{before:'{}',after:JSON.stringify(full)}));
 assert.ok(html.includes('无原值 / 未创建'));
 assert.ok(html.includes('UVELBox S1 Trade-in'));
});
test('actual A2 renderer retains late fields, multiline values, unknown fields and escapes markup',()=>{
 const html=renderToStaticMarkup(React.createElement(exports.A2ChangeReview,{before:'历史原文\n未创建',after:JSON.stringify({...full,customFutureField:'末尾未丢失',purchaseGate:{rankMin:0,activeDirectMin:5,teamVolumeMin:20000,enforce:false},features:['<script>danger</script>','尾项']})}));
 for(const value of ['历史原文','未创建','数据中心','US-EAST-2','GPU','4090','产品特性','尾项','末尾未丢失','最低 V 等级','启用限制：否'])assert.ok(html.includes(value),value);
 assert.ok(html.includes('&lt;script&gt;danger&lt;/script&gt;'));assert.ok(!html.includes('<script>'));
 assert.ok(html.includes('white-space:pre-wrap'));assert.ok(html.includes('overflow-wrap:anywhere'));
 assert.ok(html.includes('最低有效直推：5'));assert.ok(html.includes('最低团队业绩：20000'));
 assert.ok(!html.includes('activeDirectMin'));assert.ok(!html.includes('teamVolumeMin'));
 assert.equal((a2source.match(/<A2ChangeReview before=\{w.before\} after=\{w.after\} \/>/g)||[]).length,2);
});
