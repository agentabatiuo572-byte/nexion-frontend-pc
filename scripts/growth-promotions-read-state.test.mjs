import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';
import {createHash} from 'node:crypto';
import path from 'node:path';
import * as promotionForm from '../lib/admin/promotion-form.ts';

const require=createRequire(import.meta.url);
function component(file,imports,privateExport=''){
  const code=ts.transpileModule(fs.readFileSync(new URL('../app/components/domain-views/h-tabs/'+file,import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};new Function('require','exports','module',code+(privateExport?'\nmodule.exports.'+privateExport+'='+privateExport+';':''))(imports,module.exports,module);return module.exports;
}
const ui=component('h4-promotion-ui.tsx',name=>name.startsWith('react')?require(name):name.endsWith('error-messages')?{displayAdminError:e=>e.message}:{});
const activity={activityId:'A1',name:'原活动',state:'DRAFT',current:{revision:1,draft:{}},impact:{}};
function page({catalog={data:{},loading:false,error:null},list={data:{},loading:false,error:null},current=activity,error=null,busy=false,screen='edit'}={}){
  const states={1:2,3:screen,4:'A1',5:current,6:error,7:busy};let stateIndex=0,readIndex=0;const calls=[];
  const fakeUi=new Proxy({...ui,useRead:()=>{const i=readIndex++;return {...[catalog,list][i],reload:()=>calls.push(i===0?'catalog':'list')};}},{get:(obj,key)=>key in obj?obj[key]:()=>null});
  const Editor=()=>null;
  const H4=component('h4-promotions.tsx',name=>{
    if(name==='react')return {useState:initial=>{const i=stateIndex++;return [i in states?states[i]:typeof initial==='function'?initial():initial,()=>{}];},useEffect:()=>{},useCallback:fn=>fn};
    if(name==='react/jsx-runtime')return require(name);
    if(name.endsWith('h4-promotion-ui'))return fakeUi;
    if(name.endsWith('h4-promotion-editor'))return {__esModule:true,default:Editor};
    if(name.endsWith('promotion-client'))return {pendingPromotionCommands:()=>[],promotionRead:async()=>{calls.push('activity');return activity;}};
    if(name.endsWith('promotion-form'))return promotionForm;
    if(name.endsWith('.css'))return {};
    return {__esModule:true,default:()=>null};
  }).default;
  const tree=H4({ctx:{can:()=>true},legacy:null}),nodes=[];
  const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;nodes.push(node);walk(node.props?.children);walk(node.props?.action);walk(node.props?.footer);};walk(tree);
  return {nodes,Editor,calls};
}
test('initial read state keeps the approved six-row card and four steps',()=>{
  const html=renderToStaticMarkup(ui.PromotionReadPanel({title:'购机赠奖',loading:true}));
  assert.equal((html.match(/class="skeleton-row"/g)||[]).length,6);assert.match(html,/正在读取购机赠奖/);assert.match(html,/读取结束前不允许提交/);
  const steps=renderToStaticMarkup(ui.PromotionSteps({step:2,onStep:()=>{},disabled:true}));assert.equal((steps.match(/disabled=""/g)||[]).length,4);
});
test('initial catalog and activity failures form one card with distinct recovery targets',()=>{
  const failed=page({catalog:{data:null,loading:false,error:Error('目录失败')},current:null,error:Error('活动失败')});
  const panels=failed.nodes.filter(n=>n.type===ui.PromotionReadPanel);assert.equal(panels.length,1);assert.equal(panels[0].props.loading,false);assert.deepEqual(panels[0].props.errors.map(e=>e.target),['活动目录与批准政策','当前活动版本']);assert(!failed.nodes.some(n=>n.type===failed.Editor));
});
test('catalog delay is loading instead of an empty or editable form',()=>{
  const pending=page({catalog:{data:null,loading:true,error:null}});assert(pending.nodes.some(n=>n.type===ui.PromotionReadPanel&&n.props.loading));assert(!pending.nodes.some(n=>n.type===pending.Editor));
});
test('refresh failure or delay preserves the mounted editor and blocks writes',()=>{
  const good=page().nodes.find(n=>n.type.name==='Editor');assert(good.props.can('growth_promotion_edit'));
  for(const catalog of [{data:{},loading:false,error:Error('刷新失败')},{data:{},loading:true,error:null}]){
    const stale=page({catalog});const editor=stale.nodes.find(n=>n.type===stale.Editor);assert(editor);assert.equal(editor.key,good.key);assert.equal(editor.props.can('growth_promotion_edit'),false);assert.equal(editor.props.can('growth_promotion_read'),true);
  }
});
test('returning to the list does not retain an unrelated activity write blocker',()=>{
  const list={data:{items:[],summary:{},total:0},loading:false,error:null};const returned=page({screen:'list',list,error:Error('earlier activity failure')});const create=returned.nodes.find(node=>node.type===ui.Button&&node.props.children==='新建活动');assert.equal(create.props.disabled,false);
  const stale=page({screen:'list',list:{...list,error:Error('query failure')}});assert.equal(stale.nodes.filter(node=>node.type===ui.ReadError&&node.props.target==='活动列表').length,1,'The same list failure must not repeat inside and outside its card');
});
test('failure panel discloses both objects and invokes only the selected recovery',()=>{
  const calls=[],errors=['活动目录','活动列表'].map(target=>({target,error:Error('暂不可读'),retry:()=>calls.push(target)}));
  const panel=ui.PromotionReadPanel({title:'活动中心',loading:false,errors});const html=renderToStaticMarkup(panel);assert.match(html,/活动目录/);assert.match(html,/活动列表/);
  const buttons=[];const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;if(node.type===ui.Button)buttons.push(node);walk(node.props?.children);walk(node.props?.action);};walk(panel);buttons[1].props.onClick();assert.deepEqual(calls,['活动列表']);
});
test('failed first export read retries its original task and later metric errors retry their own query',async()=>{
  const states=[],refs=[],calls=[];let stateIndex=0,refIndex=0;
  const metricUi={...ui,useRead:()=>({data:{items:[]},loading:false,error:null})};
  const Metrics=component('h4-promotion-metrics.tsx',name=>{
    if(name==='react')return {useState:initial=>{const i=stateIndex++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],next=>states[i]=typeof next==='function'?next(states[i]):next];},useRef:initial=>{const i=refIndex++;return refs[i]||(refs[i]={current:initial});}};
    if(name==='react/jsx-runtime')return require(name);
    if(name.endsWith('h4-promotion-ui'))return metricUi;
    if(name.endsWith('promotion-form'))return promotionForm;
    if(name.endsWith('promotion-client'))return {promotionRead:async route=>{calls.push(route);throw Error('read unavailable');},promotionVersions:async()=>({items:[]})};
    return {};
  }).default;
  const props={activity:{activityId:'A1',name:'activity',startsAt:'2026-10-08T00:00:00Z',endsAt:'2026-10-09T00:00:00Z'},catalog:{},can:()=>true,onBack:()=>{}};
  const render=()=>{stateIndex=0;refIndex=0;const nodes=[],walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;nodes.push(node);walk(node.props?.children);};walk(Metrics(props));return nodes;};
  // Existing returned metrics allow the actual export-success callback to perform the first task read.
  render();states[4]={querySnapshot:'Q1',asOf:'2026-10-08T00:00:00Z',from:'2026-10-08T00:00:00Z',to:'2026-10-09T00:00:00Z',timezone:'UTC',netReceivedUsdt:'0',paidOrders:0,refundUsdt:'0',quotes:0,orders:0,giftDevices:0,assets:[],salesBySku:[],breakdown:{rows:[],total:0}};states[7]=true;
  const confirm=render().find(node=>node.type===ui.ConfirmCommand);assert(confirm);await assert.rejects(confirm.props.onSuccess({resource:{type:'EXPORT',id:'E1'}}),/read unavailable/);
  let failure=render().find(node=>node.type===ui.ReadError);assert.equal(failure.props.target,'原导出任务');failure.props.retry();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['/promotion-exports/E1','/promotion-exports/E1']);
  const form=render().find(node=>node.type==='form');form.props.onSubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));failure=render().find(node=>node.type===ui.ReadError);assert.equal(failure.props.target,'活动效果查询');failure.props.retry();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls.slice(-2),['/promotions/A1/metrics','/promotions/A1/metrics']);
});
test('blocked command dialogs deny new writes and original retries while retaining original-result reads',async()=>{
  const states=[],refs=[];let stateIndex=0,refIndex=0,writes=0,reads=0,records=[];
  const gateUi=component('h4-promotion-ui.tsx',name=>{
    if(name==='react')return {useState:initial=>{const i=stateIndex++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],next=>states[i]=typeof next==='function'?next(states[i]):next];},useRef:initial=>{const i=refIndex++;return refs[i]||(refs[i]={current:initial});},useEffect:()=>{},useId:()=> 'local-test'};
    if(name==='react/jsx-runtime')return require(name);
    if(name.endsWith('promotion-client'))return {pendingPromotionCommands:()=>records,promotionCommand:async()=>{writes++;return {status:'SUCCEEDED'};},recoverPromotionCommand:async()=>{reads++;return {status:'NOT_FOUND'};},acknowledgePromotionCommand:()=>{}};
    if(name.endsWith('error-messages'))return {displayAdminError:e=>e.message};return {};
  });
  const props={title:'test only',intent:{operation:'saveDraft',targetId:'A1',path:'/promotions/A1/draft',method:'PUT'},body:{},writeAllowed:false,onClose:()=>{},onSuccess:()=>{}};
  const render=()=>{stateIndex=0;refIndex=0;const nodes=[],walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;nodes.push(node);walk(node.props?.children);walk(node.props?.footer);};walk(gateUi.ConfirmCommand(props));return nodes;};
  render();states[0]={minChars:1,maxChars:100};states[2]=false;states[4]='retained original reason';
  let button=render().find(node=>node.type===gateUi.Button&&node.props.children==='确认操作');assert.equal(button.props.disabled,true);await button.props.onClick();assert.equal(writes,0,'Handler must deny dispatch even if a stale callback is invoked');
  records=[{operation:'saveDraft',targetId:'A1',body:{reason:'retained original reason'},recoveryState:'NOT_FOUND'}];button=render().find(node=>node.type===gateUi.Button&&node.props.children==='原样重试');assert.equal(button.props.disabled,true);await button.props.onClick();assert.equal(writes,0);
  button=render().find(node=>node.type===gateUi.Button&&node.props.children==='核查原命令');assert.equal(button.props.disabled,false);await button.props.onClick();assert.equal(reads,1);assert.equal(writes,0);assert.equal(states[4],'retained original reason');
});

