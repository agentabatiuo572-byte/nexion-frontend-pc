import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { allowedPromotionRoute } from '../lib/admin/promotion-routes.ts';
import { acknowledgePromotionCommand, promotionCommand, recoverPromotionCommand, pendingPromotionCommands, promotionVersions, promotionFieldLabel } from '../lib/admin/promotion-client.ts';
import { changeRewardType, changeTemplate, dateInput, utcInput, newPurchaseRule } from '../lib/admin/promotion-form.ts';
import * as promotionForm from '../lib/admin/promotion-form.ts';

// Execute the real editor and its handlers; state doubles avoid a test-owned navigation implementation.
function editorHarness({writable=true,invalid=false,onSaved=async()=>{}}={}) {
  const states=[],components=new Map(),require=createRequire(import.meta.url);let index=0;
  const ui=new Proxy({text:v=>typeof v==='string'?v:'',TEMPLATE_LABELS:{SKU_GIFT:'单设备赠礼'}},{get:(object,key)=>{if(key in object)return object[key];if(!components.has(key))components.set(key,()=>null);return components.get(key);}});
  const code=ts.transpileModule(readFileSync(new URL('../app/components/domain-views/h-tabs/h4-promotion-editor.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','exports','module',code)(name=>{
    if(name==='react')return {useState:initial=>{const key=index++;if(!(key in states))states[key]=typeof initial==='function'?initial():initial;return [states[key],value=>{states[key]=typeof value==='function'?value(states[key]):value;}];},useEffect:()=>{}};
    if(name==='react/jsx-runtime')return require(name);
    if(name.endsWith('promotion-form'))return promotionForm;
    if(name.endsWith('promotion-client'))return {promotionRead:()=>assert.fail('unexpected read')};
    if(name.endsWith('h4-promotion-ui'))return ui;
    assert.fail('unexpected import '+name);
  },module.exports,module);
  const activity={activityId:'A1',state:'DRAFT',current:{revision:1,version:1,state:'DRAFT',draft:{...promotionForm.emptyDraft('SKU_GIFT'),name:'Original'}},impact:{budgets:[]}};
  const props={activity,catalog:{policies:[],ranks:[],markets:[],skus:[]},can:()=>writable,onSaved,onBack:()=>{},onReview:()=>{}};
  const render=()=>{index=0;const nodes=[];const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;nodes.push(node);walk(node.props?.children);};walk(module.exports.default(props));return nodes;};
  const text=node=>Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):String(node??'');
  const button=label=>render().find(node=>node.type===ui.Button&&text(node)===label);
  const step=target=>render().find(node=>node.type==='button'&&node.props.className?.startsWith('step')&&text(node).startsWith(String(target+1)));
  const command=()=>render().find(node=>node.type===ui.ConfirmCommand);
  const edit=()=>render().find(node=>node.type==='input'&&node.props.maxLength===200).props.onChange({target:{value:'Changed'}});
  const previousDocument=globalThis.document,reports=[];
  globalThis.document={querySelectorAll:()=>invalid?[{disabled:false,checkValidity:()=>false,reportValidity:()=>reports.push('invalid')}]:[]};
  return {render,button,step,command,edit,reports,restore:()=>{globalThis.document=previousDocument;}};
}

test('Next saves dirty input and advances only after successful server readback',async()=>{
  const saved=[];const editor=editorHarness({onSaved:async step=>saved.push(step)});
  try{editor.edit();editor.button('下一步').props.onClick();assert.equal(editor.step(0).props.className,'step active');assert.equal(editor.command().props.body.draft.name,'Changed');await editor.command().props.onSuccess();assert.deepEqual(saved,[1]);assert.equal(editor.step(1).props.className,'step active');assert.equal(editor.command(),undefined);}finally{editor.restore();}
});
test('top step navigation uses the same save confirmation and cancellation keeps inputs',()=>{
  const editor=editorHarness();try{editor.edit();editor.step(2).props.onClick();assert(editor.command());editor.command().props.onClose();assert.equal(editor.step(0).props.className,'step active');assert.equal(editor.render().find(node=>node.type==='input'&&node.props.maxLength===200).props.value,'Changed');assert.equal(editor.command(),undefined);}finally{editor.restore();}
});
test('failed readback never advances and keeps the original command available',async()=>{
  const editor=editorHarness({onSaved:async()=>{throw Error('read unavailable');}});try{editor.edit();editor.button('下一步').props.onClick();await assert.rejects(editor.command().props.onSuccess(),/read unavailable/);assert.equal(editor.step(0).props.className,'step active');assert(editor.command());}finally{editor.restore();}
});
test('invalid current inputs prevent step change before saving',()=>{
  const editor=editorHarness({invalid:true});try{editor.edit();editor.button('下一步').props.onClick();assert.deepEqual(editor.reports,['invalid']);assert.equal(editor.step(0).props.className,'step active');assert.equal(editor.command(),undefined);}finally{editor.restore();}
});
test('clean and read-only editors can navigate without a write',()=>{
  for(const writable of [true,false]){const editor=editorHarness({writable});try{editor.button('下一步').props.onClick();assert.equal(editor.step(1).props.className,'step active');assert.equal(editor.command(),undefined);}finally{editor.restore();}}
});