function simulation(read){
  const states=[],refs=[],calls=[],results=[];let stateIndex=0,refIndex=0;
  const Simulation=component('h4-promotion-review.tsx',name=>{
    if(name==='react')return {useState:initial=>{const i=stateIndex++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],next=>states[i]=typeof next==='function'?next(states[i]):next];},useRef:initial=>{const i=refIndex++;return refs[i]||(refs[i]={current:initial});}};
    if(name==='react/jsx-runtime')return require(name);
    if(name.endsWith('h4-promotion-ui'))return ui;
    if(name.endsWith('promotion-client'))return {promotionRead:async(route,query,options)=>{const call={route,method:options.method,body:JSON.parse(options.body)};calls.push(call);return read(call,calls);}};
    return {};
  },'SimulationDialog').SimulationDialog;
  const props={activity:{activityId:'A1'},version:{draft:{name:'Original draft'}},catalog:{skus:[{productNo:'SKU1',available:true,name:{zh:'测试设备'}}]},can:()=>true,onClose:()=>{},onResult:result=>results.push(result)};
  const render=()=>{stateIndex=0;refIndex=0;const nodes=[],walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;nodes.push(node);walk(node.props?.children);walk(node.props?.footer);};walk(Simulation(props));return nodes;};
  return {render,calls,results,button:label=>render().find(node=>node.type===ui.Button&&node.props.children===label),field:label=>render().find(node=>node.type===ui.Field&&node.props.label===label).props.children};
}
function saveFunctionTrace(name,calls){
  if(!process.env.PROMOTION_R2_FUNCTION_REPORT_DIR)return;const file=path.join(process.env.PROMOTION_R2_FUNCTION_REPORT_DIR,name+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});assert(!fs.existsSync(file));const source=fs.readFileSync(new URL('../app/components/domain-views/h-tabs/h4-promotion-review.tsx',import.meta.url));fs.writeFileSync(file,JSON.stringify({kind:'actual-component-offline-regression-not-product-runtime',sourceSha256:createHash('sha256').update(source).digest('hex'),status:'passed',calls},null,2));
}
test('failed authorized samples retry the same sample read while the empty scenario remains disabled',async()=>{
  const dialog=simulation((call,calls)=>{if(calls.length===1)throw Error('sample failure');return {samples:[{accountId:'12',status:'MATCHED'}]};});
  assert.equal(dialog.button('运行试算').props.disabled,true);await dialog.button('读取授权账户样本').props.onClick();let failed=dialog.render().find(node=>node.type===ui.ReadError);assert.equal(failed.props.target,'授权账户样本');failed.props.retry();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(dialog.calls.map(call=>call.route),['/promotions/A1/audience-preview','/promotions/A1/audience-preview']);assert.deepEqual(dialog.calls[0].body,dialog.calls[1].body);assert.equal(dialog.button('运行试算').props.disabled,true);assert.equal(dialog.results.length,0);assert.equal(dialog.render().some(node=>node.type===ui.ReadError),false);saveFunctionTrace('sample-retry-regression',dialog.calls);
});
test('failed simulations retain their original items and authorized sample when retried',async()=>{
  let attempts=0;const dialog=simulation(call=>{if(call.route.endsWith('audience-preview'))return {samples:[{accountId:'12',status:'MATCHED'}]};if(++attempts===1)throw Error('simulation failure');return {kind:'offline-test-result'};});
  dialog.button('添加购买项').props.onClick();dialog.field('购买设备 1').props.onChange({target:{value:'SKU1'}});dialog.field('购买数量').props.onChange({target:{value:'2'}});await dialog.button('读取授权账户样本').props.onClick();dialog.field('样本账户（可选）').props.onChange({target:{value:'12'}});assert.equal(dialog.button('运行试算').props.disabled,false);await dialog.button('运行试算').props.onClick();const failed=dialog.render().find(node=>node.type===ui.ReadError);assert.equal(failed.props.target,'只读购买试算');
  dialog.field('购买数量').props.onChange({target:{value:'3'}});failed.props.retry();await new Promise(resolve=>setImmediate(resolve));const reads=dialog.calls.filter(call=>call.route.endsWith('simulate'));assert.equal(reads.length,2);assert.deepEqual(reads[0].body,reads[1].body);assert.deepEqual(reads[1].body.items,[{productNo:'SKU1',quantity:2}]);assert.equal(reads[1].body.sampleAccountId,'12');assert.equal(dialog.field('购买数量').props.value,3,'Retry must not reset current selections');assert.equal(dialog.results.length,1);saveFunctionTrace('simulation-retry-regression',dialog.calls);
});

const rights={activationMode:'AUTO',effectiveOn:'ISSUED',durationDays:30,taskEnabled:true,countsAsDeviceHolding:false,countsForRank:true,transferable:false,exchangeable:true,revocationMode:'MANUAL_IF_USED'};
const rightsLabels=['激活方式','生效起点','有效天数','参与任务','计入设备持有','计入等级','可转让','可兑换','收回方式'];
function policyDetails(policy,catalog){
  return component('h4-promotion-policies.tsx',name=>name.startsWith('react')?require(name):name.endsWith('h4-promotion-ui')?ui:{}).PromotionPolicyDetails({policy,catalog});
}
test('both policy rights entries show all resolved restrictions and the exact bound contract titles',()=>{
  const native=(system,resourceId)=>({system,resourceId,revision:4,contentHash:'private-contract-hash-'+resourceId}),product=native('E1_PRODUCT','product'),task=native('A2_POLICY','task'),earnings=native('EARNINGS_RELEASE','earnings');
  const policy={state:'APPROVED',content:{kind:'DEVICE_RIGHTS',productNo:'SKU1',productContract:product,taskEligibility:'EXISTING_PRODUCT_RULES',rightsDescription:{zh:'原权益说明'}},resolvedDeviceRights:{...rights,taskRule:task,earningsRule:earnings}};
  const catalog={nativeContracts:[[product,'原商品合同标题'],[task,'原任务规则标题'],[earnings,'原收益规则标题']].map(([reference,title])=>({reference,title:{zh:title}}))};
  const exports=component('h4-promotion-policies.tsx',name=>name.startsWith('react')?require(name):name.endsWith('h4-promotion-ui')?ui:{});
  for(const element of [policyDetails(policy,catalog),exports.PromotionRightsDialog({policy,catalog,onClose:()=>{}})]){const html=renderToStaticMarkup(element);for(const label of [...rightsLabels,'任务参与依据','收益执行依据'])assert(html.includes(label));assert(html.includes('使用后人工处理'));assert(html.includes('原任务规则标题')&&html.includes('原收益规则标题'));assert.equal((html.match(/原商品合同标题/g)||[]).length,1,'Existing content contract is not repeated');assert(!/activationMode|revocationMode|taskRule|earningsRule|private-contract-hash|contentHash|REVOKE_IF_UNUSED|MANUAL_IF_USED/.test(html));}
  const stale=structuredClone(catalog);stale.nativeContracts[1].reference.revision=3;assert(!renderToStaticMarkup(policyDetails(policy,stale)).includes('原任务规则标题'),'A different contract revision must not be presented as this binding');
});
test('missing resolved rights remain unknown and existing reward disclosures reuse the complete nine restrictions',()=>{
  const policy={state:'DRAFT',content:{kind:'DEVICE_RIGHTS',rightsDescription:{zh:'真实原说明'}},resolvedDeviceRights:null};const unknown=renderToStaticMarkup(policyDetails(policy,{nativeContracts:[]}));for(const label of rightsLabels)assert(unknown.includes(label));assert.equal((unknown.match(/未确认/g)||[]).length,9);assert.equal((unknown.match(/未知/g)||[]).length,2);assert(!unknown.includes('自动激活')&&!unknown.includes('未使用可收回'));
  const row={loading:false,error:null,data:{state:'ISSUED',version:1,beneficiaryRole:'BUYER',beneficiaryId:'12',reward:{type:'DEVICE',quantity:1},disclosure:{title:{zh:'原公开标题'},terms:{zh:'原活动规则'},benefitDescription:{zh:'原资产或设备权益'},refundTerms:{zh:'原售后条款'},deviceRights:{...rights,revocationMode:'REVOKE_IF_UNUSED'}},dispositionOptions:[],attempts:[]}};
  const rewardUi={...ui,useRead:()=>row};const Detail=component('h4-promotion-rewards.tsx',name=>name.startsWith('react')?require(name):name.endsWith('h4-promotion-ui')?rewardUi:{},'RewardDetail').RewardDetail;const html=renderToStaticMarkup(require('react').createElement(Detail,{id:'R1',can:()=>false,onClose:()=>{},onChanged:()=>{}}));for(const label of rightsLabels)assert(html.includes(label));assert(html.includes('未使用可收回')&&html.includes('原资产或设备权益')&&html.includes('原售后条款'));assert(!html.includes('REVOKE_IF_UNUSED'));
  const unlimited=renderToStaticMarkup(ui.DeviceRightsSummary({rights:{...rights,durationDays:null}}));assert(unlimited.includes('原合同未限定'),'Preserve the established duration-null disclosure');
  const partial=renderToStaticMarkup(ui.DeviceRightsSummary({rights:{activationMode:'UNRECOGNIZED',effectiveOn:undefined,durationDays:undefined,taskEnabled:null,countsAsDeviceHolding:'false',countsForRank:undefined,transferable:0,exchangeable:undefined,revocationMode:'UNRECOGNIZED'}}));assert.equal((partial.match(/未确认/g)||[]).length,9);assert(!partial.includes('原合同未限定')&&!partial.includes('手动激活')&&!partial.includes('<b>否</b>')&&!partial.includes('<b>是</b>'),'Unknown fields must not become a configured entitlement');
});