test('proxy accepts only contract methods and paths, including partial draft PUT', () => {
  assert.equal(allowedPromotionRoute(['promotions','a','draft'],'PUT'),true);
  assert.equal(allowedPromotionRoute(['promotions','a','withdraw'],'POST'),true);
  assert.equal(allowedPromotionRoute(['promotion-rewards','r','reverse'],'POST'),true);
  assert.equal(allowedPromotionRoute(['promotion-rewards','r','delete'],'POST'),false);
  assert.equal(allowedPromotionRoute(['promotions','a','draft'],'DELETE'),false);
  assert.equal(allowedPromotionRoute(['promotions','..','draft'],'PUT'),false);
  assert.equal(allowedPromotionRoute(['promotion-catalog','anything'],'GET'),false);
});

test('uncertain command survives and blocks changed payload; recovery uses the original key', async () => {
  const calls=[];
  globalThis.fetch=async (url,init)=>{calls.push({url,init});throw new TypeError('Failed to fetch');};
  const intent={operation:'saveDraft',targetId:'test-a',path:'/promotions/test-a/draft',method:'PUT',body:{expectedRevision:1,reason:'保留原样提交测试',draft:{name:'原稿'}}};
  await assert.rejects(promotionCommand(intent), /结果尚未确认/);
  const stored=pendingPromotionCommands().find(x=>x.targetId==='test-a');
  assert.ok(stored);
  await assert.rejects(promotionCommand({...intent,body:{...intent.body,reason:'修改理由应该阻止'}}), /先核查/);
  assert.equal(calls.length,1);
  globalThis.fetch=async url=>{calls.push({url});return new Response(JSON.stringify({code:0,data:{status:'NOT_FOUND',operation:'saveDraft',targetId:'test-a',idempotencyKey:stored.commandKey,resource:null}}));};
  const receipt=await recoverPromotionCommand(stored);
  assert.equal(receipt.status,'NOT_FOUND');
  assert.ok(calls.at(-1).url.includes(encodeURIComponent(stored.commandKey)));
  globalThis.fetch=async (url,init)=>{calls.push({url,init});return new Response(JSON.stringify({code:0,data:{status:'SUCCEEDED',operation:'saveDraft',targetId:'test-a',idempotencyKey:stored.commandKey,resource:{type:'VERSION',id:'test-a:1',revision:2}}}));};
  const success=await promotionCommand(intent,true);
  assert.equal(pendingPromotionCommands()[0].receipt.status,'SUCCEEDED');
  await assert.rejects(promotionCommand(intent),/先核查/);
  acknowledgePromotionCommand(success);
  assert.equal(calls.at(-1).init.headers['Idempotency-Key'],stored.commandKey);
  assert.equal(pendingPromotionCommands().length,0);
});

test('deterministic rejection keeps server field details and clears only that attempt', async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({code:422,message:'PROMOTION_FIELD_INVALID:rules',data:{fieldErrors:[{field:'rules',reason:'INVALID_OR_MISSING'}]}}),{status:422});
  await assert.rejects(promotionCommand({operation:'createPromotion',targetId:'promotions',path:'/promotions',method:'POST',body:{reason:'可审核的创建原因',draft:{category:'PROMOTION',template:'SKU_GIFT'}}}),error=>error.status===422&&error.fieldErrors[0].field==='rules');
  assert.equal(pendingPromotionCommands().length,0);
});