test('numeric formats follow the existing quantity, limit and exact amount contract while allowing empty drafts',()=>{
  const parse=promotionForm.parsePromotionNumericInput;
  for(const kind of ['quantity','limit','priority','device-budget','amount'])assert.deepEqual(parse('',kind),{value:null,error:null});
  for(const [raw,kind,value] of [['100','quantity',100],['2147483647','limit',2147483647],['0','priority',0],['101','device-budget',101],['9007199254740991','device-budget',Number.MAX_SAFE_INTEGER],['0.000001','amount','0.000001'],['999999999999.999999','amount','999999999999.999999']])assert.deepEqual(parse(raw,kind),{value,error:null});
  for(const [raw,kind] of [['101','quantity'],['0','quantity'],['-1','quantity'],['1.1','quantity'],['2147483648','limit'],['9007199254740992','device-budget'],['9007199254740990.1','device-budget'],['-1','priority'],['1e2','quantity'],['NaN','quantity'],['Infinity','quantity'],['0.000000','amount'],['-1','amount'],['1e2','amount'],['1.0000001','amount'],['1000000000000','amount'],['01','amount']])assert(parse(raw,kind).error,`${kind} ${raw} must not become a saved value`);
  assert.equal(promotionForm.promotionChoiceError(null,['ALL','ANY']),null);assert(promotionForm.promotionChoiceError('STALE',['ALL','ANY']));
});
test('budget comparison uses all four current stock terms with exact decimal arithmetic and never substitutes missing facts',()=>{
  const compare=promotionForm.promotionBudgetComparison;
  const stock={reserved:'900000000000.000001',committed:'0.000002',issued:'0.000003',reversed:'0.000001'};
  assert.deepEqual(compare('900000000000.000004','amount',stock),{status:'below',minimum:'900000000000.000005'});
  assert.deepEqual(compare('900000000000.000005','amount',stock),{status:'sufficient',minimum:'900000000000.000005'});
  assert.deepEqual(compare('','amount',stock),{status:'unknown',minimum:'900000000000.000005'});
  for(const key of ['reserved','committed','issued','reversed'])for(const bad of [undefined,null,'not-a-number',0])assert.deepEqual(compare('10','amount',{...stock,[key]:bad}),{status:'unknown',minimum:null});
  assert.deepEqual(compare('102','device-budget',{reserved:'100',committed:'2',issued:'3',reversed:'2'}),{status:'below',minimum:'103'});
  assert.deepEqual(compare('103','device-budget',{reserved:'100',committed:'2',issued:'3',reversed:'2'}),{status:'sufficient',minimum:'103'});
  assert.deepEqual(compare('1','device-budget',{reserved:'0.5',committed:'0',issued:'0',reversed:'0'}),{status:'unknown',minimum:null});
  assert.deepEqual(compare('1','amount',{reserved:'0',committed:'0',issued:'0',reversed:'1'}),{status:'unknown',minimum:null});
});

// State is scoped by actual component instance; handlers and parsing come from product source.
// These fixtures are offline regressions, not collected DTOs or financial runtime evidence.
function editingDialog(name,props){
  const buckets=new Map(),nodes=[],mounted=new Set();let bucket=[],index=0,id=0;
  const scope=(fn,p,key)=>{mounted.add(key);const prior=bucket,priorIndex=index;bucket=buckets.get(key)||[];buckets.set(key,bucket);index=0;try{return fn(p);}finally{bucket=prior;index=priorIndex;}};
  const exports=component('h4-promotion-editor.tsx',dependency=>{
    if(dependency==='react')return {useState:initial=>{const values=bucket,i=index++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],next=>values[i]=typeof next==='function'?next(values[i]):next];},useEffect:()=>{},useId:()=>`offline-field-${id++}`};
    if(dependency==='react/jsx-runtime')return require(dependency);
    if(dependency.endsWith('h4-promotion-ui'))return ui;
    if(dependency.endsWith('promotion-form'))return promotionForm;
    if(dependency.endsWith('promotion-client'))return {promotionRead:()=>assert.fail('No service reads in offline editor regression')};
    if(dependency.endsWith('h4-promotion-policies'))return {PromotionRightsDialog:()=>null};
    assert.fail('Unknown editor dependency '+dependency);
  },name==='default'?'':name);
  const local=new Set(['NumericField','RewardFields','LimitField','PolicySelect','CombinationEditor','AudienceFields']);
  const expand=(node,key)=>{
    if(Array.isArray(node))return node.map((child,i)=>expand(child,key+'/'+(child?.key??i)));
    if(!node||typeof node!=='object'||!node.props)return node;
    if(typeof node.type==='function'&&local.has(node.type.name)){nodes.push(node);return expand(scope(node.type,node.props,key+'/'+node.type.name),key+'/content');}
    const next={...node,props:{...node.props}};for(const part of ['children','footer','action','hint'])if(part in next.props)next.props[part]=expand(next.props[part],key+'/'+part);nodes.push(next);return next;
  };
  const render=()=>{nodes.length=0;id=0;mounted.clear();const result=expand(scope(exports[name],props,'root'),'root');for(const key of buckets.keys())if(!mounted.has(key))buckets.delete(key);return result;};
  const button=label=>{render();return nodes.find(n=>n.type===ui.Button&&n.props.children===label);};
  const field=label=>{render();const node=nodes.find(n=>n.type===ui.Field&&n.props.label===label);assert(node,'Missing actual field '+label);return node.props.children;};
  const input=(label,raw)=>field(label).props.onChange({target:{value:raw}});
  const inlineControl=label=>{render();const control=nodes.find(n=>n.type==='input'&&n.props['aria-label']===label);assert(control,'Missing actual inline input '+label);return control;};
  const inlineInput=(label,raw)=>inlineControl(label).props.onChange({target:{value:raw}});
  const limitMode=(label,value)=>{render();const control=nodes.find(n=>n.type==='select'&&n.props['aria-label']===label+'设置方式');assert(control,'Missing actual limit mode '+label);control.props.onChange({target:{value}});};
  return {render,button,field,input,inlineInput,inlineControl,limitMode,nodes,html:()=>renderToStaticMarkup(render())};
}
const editCatalog={skus:[{productNo:'SKU1',name:{zh:'原购买设备'},available:true,giftEligible:true},{productNo:'SKU2',name:{zh:'原赠送设备'},available:true,giftEligible:true}],policies:[],nativeContracts:[],ranks:[],markets:[]};
const originalRule={ruleId:'R1',productNo:'SKU1',minBuyQty:1,repeatMode:'PER_GROUP',priority:0,maxGroups:{mode:'LIMITED',value:1},buyerReward:{rewardRuleId:'B1',type:'USDT',beneficiaryRole:'BUYER',amount:'1.000000',calculation:'FIXED'}};
function saveEditorTrace(name,observed){
  const reportDirectory=process.env.PROMOTION_R4_FUNCTION_REPORT_DIR||process.env.PROMOTION_R3_FUNCTION_REPORT_DIR;if(!reportDirectory)return;
  const sources=['app/components/domain-views/h-tabs/h4-promotion-editor.tsx','lib/admin/promotion-form.ts','scripts/growth-promotions-read-state.test.mjs'],sourceFiles=Object.fromEntries(sources.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
  const file=path.join(reportDirectory,name+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});assert(!fs.existsSync(file));fs.writeFileSync(file,JSON.stringify({kind:'actual-component-offline-regression-not-product-runtime',sourceFiles,status:'passed',observed},null,2));
}
test('actual rule editor retains invalid raw input, rejects retention, and saves correction or an empty partial draft',()=>{
  const saved=[],dialog=editingDialog('RuleEditor',{initial:originalRule,catalog:editCatalog,dual:false,readOnly:false,onClose:()=>{},onSave:rule=>saved.push(rule)});
  for(const raw of ['101','1.5','NaN']){dialog.input('每组购买数量 *',raw);assert.equal(dialog.field('每组购买数量 *').props.value,raw);assert.equal(dialog.field('每组购买数量 *').props['aria-invalid'],true);dialog.button('保留到草稿').props.onClick();assert.equal(saved.length,0);}
  const html=dialog.html();assert.match(html,/请输入 1–100 之间的整数/);const invalid=html.match(/<input[^>]*aria-invalid="true"[^>]*>/)?.[0];assert(invalid);const association=invalid.match(/aria-describedby="([^"]+)"/)?.[1];assert(association&&html.includes(`id="${association}"`),'Actual Field connects its input to its visible error');
  dialog.input('每组购买数量 *','100');dialog.button('保留到草稿').props.onClick();assert.equal(saved.at(-1).minBuyQty,100);assert.equal(saved.at(-1).buyerReward.amount,'1.000000');
  dialog.input('每组购买数量 *','');dialog.button('保留到草稿').props.onClick();assert.equal(saved.at(-1).minBuyQty,null);assert.equal(saved.at(-1).priority,0);saveEditorTrace('rule-format-regression',{rejectedRaw:['101','1.5','NaN'],retainedAfterCorrectionAndBlank:saved,errorAssociation:association});
});
test('actual rule rewards use the same format guard for both beneficiaries without changing reward identity',()=>{
  const saved=[],dialog=editingDialog('RuleEditor',{initial:originalRule,catalog:editCatalog,dual:false,readOnly:false,onClose:()=>{},onSave:rule=>saved.push(rule)});
  for(const raw of ['0','1.0000001','1000000000000','-1']){dialog.input('每组 USDT 奖励金额 *',raw);dialog.button('保留到草稿').props.onClick();assert.equal(saved.length,0);assert.equal(dialog.field('每组 USDT 奖励金额 *').props.value,raw);}
  dialog.input('每组 USDT 奖励金额 *','0.000001');dialog.button('保留到草稿').props.onClick();assert.equal(saved[0].buyerReward.amount,'0.000001');assert.equal(saved[0].buyerReward.rewardRuleId,'B1');
  const device={rewardRuleId:'D1',type:'DEVICE',beneficiaryRole:'DIRECT_INVITER',quantity:1,giftProductNo:'SKU2',deviceRightsProfile:null};
  const dualSaved=[],dual=editingDialog('RuleEditor',{initial:{...originalRule,inviterReward:device},catalog:editCatalog,dual:true,readOnly:false,onClose:()=>{},onSave:rule=>dualSaved.push(rule)});
  dual.input('每组赠送数量 *','101');dual.button('保留到草稿').props.onClick();assert.equal(dualSaved.length,0);dual.input('每组赠送数量 *','100');dual.button('保留到草稿').props.onClick();assert.equal(dualSaved[0].inviterReward.quantity,100);assert.equal(dualSaved[0].inviterReward.rewardRuleId,'D1');
  const buyerSaved=[],buyer=editingDialog('RuleEditor',{initial:{...originalRule,buyerReward:{...device,beneficiaryRole:'BUYER'}},catalog:editCatalog,dual:false,readOnly:false,onClose:()=>{},onSave:rule=>buyerSaved.push(rule)});
  buyer.input('每组赠送数量 *','1.1');buyer.button('保留到草稿').props.onClick();assert.equal(buyerSaved.length,0);buyer.input('每组赠送数量 *','100');buyer.button('保留到草稿').props.onClick();assert.equal(buyerSaved[0].buyerReward.quantity,100);
});
test('actual limit and priority handlers retain invalid text and allow the original boundary values',()=>{
  const saved=[],dialog=editingDialog('RuleEditor',{initial:{...originalRule,maxGroupsPerPerson:{mode:'LIMITED',value:2}},catalog:editCatalog,dual:false,readOnly:false,onClose:()=>{},onSave:rule=>saved.push(rule)});
  for(const label of ['每单最大计奖组数','活动内每人最大计奖组数']){for(const raw of ['1.5','2147483648']){dialog.inlineInput(label,raw);dialog.button('保留到草稿').props.onClick();assert.equal(saved.length,0);assert(dialog.html().includes(raw));}dialog.inlineInput(label,'2147483647');}
  dialog.input('规则优先级 *','-1');dialog.button('保留到草稿').props.onClick();assert.equal(saved.length,0);dialog.input('规则优先级 *','0');dialog.button('保留到草稿').props.onClick();assert.equal(saved[0].maxGroups.value,2147483647);assert.equal(saved[0].maxGroupsPerPerson.value,2147483647);assert.equal(saved[0].priority,0);
});
test('actual rule guard rejects invalid limits, priority and unavailable configured enum values but not missing choices',()=>{
  for(const initial of [{...originalRule,priority:1.5},{...originalRule,maxGroups:{mode:'LIMITED',value:2147483648}},{...originalRule,repeatMode:'STALE'},{...originalRule,maxGroups:{mode:'STALE'}},{...originalRule,buyerReward:{...originalRule.buyerReward,type:'STALE'}},{...originalRule,buyerReward:{type:'DEVICE',quantity:1,giftProductNo:'MISSING'}}]){
    const saved=[],dialog=editingDialog('RuleEditor',{initial,catalog:editCatalog,dual:false,readOnly:false,onClose:()=>{},onSave:rule=>saved.push(rule)});dialog.button('保留到草稿').props.onClick();assert.equal(saved.length,0);assert(dialog.html().includes('aria-invalid="true"'));
  }
  const saved=[],empty=editingDialog('RuleEditor',{initial:{ruleId:'empty'},catalog:editCatalog,dual:false,readOnly:false,onClose:()=>{},onSave:rule=>saved.push(rule)});empty.button('保留到草稿').props.onClick();assert.equal(saved.length,1);assert.equal(saved[0].ruleId,'empty');assert(!empty.html().includes('aria-invalid="true"'));
});
test('actual budget editor blocks malformed totals, allows lower occupied draft totals and uses asset and gift identity for comparison',()=>{
  const saved=[],draft={rules:[{...originalRule,buyerReward:{type:'DEVICE',giftProductNo:'SKU2',quantity:1}}],budgets:[{asset:'USDT',total:'20'},{asset:'DEVICE',productNo:'SKU2',total:103}]};
  const stock=(asset,productNo,reserved)=>({asset,productNo,reserved,committed:'2',issued:'3',reversed:'2'});
  const activity={impact:{budgets:[stock('USDT',null,'10'),stock('DEVICE','SKU1','999'),stock('DEVICE','SKU2','100')]}};
  const dialog=editingDialog('BudgetEditor',{draft,catalog:editCatalog,activity,onClose:()=>{},onSave:budgets=>saved.push(budgets)});
  for(const [label,raw] of [['USDT 总额度','1.0000001'],['原赠送设备 总额度','9007199254740992']]){dialog.input(label,raw);dialog.button('保留到草稿').props.onClick();assert.equal(saved.length,0);assert.equal(dialog.field(label).props.value,raw);dialog.input(label,label==='USDT 总额度'?'20':'103');}
  dialog.input('USDT 总额度','12.000000');dialog.input('原赠送设备 总额度','102');const html=dialog.html();assert(html.includes('13.000000 USDT')&&html.includes('103 台')&&!html.includes('1002 台'));assert(html.includes('低于当前已用和有效预留合计')&&html.includes('可保留草稿'));dialog.button('保留到草稿').props.onClick();assert.equal(saved.length,1);assert.deepEqual(saved[0],[{asset:'USDT',total:'12.000000'},{asset:'DEVICE',productNo:'SKU2',total:102}]);
  dialog.input('USDT 总额度','');dialog.input('原赠送设备 总额度','');dialog.button('保留到草稿').props.onClick();assert.deepEqual(saved.at(-1),[],'Blank optional budgets must not become invented zero allocations');saveEditorTrace('budget-format-and-occupied-regression',{rejectedRaw:['1.0000001','9007199254740992'],retainedBelowCurrentStockAndBlank:saved,currentStock:activity.impact.budgets,belowWarningVisible:html.includes('低于当前已用和有效预留合计')});
});
test('actual budget editor names unknown occupancy when any required current term is absent',()=>{
  const dialog=editingDialog('BudgetEditor',{draft:{budgets:[{asset:'USDT',total:'1'}]},catalog:editCatalog,activity:{impact:{budgets:[{asset:'USDT',reserved:'0',committed:'0',issued:'0'}]}},onClose:()=>{},onSave:()=>{}});
  assert(dialog.html().includes('当前占用尚未确认'));assert(!dialog.html().includes('合计 0.000000'));
});
test('actual combination dialog rejects invalid quantity or match enum, preserves legal changes and shows each original rule reward separately',()=>{
  let closed=0;const changes=[],props={draft:{template:'MULTI_PRODUCT',combinationMatch:'ALL',rules:[structuredClone(originalRule),{...structuredClone(originalRule),ruleId:'R2',productNo:'SKU2',buyerReward:{...originalRule.buyerReward,type:'NEX',amount:'2'}}]},catalog:editCatalog,readOnly:false,onClose:()=>closed++,onChange:change=>{changes.push(change);props.draft={...props.draft,...change};}};
  const dialog=editingDialog('CombinationEditor',props);dialog.input('最低数量 1','101');dialog.button('保留到草稿').props.onClick();assert.equal(closed,0);assert.equal(changes.length,0);assert.equal(props.draft.rules[0].minBuyQty,1);assert.equal(dialog.field('最低数量 1').props.value,'101');
  dialog.input('最低数量 1','100');dialog.button('保留到草稿').props.onClick();assert.equal(closed,1);assert.equal(props.draft.rules[0].minBuyQty,100);assert.equal(props.draft.rules[1].minBuyQty,1);const html=dialog.html();for(const text of ['购买者奖励 1','购买者奖励 2','1.000000 USDT','2 NEX','每单 1 组'])assert(html.includes(text));
  dialog.input('最低数量 1','');dialog.button('保留到草稿').props.onClick();assert.equal(closed,2);assert.equal(props.draft.rules[0].minBuyQty,null);props.draft.combinationMatch='STALE';dialog.button('保留到草稿').props.onClick();assert.equal(closed,2);assert(dialog.html().includes('该选项当前不可用'));saveEditorTrace('combination-format-regression',{rejectedRaw:'101',actualChanges:changes,closeCalls:closed,finalDraft:props.draft});
});
test('basic template picker reuses all existing choices and the original confirmation; cancellation keeps the draft',()=>{
  const original={...promotionForm.emptyDraft('SKU_GIFT'),name:'保留名称',title:{zh:'保留标题'},rules:[originalRule]};
  const props={activity:{activityId:'A1',state:'DRAFT',current:{revision:1,version:1,state:'DRAFT',draft:original},impact:{budgets:[]}},catalog:editCatalog,can:()=>true,onBack:()=>{},onReview:()=>{},onSaved:()=>{}};
  const dialog=editingDialog('default',props);dialog.render();dialog.nodes.find(n=>n.type==='button'&&n.props.children==='选择活动模板').props.onClick();assert(dialog.nodes.length);dialog.render();const picker=dialog.nodes.find(n=>n.type===ui.Dialog&&n.props.title==='选择活动模板');assert(picker);for(const label of Object.values(ui.TEMPLATE_LABELS))assert(dialog.button(label));
  dialog.button('多型号组合').props.onClick();let confirmation=dialog.nodes.find(n=>n.type===ui.Dialog&&n.props.title==='切换活动模板');dialog.render();confirmation=dialog.nodes.find(n=>n.type===ui.Dialog&&n.props.title==='切换活动模板');assert(confirmation);confirmation.props.onClose();assert.equal(dialog.field('活动模板 *').props.value,'SKU_GIFT');
  dialog.render();dialog.nodes.find(n=>n.type==='button'&&n.props.children==='选择活动模板').props.onClick();dialog.button('多型号组合').props.onClick();dialog.button('确认清空并切换').props.onClick();assert.equal(dialog.field('活动模板 *').props.value,'MULTI_PRODUCT');assert.equal(dialog.field('活动名称 *').props.value,'保留名称');assert.equal(dialog.field('展示标题 *').props.value,'保留标题');
  dialog.button('保存草稿').props.onClick();dialog.render();const command=dialog.nodes.find(n=>n.type===ui.ConfirmCommand);assert.deepEqual(command.props.body.draft,promotionForm.changeTemplate(original,'MULTI_PRODUCT'),'Picker must preserve the original template-change payload and clear only the same existing incompatible values');saveEditorTrace('template-picker-regression',{choices:Object.values(ui.TEMPLATE_LABELS),originalDraft:original,confirmationBody:command.props.body});
});