test('changing a reward type preserves identity and removes incompatible values',()=>{
  const original={rewardRuleId:'stable-r',beneficiaryRole:'DIRECT_INVITER',type:'USDT',amount:'2.123456',assetPolicy:{policyId:'p',version:2,contentHash:'hash'}};
  const gift=changeRewardType(original,'DEVICE','DIRECT_INVITER');
  assert.equal(gift.rewardRuleId,'stable-r');assert.equal(gift.beneficiaryRole,'DIRECT_INVITER');assert.equal(gift.quantity,null);assert.equal(gift.deviceRightsProfile,null);assert.equal('amount'in gift,false);assert.equal('assetPolicy'in gift,false);
  assert.equal(original.amount,'2.123456');
});
test('new rules and beneficiaries receive distinct identities while editing preserves the original',()=>{
  const first=newPurchaseRule(),second=newPurchaseRule();assert.notEqual(first.ruleId,second.ruleId);
  const buyer=changeRewardType(null,'USDT','BUYER'),inviter=changeRewardType(null,'NEX','DIRECT_INVITER');assert.notEqual(buyer.rewardRuleId,inviter.rewardRuleId);
  assert.equal(changeRewardType(buyer,'DEVICE','BUYER').rewardRuleId,buyer.rewardRuleId);
  assert.equal(structuredClone(first).ruleId,first.ruleId);
});
test('template change clears incompatible configuration without losing public information',()=>{
  const next=changeTemplate({category:'PROMOTION',template:'SKU_GIFT',name:'内部名称',title:{zh:'标题'},rules:[{ruleId:'a'}],budgets:[{asset:'USDT',total:'100.000000'}]},'DIRECT_REFERRAL');
  assert.equal(next.category,'REFERRAL');assert.equal(next.rules,null);assert.equal(next.budgets,null);assert.equal(next.name,'内部名称');assert.deepEqual(next.title,{zh:'标题'});
});
test('date controls roundtrip in the selected time zone without browser-local drift',()=>{
  for(const zone of ['UTC','Asia/Tokyo','Asia/Ho_Chi_Minh'])assert.equal(dateInput(utcInput('2026-10-08T09:15',zone),zone),'2026-10-08T09:15');
  assert.equal(utcInput('2026-10-08T09:15','Asia/Tokyo'),'2026-10-08T00:15:00.000Z');
  assert.equal(utcInput('','UTC'),null);
});

test('a bound success remains recoverable until the view has read back the resource',async()=>{
  let writes=0;
  const intent={operation:'createPromotion',targetId:'readback-test',path:'/promotions',method:'POST',body:{reason:'成功回执等待页面回读',draft:{category:'PROMOTION',template:'SKU_GIFT'}}};
  globalThis.fetch=async(url,init)=>{writes++;return new Response(JSON.stringify({code:0,data:{status:'SUCCEEDED',operation:intent.operation,targetId:intent.targetId,idempotencyKey:init.headers['Idempotency-Key'],resource:{type:'PROMOTION',id:'p1',revision:1}}}));};
  const receipt=await promotionCommand(intent);
  const record=pendingPromotionCommands().find(r=>r.targetId===intent.targetId);
  assert.equal(record.receipt.resource.id,'p1');
  await assert.rejects(promotionCommand(intent),/先核查/);assert.equal(writes,1);
  acknowledgePromotionCommand(receipt);assert.equal(pendingPromotionCommands().length,0);
});

test('unavailable persistent storage refuses dispatch rather than losing the original command',async()=>{
  let writes=0;globalThis.fetch=async()=>{writes++;throw Error('Must not dispatch');};
  globalThis.window={sessionStorage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}}};
  try{await assert.rejects(promotionCommand({operation:'saveDraft',targetId:'storage-test',path:'/promotions/storage-test/draft',method:'PUT',body:{draft:{name:'不能丢失'},reason:'验证存储拒绝'}}),/无法保留原命令/);assert.equal(writes,0);}finally{delete globalThis.window;}
});

test('version selection reads every page and field errors never expose internal paths',async()=>{
  const urls=[];globalThis.fetch=async url=>{urls.push(url);return new Response(JSON.stringify({code:0,data:urls.length===1?{items:[{version:2}],hasMore:true,nextCursor:'older'}:{items:[{version:1}],hasMore:false,nextCursor:null}}));};
  assert.deepEqual((await promotionVersions('p1')).items.map(v=>v.version),[2,1]);assert.match(urls[1],/cursor=older/);
  assert.equal(promotionFieldLabel('$.draft.rules[2].buyerReward.amount'),'购买规则 / 购买者奖励 / 资产奖励金额');
});