const participationLabels=['购买者活动参与上限','直接邀请人活动参与上限','全活动参与订单上限','每单奖励义务上限'];
function participationEditor({empty=false,onSaved=async()=>{}}={}){
  let writable=true;const events=[];
  const limit=value=>({mode:'LIMITED',value});
  const draft={...promotionForm.emptyDraft('SKU_GIFT'),name:'原上限活动',...(empty?{perPersonLimit:null,activityLimit:null,maxRewardUnitsPerOrder:null}:{perPersonLimit:{buyer:limit(1),directInviter:limit(2)},activityLimit:limit(3),maxRewardUnitsPerOrder:limit(4)})};
  const props={initialStep:3,activity:{activityId:'A1',state:'DRAFT',current:{revision:7,version:1,state:'DRAFT',draft},impact:{budgets:[]}},catalog:editCatalog,can:()=>writable,onBack:()=>events.push('back'),onReview:()=>events.push('review'),onSaved};
  const dialog=editingDialog('default',props);
  const open=()=>{dialog.render();const entry=dialog.nodes.find(n=>n.type==='button'&&n.props.children==='角色与每单设置');assert(entry);entry.props.onClick();};
  const command=()=>{dialog.render();return dialog.nodes.find(n=>n.type===ui.ConfirmCommand);};
  const modal=title=>{dialog.render();return dialog.nodes.find(n=>n.type===ui.Dialog&&n.props.title===title);};
  const next=target=>{dialog.render();const steps=dialog.nodes.find(n=>n.type===ui.PromotionSteps);assert(steps);ui.PromotionSteps(steps.props).props.children[target].props.onClick();};
  return {...dialog,open,command,modal,next,events,props,setWritable:value=>writable=value};
}
test('all six LimitField callers require the shared binding and the unsafe number fallback is absent',()=>{
  const source=fs.readFileSync(new URL('../app/components/domain-views/h-tabs/h4-promotion-editor.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('editor.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),callers=[];
  let definition;const walk=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='LimitField')definition=node;if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='LimitField')callers.push(node);ts.forEachChild(node,walk);};walk(ast);
  assert.equal(callers.length,6);for(const caller of callers)assert(caller.attributes.properties.some(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.text==='numeric'),'A LimitField caller may not bypass the format binding');
  const numeric=definition.parameters[0].type.members.find(member=>member.name?.getText(ast)==='numeric');assert(numeric&&!numeric.questionToken);const calls=[];const visit=node=>{if(ts.isCallExpression(node))calls.push(node.expression.getText(ast));ts.forEachChild(node,visit);};visit(definition.body);assert(!calls.includes('Number'));
});
test('the original eight participation-limit counterexamples cannot enter any save or step path and keep raw errors on cancel',()=>{
  const observations=[];
  for(const [position,label] of participationLabels.entries())for(const raw of ['1.5','2147483648']){
    const editor=participationEditor();editor.open();editor.inlineInput(label,raw);assert.equal(editor.inlineControl(label).props.value,raw);assert.equal(editor.inlineControl(label).props['aria-invalid'],true);
    editor.render();const actualField=editor.nodes.find(n=>n.type.name==='LimitField'&&n.props.label===label);assert.deepEqual(actualField.props.value,{mode:'LIMITED',value:position+1},'Invalid text must not replace the previous bound value with null or an illegal number');
    const html=editor.html(),input=html.match(new RegExp('<input[^>]*aria-label="'+label+'"[^>]*>'))?.[0],description=input?.match(/aria-describedby="([^"]+)"/)?.[1];assert(description&&html.includes(`id="${description}"`));assert(html.includes('请输入 1–2147483647 之间的整数'));
    editor.button('返回预算与叠加').props.onClick();assert(!editor.modal('参与角色与每单上限'));assert.equal(editor.button('保存草稿').props.disabled,true);editor.button('保存草稿').props.onClick();assert(!editor.command());assert(editor.modal('参与角色与每单上限'));
    editor.button('返回预算与叠加').props.onClick();editor.button('上一步').props.onClick();assert(!editor.command());assert(editor.modal('参与角色与每单上限'));editor.button('返回预算与叠加').props.onClick();editor.next(1);assert(!editor.command());assert(editor.modal('参与角色与每单上限'));
    editor.button('返回预算与叠加').props.onClick();editor.button('试算与审核').props.onClick();assert(editor.modal('配置尚未保存'));assert.equal(editor.button('保存后继续').props.disabled,true);editor.button('保存后继续').props.onClick();assert(!editor.command());assert(editor.modal('参与角色与每单上限'));assert(!editor.modal('配置尚未保存'));
    assert.equal(editor.inlineControl(label).props.value,raw);editor.button('返回预算与叠加').props.onClick();assert(editor.modal('配置尚未保存'));editor.button('继续编辑').props.onClick();editor.open();assert.equal(editor.inlineControl(label).props.value,raw);
    editor.inlineInput(label,'2147483647');editor.button('返回预算与叠加').props.onClick();assert.equal(editor.button('保存草稿').props.disabled,false);editor.button('保存草稿').props.onClick();const command=editor.command();assert(command);const payload=[command.props.body.draft.perPersonLimit.buyer,command.props.body.draft.perPersonLimit.directInviter,command.props.body.draft.activityLimit,command.props.body.draft.maxRewardUnitsPerOrder][position];assert.deepEqual(payload,{mode:'LIMITED',value:2147483647});assert.equal(command.props.body.expectedRevision,7);assert(!JSON.stringify(command.props.body).includes('limitInputs'));
    observations.push({label,raw,errorAssociation:description,invalidAllSavePathsBlocked:true,cancelRetainsRaw:true,correctionPayload:payload,expectedRevision:command.props.body.expectedRevision});
  }
  saveEditorTrace('eight-participation-limit-counterexamples-closed',observations);
});
test('participation limit mode changes clear only that raw input and empty drafts stay unconfigured',()=>{
  for(const label of participationLabels){const editor=participationEditor();editor.open();editor.inlineInput(label,'1.5');editor.limitMode(label,'UNLIMITED');assert(!editor.html().includes('aria-invalid="true"'));editor.button('返回预算与叠加').props.onClick();editor.button('保存草稿').props.onClick();assert(editor.command(),'Explicit unlimited clears the rejected text and is still a legal original limit mode');}
  const editor=participationEditor({empty:true});editor.open();editor.limitMode('全活动参与订单上限','LIMITED');editor.inlineInput('全活动参与订单上限','1.5');editor.button('返回预算与叠加').props.onClick();editor.open();assert.equal(editor.inlineControl('全活动参与订单上限').props.value,'1.5','Dialog remount must show rejected text even if its original bound value was null');
  editor.limitMode('全活动参与订单上限','UNLIMITED');editor.limitMode('全活动参与订单上限','LIMITED');assert.equal(editor.inlineControl('全活动参与订单上限').props.value,'');editor.limitMode('全活动参与订单上限','');editor.button('返回预算与叠加').props.onClick();editor.button('保存草稿').props.onClick();assert.deepEqual(editor.command().props.body.draft,{...promotionForm.emptyDraft('SKU_GIFT'),name:'原上限活动',perPersonLimit:null,activityLimit:null,maxRewardUnitsPerOrder:null});
  saveEditorTrace('participation-empty-and-mode-regression',{cancelRetainedInvalidFromNull:true,finalDraft:editor.command().props.body.draft});
});
test('cancel, live permission changes and explicit template reset preserve the existing mounted-editor behavior',()=>{
  const editor=participationEditor();editor.open();editor.inlineInput('每单奖励义务上限','1.5');editor.setWritable(false);assert(editor.html().includes('<fieldset disabled=""'));assert.equal(editor.inlineControl('每单奖励义务上限').props.value,'1.5');editor.button('返回预算与叠加').props.onClick();editor.button('保存草稿').props.onClick();assert(!editor.command());editor.next(0);assert(!editor.command());
  editor.setWritable(true);editor.button('定位上限输入').props.onClick();assert.equal(editor.inlineControl('每单奖励义务上限').props.value,'1.5');editor.button('返回预算与叠加').props.onClick();editor.render();editor.nodes.find(n=>n.type==='button'&&n.props.children==='选择活动模板').props.onClick();editor.button('多型号组合').props.onClick();editor.button('确认清空并切换').props.onClick();assert(!editor.html().includes('上限格式尚未通过'));editor.button('保存草稿').props.onClick();const command=editor.command();assert(command);assert.equal(command.props.body.draft.maxRewardUnitsPerOrder,null);assert.equal(command.props.body.draft.perPersonLimit,null);
});
test('save after continue retains its original return target while a bad limit is located and corrected',async()=>{
  const observed=[];
  for(const [label,target] of [['返回活动','back'],['试算与审核','review']]){
    const readbacks=[],editor=participationEditor({onSaved:async step=>readbacks.push(step)});editor.open();editor.inlineInput('全活动参与订单上限','1.5');editor.button('返回预算与叠加').props.onClick();editor.button(label).props.onClick();assert(editor.modal('配置尚未保存'));editor.button('保存后继续').props.onClick();assert(!editor.command());assert(editor.modal('参与角色与每单上限'));editor.inlineInput('全活动参与订单上限','10');editor.button('返回预算与叠加').props.onClick();assert(editor.modal('配置尚未保存'));editor.button('保存后继续').props.onClick();const command=editor.command();assert(command);await command.props.onSuccess();assert.deepEqual(editor.events,[target]);assert.deepEqual(readbacks,[undefined]);observed.push({target,payload:command.props.body,readbackCalled:true,events:editor.events});
  }
  saveEditorTrace('participation-save-and-leave-regression',observed);
});
