import { displayCopyModules } from "../tests/display-copy-fixture.mjs";
import { promotionFieldModule } from '../tests/promotion-field-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as form from '../lib/admin/promotion-form.ts';
import * as client from '../lib/admin/promotion-client.ts';
import {displayAdminError} from '../lib/admin/error-messages.ts';

const require=createRequire(import.meta.url), base=new URL('../',import.meta.url);
test('unavailable promotion reads do not assert a submission outcome',()=>{
  for(const code of ['SERVICE_UNAVAILABLE','BACKEND_UNAVAILABLE',undefined]){
    const message=client.promotionErrorMessage(code,503);
    assert.match(message,/暂时不可用/);assert.match(message,/重试/);assert.doesNotMatch(message,/提交|未生效|成功|已保存/);
  }
});
globalThis.fetch=async()=>{throw new Error('This regression must not contact a live API');};
const read=file=>fs.readFileSync(new URL(file,base),'utf8');
const h='app/components/domain-views/h-tabs/';
function evaluate(file,imports,privateNames=[]){
  const source=read(file), parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.equal(parsed.parseDiagnostics.length,0,`${file} syntax`);
  const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','exports','module',code+privateNames.map(name=>`\nmodule.exports.${name}=${name};`).join(''))(name => displayCopyModules[name] ?? imports(name),module.exports,module);
  return module.exports;
}
function hooks(initial={}){
  const states={...initial},refs=[];let state=0,ref=0,id=0;
  return {states,reset(){state=0;ref=0;id=0;},react:{...React,useState(value){const i=state++;if(!(i in states))states[i]=typeof value==='function'?value():value;return [states[i],next=>states[i]=typeof next==='function'?next(states[i]):next];},useRef(value){return refs[ref++]??={current:value};},useId(){return 'copy-test-'+id++;},useEffect(){},useMemo:fn=>fn(),useCallback:fn=>fn}};
}
const noop=()=>null;
const ui=evaluate(h+'h4-promotion-ui.tsx',name=>name.startsWith('react')?require(name):name.endsWith('error-messages')?{displayAdminError}:name.endsWith('promotion-client')?client:{});
function domain(file,hook,readState,privateNames=[],extras={}){
  return evaluate(h+file,name=>{
    const field = promotionFieldModule(name, {...ui, useRead: typeof readState === 'function' ? readState : () => readState ?? fresh}); if (field) return field;
    if(name==='react')return hook.react;
    if(name==='react/jsx-runtime')return require(name);
    if(name==='next/navigation')return {useSearchParams:()=>new URLSearchParams()};
    if(name.endsWith('h4-promotion-ui'))return {...ui,useRead:typeof readState==='function'?readState:()=>readState??{loading:false,error:null,data:null,reload(){}}};
    if(name.endsWith('promotion-form'))return form;
    if(name.endsWith('promotion-client'))return {...client,pendingPromotionCommands:()=>[]};
    if(name.endsWith('error-messages'))return {displayAdminError};
    if(name in extras)return extras[name];
    return {__esModule:true,default:noop,PromotionRightsDialog:noop,PromotionBanner:noop,PromotionBannerPreview:noop,PaginationExemptionList:noop};
  },privateNames);
}
const markup=element=>renderToStaticMarkup(element);
function nodes(element){const result=[];function visit(n){if(Array.isArray(n))return n.forEach(visit);if(!n||typeof n!=='object')return;result.push(n);visit(n.props?.children);visit(n.props?.footer);}visit(element);return result;}
const fresh={loading:false,error:null,data:{items:[],hasMore:false},reload(){}};
const impact={issued:0,pendingRewards:0,failedRewards:0,unknownRewards:0,reversingRewards:0,manualReviewRewards:0,unpaidOrders:0,unfulfilledRewards:0,unresolved:0,budgets:[],asOf:'2026-10-11T00:00:00Z'};
const draft={...form.emptyDraft('SKU_GIFT'),name:'PCGP preserved activity',title:{zh:'公开中文',en:'Public English',vi:'Công khai'},terms:{zh:'保留规则',en:'Terms',vi:'Điều khoản'},rules:[],budgets:[{asset:'USDT',total:'100.000000'}]};
const activity={activityId:'A1',name:'PCGP preserved activity',state:'ACTIVE',revision:3,activeVersion:1,draftVersion:2,impact,current:{version:2,revision:2,state:'DRAFT',draft,policyResolutionErrors:[]},startsAt:'2026-10-08T00:00:00Z',endsAt:'2026-10-12T00:00:00Z',displayTimezone:'UTC'};
const catalog={policies:[],nativeContracts:[],skus:[],ranks:[],markets:[]};
const editorProps={activity,catalog,can:()=>true,onSaved:async()=>{},onBack(){},onReview(){}};
const forbidden=/保存为 UTC|事实读取|服务端权威|未知数据不显示为 0|真实资金或设备回执|资金或设备真实回执|真实追回凭证|隔离测试政策|原命令|v1·console|数据库查询失败|D:\/CodexData\/private/;

function shell(hook,coverage={ledger:{coverageRatio:0,redlinePct:0.8,healthyPct:1},hasData:false,loading:false,error:null}){
  const imports=name=>{
    if(name==='react')return hook.react;
    if(name==='react/jsx-runtime')return require(name);
    if(name==='next/link')return {__esModule:true,default:({children,prefetch,...props})=>React.createElement('a',props,children)};
    if(name==='next/image')return {__esModule:true,default:props=>React.createElement('img',props)};
    if(name==='next/navigation')return {usePathname:()=>'/growth/events'};
    if(name==='lucide-react')return new Proxy({},{get:()=>()=>React.createElement('i',{'aria-hidden':true})});
    if(name.endsWith('admin-auth'))return {useAdminAuth:selector=>selector({logoutError:'',beginLogout(){},cancelLogout(){},beginLogoutVerification(){},failLogoutUnknown(){},signOut(){}})};
    if(name.endsWith('admin-ui'))return {useAdminUi:selector=>selector({toggleGroup(){},setExpanded(){},setSidebar(){},toggleSidebar(){}})};
    if(name.endsWith('b-client'))return {useBDomainDashboard:()=>coverage};
    if(name.endsWith('/format'))return {fmtPct:value=>String(value*100)+'%'};
    if(name.endsWith('shell-authorities'))return {B_DASHBOARD_READ_AUTHORITIES:['b_read'],M_CONTENT_READ_AUTHORITIES:['m_read']};
    if(name.endsWith('error-messages'))return {displayAdminError};
    return new Proxy({},{get:()=>noop});
  };
  return {top:evaluate('app/components/shell/topbar.tsx',imports,['CoveragePill','RoleSwitcher']),sidebar:evaluate('app/components/shell/sidebar.tsx',imports)};
}

test('PCOPY-01/02: actual shell renders no fixed sync success or development version for any sidebar form',()=>{
  assert(!fs.existsSync(new URL('app/components/shell/sync-chip.tsx',base)));
  assert.doesNotMatch(read('app/components/shell/topbar.tsx'),/SyncChip|sync-chip/);
  assert.doesNotMatch(read('app/components/shell/topbar.css'),/admin-topbar-sync/);
  for(const role of ['auditor','support'])for(const collapsed of [false,true])for(const mobile of [false,true]){
    const hook=hooks(),{top,sidebar}=shell(hook);hook.reset();
    const header=markup(top.TopBar({role,operator:'Isolated promotion fixture',domains:[],authorities:['b_read'],servicePending:0}));
    assert.doesNotMatch(header,/已同步|sync-chip|服务端权威/);assert(header.includes('Isolated promotion fixture'));
    hook.reset();const html=markup(sidebar.Sidebar({role,domains:[],collapsed,expanded:[],servicePending:0,mobile}));
    assert.doesNotMatch(html,/v1·console/);assert(html.includes('aria-label="UVEL 运营控制台"'));assert.equal(html.includes('运营控制台</span>'),!collapsed);
  }
});

test('PCOPY-03: actual list/reward summaries retain zero facts, fixture names and recovery consequences',()=>{
  const hook=hooks();let readIndex=0;
  const list={...fresh,data:{items:[],total:0,summary:{activeActivities:0,reserved:0,issued:0,unresolved:0},asOf:impact.asOf}};
  const Page=domain('h4-promotions.tsx',hook,()=>[ {...fresh,data:catalog},list ][readIndex++]).default;
  hook.reset();const html=markup(Page({ctx:{can:()=>true},legacy:null}));
  assert(html.includes('资金或设备发放凭证')&&html.includes('还没有匹配的活动'));assert.doesNotMatch(html,forbidden);
  const rewardHook=hooks(),Rewards=domain('h4-promotion-rewards.tsx',rewardHook,{...fresh,data:{items:[],total:0,asOf:impact.asOf}}).default;
  rewardHook.reset();const rewards=markup(Rewards({activity,catalog,can:()=>true,onBack(){}}));
  assert(rewards.includes('资金或设备发放凭证')&&rewards.includes('结果未知先核账')&&rewards.includes('活动结束本身不构成依据'));
  assert.match(rewards,/class="value accent">0</);assert.doesNotMatch(rewards,forbidden);
});

test('PCOPY-03: actual receipt detail preserves money, device IDs, both currencies and locked disclosures',()=>{
  const record={obligationId:'R1',orderNo:'O1',version:1,state:'ISSUED',beneficiaryRole:'BUYER',beneficiaryId:'12',reward:{type:'USDT',amount:'0.000001'},assetReceipt:{ledgerBizNo:'L1',earningsEntryNo:'E1',instanceNos:['DEVICE-1'],issuedAt:impact.asOf},disclosure:{title:draft.title,terms:draft.terms,benefitDescription:{zh:'锁定权益'},refundTerms:{zh:'整单钱包退款'}},recoveredAmount:'0.000000',recoveryOutstanding:'1.000000',dispositionOptions:[],attempts:[{commandId:'original-command-1',state:'SUCCEEDED'}]};
  for(const reward of [{type:'USDT',amount:'0.000001'},{type:'NEX',amount:'2.000000'},{type:'DEVICE',quantity:1}]){
    const hook=hooks(),Detail=domain('h4-promotion-rewards.tsx',hook,{...fresh,data:{...record,reward}},['RewardDetail']).RewardDetail;hook.reset();const html=markup(Detail({id:'R1',can:()=>false,onClose(){},onChanged(){}}));
    for(const expected of ['原奖励承诺与发放凭证','发放设备','DEVICE-1','L1','E1','原操作编号','original-command-1','锁定权益','整单钱包退款','0.000000','1.000000'])assert(html.includes(expected),expected);
    assert.doesNotMatch(html,forbidden);
  }
});

test('PCOPY-04: actual loading retains live region and skeleton; actual failure preserves retry and write constraints',()=>{
  const html=markup(ui.Loading());assert(html.includes('正在加载，请稍候。'));for(const a of ['role="status"','aria-live="polite"','aria-busy="true"'])assert(html.includes(a));assert.equal((html.match(/class="skeleton-row"/g)||[]).length,6);assert.doesNotMatch(html,forbidden);
  let retries=0;const panel=ui.PromotionReadPanel({title:'活动中心',loading:false,errors:[{target:'活动目录',error:Error('当前资料暂不可用'),retry(){retries++;}}]});const failure=markup(panel);
  for(const text of ['不代表没有记录','动作已停用','不会再次创建活动或奖励','先核查原操作结果','不要重复提交'])assert(failure.includes(text));
  const retry=nodes(panel).find(n=>n.type===ui.Empty).props.action.props.children[0];retry.props.onClick();assert.equal(retries,1);
});

test('PCOPY-05: actual editor preserves independent roles, budget obligations and missing occupancy without invented zero',()=>{
  const hook=hooks(),Editor=domain('h4-promotion-editor.tsx',hook,fresh).default;
  hook.states[6]=3;hook.reset();const html=markup(Editor(editorProps));
  for(const text of ['购买者','直接邀请人','资产奖励、订单立减与每种赠品分别核算','发放失败的原奖励继续占用','实际追回前不恢复额度','100.000000','保存成功后显示已保存版本'])assert(html.includes(text),text);
  assert.equal((html.match(/<td>-<\/td>/g)||[]).length,3);assert.doesNotMatch(html,/暂无占用快照|服务端/);
  const known=structuredClone(activity);known.impact.budgets=[{asset:'USDT',committed:'0.000000',reserved:'0.000000',available:'100.000000'}];
  const knownHook=hooks({6:3}),Known=domain('h4-promotion-editor.tsx',knownHook,fresh).default;knownHook.reset();const actual=markup(Known({...editorProps,activity:known}));assert(actual.includes('<td>0.000000</td>'));
  known.current.draft.budgets=[{asset:'DISCOUNT_USDT',total:'1000.000000'}];known.impact.budgets=[{asset:'DISCOUNT_USDT',committed:'500.000000',reserved:'0.000000',available:'500.000000'}];
  const discountHook=hooks({6:3}),Discount=domain('h4-promotion-editor.tsx',discountHook,fresh).default;discountHook.reset();const discount=markup(Discount({...editorProps,activity:known}));assert(discount.includes('订单立减（USDT）'));assert(discount.includes('500.000000<small>已用立减</small>'));
});

test('PCOPY-05: actual audience counters distinguish unknown from actual zero',()=>{
  for(const value of [null,0]){
    const hook=hooks({6:1,11:{matched:value,rejected:value,unknown:value,reasonCounts:[{message:{zh:'条件未确认'},count:value}],samples:[],asOf:impact.asOf}}),Editor=domain('h4-promotion-editor.tsx',hook,fresh).default;hook.reset();const html=markup(Editor(editorProps));
    const cells=(html.match(/<td>[^<]*<\/td>/g)||[]).join('');assert(cells.includes(value===null?'<td>-</td>':'<td>0</td>'));assert(!cells.includes('<td>未知</td>'));
  }
});

test('PCOPY-05/06: actual date hints hide storage details while retaining local values and all-version scope',()=>{
  for(const populated of [false,true]){
    const row=structuredClone(activity);row.current.draft={...row.current.draft,displayTimezone:'Asia/Tokyo',startsAt:populated?activity.startsAt:null,endsAt:populated?activity.endsAt:null};
    const hook=hooks(),Editor=domain('h4-promotion-editor.tsx',hook,fresh).default;hook.reset();const element=Editor({...editorProps,activity:row}),html=markup(element);
    assert.doesNotMatch(html,forbidden);assert.equal(html.includes('先选择时区，再填写日期'),!populated);
    const dates=nodes(element).filter(n=>n.type?.name==='H4DateTimeField');
    assert.deepEqual(dates.map(n=>n.props.value),populated?['2026-10-08T09:00','2026-10-12T09:00']:['','']);
    assert.deepEqual(dates.map(n=>n.props.timeZone),['Asia/Tokyo','Asia/Tokyo']);
    assert.equal((html.match(/class="h4-datetime-trigger"/g)||[]).length,2);
    for(const value of populated?['2026/10/08 09:00','2026/10/12 09:00']:['请选择日期和时间'])assert(html.includes(value),value);
  }
  const hook=hooks(),Review=domain('h4-promotion-review.tsx',hook,fresh).default;hook.reset();const html=markup(Review({activity,catalog,can:()=>true,review:false,onBack(){}}));
  assert(html.includes('更新时间：'+ui.formatTime(impact.asOf)+'；包含活动所有版本。'));assert.doesNotMatch(html,forbidden);
});

test('PCOPY-05/06: actual review and policy dialogs preserve review, publication, contract and refund restrictions',()=>{
  const hook=hooks(),Review=domain('h4-promotion-review.tsx',hook,fresh).default;hook.reset();const html=markup(Review({activity,catalog,can:()=>true,review:true,onBack(){}}));
  assert(html.includes('审核与发布须分别操作')&&html.includes('结果未知时先核查原操作')&&html.includes('查看试算结果'));assert.doesNotMatch(html,/同一响应|服务端/);
  const Policy=domain('h4-promotion-policies.tsx',hooks(),fresh).default;const policy=markup(Policy({catalog,can:()=>false,onClose(){},onChanged(){}}));assert(policy.includes('只可选择适用的原业务协议版本。未批准政策不能执行活动。'));
  const createHook=hooks(),Create=domain('h4-promotion-policies.tsx',createHook,fresh,['PolicyCreate']).PolicyCreate;createHook.reset();const create=markup(Create({catalog,can:()=>false,onClose(){},onDone(){}}));
  assert(!create.includes('目录自动绑定'));for(const term of ['整单钱包退款','不允许负余额或跨币抵扣','原商品合同'])assert(create.includes(term));
});

test('new device-rights policies only offer executable task rules while historical disabled values stay readable',()=>{
  const hook=hooks(),policies=domain('h4-promotion-policies.tsx',hook,fresh,['PolicyCreate']);hook.reset();
  const create=policies.PolicyCreate({catalog,can:()=>true,onClose(){},onDone(){}});
  const taskField=nodes(create).find(n=>n.type===ui.Field&&n.props.label==='任务参与方式 *');
  assert.deepEqual(nodes(taskField.props.children).filter(n=>n.type==='option'&&n.props.value).map(n=>n.props.value),['EXISTING_PRODUCT_RULES']);
  const legacy=markup(policies.PromotionPolicyDetails({policy:{state:'DRAFT',content:{kind:'DEVICE_RIGHTS',taskEligibility:'DISABLED'},resolvedDeviceRights:null},catalog}));
  assert(legacy.includes('不参与任务（历史设置）'));
});

test('PCOPY-C1: actual policy selector retains isolated restriction, review gate and accessible binding description',()=>{
  for(const fixture of [false,true])for(const state of ['APPROVED','DRAFT']){
    const policy={policyId:'P1',version:2,contentHash:'hash',fixture,state,content:{kind:'ASSET',asset:'USDT',availabilityDescription:{zh:'成熟后可用'}}};
    const hook=hooks(),Selector=domain('h4-promotion-editor.tsx',hook,fresh).PolicySelect;hook.reset();const element=Selector({label:'政策',kind:'ASSET',value:form.policyRef(policy),catalog:{...catalog,policies:[policy]},onChange(){}}),html=markup(element);
    assert.equal(html.includes('仅限隔离范围使用'),fixture);assert.equal(html.includes('当前不可用'),state==='DRAFT');assert(html.includes('版本 2')&&html.includes('aria-describedby=')&&html.includes('title="P1"'));assert.doesNotMatch(html,/隔离测试政策/);
    const select=nodes(element).find(n=>n.type===ui.Field).props.children;const option=nodes(select).find(n=>n.type==='option'&&n.props.value==='P1:2');assert.equal(option.props.disabled,state!=='APPROVED');
  }
});

function metrics(data,states={}){
  const hook=hooks({4:data,...states}),Metrics=domain('h4-promotion-metrics.tsx',hook,fresh).default;hook.reset();return Metrics({activity,catalog,can:()=>true,onBack(){}});
}
function metricData(value=null){return {querySnapshot:'Q1',asOf:impact.asOf,from:activity.startsAt,to:activity.endsAt,timezone:'UTC',completeness:'DELAYED',netReceivedUsdt:'0.000000',paidOrders:0,refundUsdt:'0.000000',conversionRate:value,impressions:value,quotes:0,orders:0,giftDevices:0,giftCostUsdt:null,assets:[{asset:'USDT',issued:value,pending:value,reversed:value,unrecoverable:value},{asset:'NEX',issued:value,pending:value,reversed:value,unrecoverable:value}],salesBySku:null,effectiveFirstPurchasePeople:{value},directInvitedQualifiedPurchasers:{value},rewardFailureMetrics:{value},recoveryDuration:{value},externalInflowUsdt:value,externalOutflowUsdt:value,breakdown:{rows:[],total:0,hasMore:false}};}

test('PCOPY-07: report, group and export times use the same selected timezone',()=>{
  for(const timezone of ['UTC','Asia/Tokyo','Asia/Ho_Chi_Minh']){
    const data={...metricData(0),timezone},expiresAt='2026-10-12T03:24:00Z';
    const element=metrics(data,{1:true,7:true,8:{state:'READY',rowCount:0,expiresAt}}),all=nodes(element);
    const dialog=all.find(n=>n.type===ui.Dialog&&n.props.title==='奖励分组明细');
    assert(markup(dialog).includes(`统计截止 ${ui.formatTime(data.asOf,timezone)} · ${timezone}`));
    const command=all.find(n=>n.type===ui.ConfirmCommand);
    const summary=nodes(command).find(n=>n.type===ui.Summary);
    assert.equal(summary.props.rows.find(row=>row[0]==='统计时刻')[1],`${ui.formatTime(data.asOf,timezone)} · ${timezone}`);
    const job=all.find(n=>n.type===ui.Card&&n.props.title==='导出任务');
    assert.equal(nodes(job).find(n=>n.type===ui.Summary).props.rows.find(row=>row[0]==='有效截止')[1],`${ui.formatTime(expiresAt,timezone)} · ${timezone}`);
  }
});

test('PCOPY-07: missing report inputs do not mark real transaction counts unavailable',()=>{
  const data={...metricData(null),completeness:'UNAVAILABLE',quotes:0,orders:3,paidOrders:2};
  const element=metrics(data),table=nodes(element).find(n=>n.type===ui.Table&&n.props.headers[0]==='事实');
  assert.deepEqual(table.props.rows.map(row=>row[1]),['-',0,3,2]);
  assert.deepEqual(table.props.rows.map(row=>row[2].props.value),['UNAVAILABLE','COMPLETE','COMPLETE','COMPLETE']);
  assert(markup(element).includes('部分统计资料暂不可用'));
  assert.doesNotMatch(markup(element),/当前数据延迟或不可用/);
});

test('PCOPY-07: actual metrics empty, failure and delayed result states explain result and retain query/export binding',()=>{
  const empty=markup(metrics(null));assert(empty.includes('请选择统计范围后查询。'));assert.doesNotMatch(empty,/服务端查询快照/);
  const failure=markup(metrics(null,{5:Error('活动效果暂不可用')}));assert(failure.includes('role="alert"')&&failure.includes('活动效果暂不可用')&&failure.includes('继续修改'));
  const element=metrics(metricData()),html=markup(element);for(const value of ['部分统计资料延迟','设备成交明细暂不可用','请重新查询','双币独立列示，不自动折算','跨设备订单数不直接相加','统计截止','UTC','导出当前报表'])assert(html.includes(value),value);
  assert.doesNotMatch(html,/服务端|来源：|不含测试与重复事件|不推算获客成本/);
  const exporting=nodes(metrics(metricData(),{7:true})).find(n=>n.type===ui.ConfirmCommand);assert.deepEqual(exporting.props.body,{querySnapshot:'Q1'});assert.equal(exporting.props.title,'导出当前报表');
});

test('PCOPY-07: actual metrics summary, group and asset values render missing dash while preserving actual zero',()=>{
  for(const value of [null,0])for(const states of [{},{0:true},{1:true}]){
    const html=markup(metrics(metricData(value),states));assert(!html.includes('<b>未知</b>')&&!html.includes('<td>未提供</td>'));
    assert(html.includes(value===null?'<td>-</td>':'<td>0</td>'));assert(html.includes('0.000000')&&html.includes('0 台'));
    if(states[0])assert(html.includes(value===null?'<b>-</b>':'<b>0</b>'));
  }
});

test('PCOPY-07: loading or failed group queries never show the previous empty result as current',()=>{
  for(const state of [{6:true},{5:Error('查询结果已失效，请重新查询。')}]){
    const element=metrics(metricData(0),{1:true,...state});
    const dialog=nodes(element).find(n=>n.type===ui.Dialog&&n.props.title==='奖励分组明细');
    const html=markup(dialog);assert.doesNotMatch(html,/这个时段没有记录|共 0 组|<td>0<\/td>/);
    if(state[5]){
      assert(html.includes('role="alert"')&&html.includes('查询结果已失效'));
      const exporting=nodes(element).find(n=>n.type===ui.Button&&n.props.children==='导出当前报表');
      assert.equal(exporting.props.disabled,true);
    }
  }
  const ready=nodes(metrics(metricData(0),{1:true})).find(n=>n.type===ui.Dialog&&n.props.title==='奖励分组明细');
  assert(markup(ready).includes('这个时段没有记录'));
});

test('PCOPY-08: actual recovery dialog reads original result with revoked write permission and keeps original parameters',async()=>{
  let reads=0,writes=0;const record={operation:'saveDraft',targetId:'A1',commandKey:'original-key',body:{reason:'原理由'},recoveryState:'NOT_FOUND'},hook=hooks();
  const Gate=evaluate(h+'h4-promotion-ui.tsx',name=>name==='react'?hook.react:name==='react/jsx-runtime'?require(name):name.endsWith('error-messages')?{displayAdminError}:name.endsWith('promotion-client')?{...client,pendingPromotionCommands:()=>[record],promotionCommand:async()=>{writes++;},recoverPromotionCommand:async()=>{reads++;return {status:'NOT_FOUND'};}}:{});
  hook.states[0]={minChars:1,maxChars:100};hook.states[1]=null;hook.states[2]=false;
  const props={title:'恢复原操作',intent:{operation:'saveDraft',targetId:'A1',path:'/promotions/A1/draft',method:'PUT'},body:{},writeAllowed:false,onClose(){},onSuccess(){}};
  hook.reset();let element=Gate.ConfirmCommand(props),all=nodes(element);let retry=all.find(n=>n.type===Gate.Button&&n.props.children==='原样重试');assert.equal(retry.props.disabled,true);await retry.props.onClick();assert.equal(writes,0);
  const recover=all.find(n=>n.type===Gate.Button&&n.props.children==='核查原操作');assert.equal(recover.props.disabled,false);await recover.props.onClick();assert.equal(reads,1);
  hook.reset();element=Gate.ConfirmCommand(props);const html=markup(element);for(const text of ['原操作待核实','原输入与操作记录继续保留','原操作编号重试','原理由'])assert(html.includes(text),text);assert.doesNotMatch(html,/原命令/);assert.equal(writes,0);assert.equal(record.commandKey,'original-key');assert.deepEqual(record.body,{reason:'原理由'});
});

test('PCOPY-C2: actual H4 error mapping never passes unknown Chinese SQL/path diagnostics and preserves known decisions',()=>{
  for(const raw of ['数据库查询失败 at D:/CodexData/private/db.sql SELECT password FROM nx_user','数据库POLICY查询失败 D:/private','Unexpected response GET /api/internal','NEW_UNKNOWN_CODE']){
    const shown=client.promotionErrorMessage(raw,500);assert(shown&&/[一-鿿]/.test(shown));assert.doesNotMatch(shown,/数据库|D:\/|SELECT|password|nx_user|api\/internal|NEW_UNKNOWN_CODE/);
    const html=markup(ui.ReadError({target:'活动资料',error:new client.PromotionApiError(shown),retry(){}}));assert.doesNotMatch(html,forbidden);assert(html.includes('role="alert"'));
  }
  const cases=[['PROMOTION_VERSION_CONFLICT',409,'最新版本'],['PROMOTION_MAKER_CHECKER',422,'另一名'],['PROMOTION_FIELD_INVALID',422,'下方字段'],['PROMOTION_POLICY_NOT_APPROVED',422,'批准状态'],['PROMOTION_BUDGET_EXHAUSTED',422,'预算或设备额度'],['AUTHORITATIVE_PAGE_INVALID',500,'相关操作已停用']];
  for(const [code,status,expected] of cases)assert(client.promotionErrorMessage(code,status).includes(expected));assert(client.promotionErrorMessage('AUTHORITATIVE_PAGE_INVALID',403).includes('没有此操作权限'));
  assert.doesNotMatch(client.promotionErrorMessage('AUTHORITATIVE_PAGE_INVALID',500),/服务端权威/);
  for(const code of ['PROMOTION_LIST_SNAPSHOT_EXPIRED','PROMOTION_QUERY_SNAPSHOT_EXPIRED']){
    const message=client.promotionErrorMessage(code,409);
    assert(message.includes('重新查询')&&message.includes('筛选条件已保留'));
    assert.doesNotMatch(message,/快照|接口|服务端/);
  }
});

test('PCOPY-09: actual coverage tooltip/a11y shows unavailable status without zero and preserves reserve/liability definition',()=>{
  for(const [hasData,loading,error] of [[false,true,null],[false,false,null],[true,false,Error('offline')],[true,false,null]]){
    const hook=hooks(),{top}=shell(hook,{ledger:{coverageRatio:0,redlinePct:0.8,healthyPct:1},hasData,loading,error});hook.reset();const html=markup(top.CoveragePill({enabled:true}));
    if(!hasData||error){assert(html.includes('>\u002d</span>'));assert(html.includes('兑付覆盖率暂不可用'));assert.doesNotMatch(html,/0%|接口|B 域/);}else{assert(html.includes('0%')&&html.includes('可用储备 ÷ 应付款'));}
    assert(html.includes('aria-label="兑付覆盖率：'));
  }
  assert(read('app/components/shell/console-shell.tsx').includes('暂时无法确认登录状态，请重试。'));
});

test('PCOPY-10: actual H4 existing-events branch renders business state labels and preserves stock/time/claim rules',()=>{
  const hook=hooks({0:{dayOneTasks:[],weeklyTier1:[],weeklyTier2:[],monthlyMissions:[],events:[],wheelTiers:[],wheelGuards:[{key:'cap',label:'每日上限',value:'-'}],trackables:[],h4Stats:{ongoing:0,trackJoin:0,trackDone:0,trackClaim:0,wheelToday:0,geoBlocked:0}},1:false,2:null});
  const Legacy=domain('h3-quest-events.tsx',hook,fresh).H3QuestEvents;hook.reset();const html=markup(Legacy({section:'events',ctx:{can:()=>false,toast(){},openActionConfirm(){},openConfirm(){}}}));
  for(const text of ['每日上限按各奖项的每日库存设置','资金奖励暂停','可追踪活动监控','已参与','已达标','已领取','活动结束或下架后不可领取','每日仅可领取一次','地域限制'])assert(html.includes(text),text);
  assert.doesNotMatch(html,/后端|服务端|dailyStock|Trackable|各域状态消费|领取赛跑|真实奖正常开放|joined|claimed|ongoing|upcoming/);
  assert(html.includes('>0</div>'));assert(html.includes('跌破 100%')&&html.includes('只发 UVEL/券')&&html.includes('回升自动恢复'));
});

test('all ten groups: exact public-source guard covers normal/empty/error/title and accessible consumers without renaming data',()=>{
  const files=['h4-promotion-ui.tsx','h4-promotion-editor.tsx','h4-promotion-banner.tsx','h4-promotion-review.tsx','h4-promotion-rewards.tsx','h4-promotion-policies.tsx','h4-promotion-metrics.tsx','h4-promotions.tsx'];
  for(const file of files){const source=read(h+file);assert.doesNotMatch(source,forbidden,file);assert.doesNotMatch(source,/不由浏览器重算|目录自动绑定当前版本|版本和内容摘要由目录绑定|不能由同一响应|读取服务端结果|以服务端发布复核|曝光与成本缺失时保持未提供|来源：订单、退款与奖励确认事实/);}
  const legacy=read(h+'h3-quest-events.tsx');for(const retained of ['至少还要保留 2 个奖项','概率调成 0%','100%','红线'])assert(legacy.includes(retained));
  assert(read('lib/admin/promotion-client.ts').includes("'Idempotency-Key':key"));assert(read(h+'h4-promotions.tsx').includes('p.name ||'));
  assert(read('app/components/domain-views/h-view.tsx').includes('useShallow')); // Root owns identity/permission stability.
});

test('PCOPY-05/07: actual simulation distinguishes unlimited quota from unknown, preserves zero and never occupies budget',()=>{
  for(const [limit,status,remaining,expected] of [[null,'AVAILABLE',null,'无限制'],[null,'UNKNOWN',null,'-'],[4,'UNKNOWN',null,'-'],[4,'AVAILABLE',0,0]]){
    const simulation={eligibility:'UNKNOWN',asOf:impact.asOf,ruleResults:[{productNo:'SKU1',beneficiaries:[{status:'UNKNOWN',rewardUnits:null,reasons:[]}]}],rewardUnits:[],blockers:[],resources:[{asset:'USDT',required:null,available:null,status:'UNKNOWN'}],quotaImpact:[{scope:'ACTIVITY_ORDER',limit,status,remaining,usedAndReserved:null,required:null}],pricing:null,publicPreview:null};
    const hook=hooks({1:simulation}),Review=domain('h4-promotion-review.tsx',hook,fresh).default;hook.reset();const element=Review({activity,catalog,can:()=>true,review:true,onBack(){}});
    const quota=nodes(element).find(n=>n.type===ui.Table&&n.props.headers[0]==='上限范围');assert.equal(quota.props.rows[0][3],expected);
    const tables=nodes(element).filter(n=>n.type===ui.Table),reward=tables.find(n=>n.props.headers[0]==='购买设备'),resource=tables.find(n=>n.props.headers[0]==='资源');
    assert.equal(reward.props.rows[0][2],'-');assert.deepEqual(resource.props.rows[0].slice(1,3),['-','-']);assert.deepEqual(quota.props.rows[0].slice(1,3),['-','-']);
    const html=markup(element);assert(html.includes('占用资格 / 预算')&&html.includes('<b>否</b>'));assert(html.includes('活动权益暂无法确认'));assert(!html.includes('无限制或未知'));
  }
});

test('PCOPY-05: actual budget dialog preserves unknown, insufficient and sufficient publication restrictions',()=>{
  for(const [occupied,total,expected] of [[null,'100.000000','发布前须确认当前占用'],[{reserved:'1.000000',committed:'2.000000',issued:'0.000000',reversed:'0.000000'},'1.000000','低于当前已用和有效预留合计 3.000000'],[{reserved:'1.000000',committed:'2.000000',issued:'0.000000',reversed:'0.000000'},'4.000000','发布前须再次核对占用']]){
    const row=structuredClone(activity);row.impact.budgets=occupied?[{asset:'USDT',...occupied}]:[];const hook=hooks(),Budget=domain('h4-promotion-editor.tsx',hook,fresh,['BudgetEditor']).BudgetEditor;hook.reset();
    const html=markup(Budget({activity:row,catalog,draft:{rules:[],budgets:[{asset:'USDT',total}]},onClose(){},onSave(){}}));assert(html.includes(expected));assert(html.includes('保存草稿不会释放既有义务'));assert.doesNotMatch(html,/服务端/);
  }
});

test('order-discount review shows server totals separately and keeps absent legacy detail unknown',()=>{
  for(const promotionDiscountUsdt of ['500.000000',undefined]){
    const simulation={eligibility:'ELIGIBLE',asOf:impact.asOf,ruleResults:[],rewardUnits:[],blockers:[],resources:[{kind:'BUDGET',asset:'DISCOUNT_USDT',required:'500.000000',available:'1000.000000',status:'AVAILABLE'}],quotaImpact:[],pricing:{subtotalUsdt:'2000.000000',discountUsdt:'600.000000',promotionDiscountUsdt,amountUsdt:'1400.000000'},publicPreview:null};
    const hook=hooks({1:simulation}),Review=domain('h4-promotion-review.tsx',hook,fresh).default;hook.reset();const element=Review({activity,catalog,can:()=>true,review:true,onBack(){}});
    const pricing=nodes(element).find(node=>node.type===ui.Summary&&node.props.rows[0]?.[0]==='商品小计（USDT）');
    assert.deepEqual(pricing.props.rows,[['商品小计（USDT）','2000.000000'],['优惠合计（USDT）','600.000000'],['其中订单立减（USDT）',promotionDiscountUsdt??'未提供'],['应付款（USDT）','1400.000000']]);
    const resource=nodes(element).find(node=>node.type===ui.Table&&node.props.headers[0]==='资源');assert.equal(resource.props.rows[0][0],'订单立减（USDT）');
  }
});

test('PCOPY-03/07: actual reward summary keeps unconfirmed money as dash while retaining required reconciliation',()=>{
  const record={state:'OUTCOME_UNKNOWN',version:1,beneficiaryRole:'BUYER',beneficiaryId:'12',reward:{type:'USDT',amount:'1.000000'},disclosure:{title:draft.title,terms:draft.terms,benefitDescription:{zh:'锁定权益'},refundTerms:{zh:'整单钱包退款'}},recoveredAmount:null,recoveryOutstanding:null,dispositionOptions:[],attempts:[]};
  const hook=hooks(),Detail=domain('h4-promotion-rewards.tsx',hook,{...fresh,data:record},['RewardDetail']).RewardDetail;hook.reset();const element=Detail({id:'R1',can:()=>false,onClose(){},onChanged(){}}),summary=nodes(element).find(n=>n.type===ui.Summary),html=markup(element);
  for(const label of ['已追回','未结追回'])assert.equal(summary.props.rows.find(row=>row[0]===label)[1],'-');assert(html.includes('追回金额未确认时须先核账'));
  for(const label of ['取消原奖励项','发起冲正'])assert.equal(nodes(element).find(n=>n.type===ui.Button&&n.props.children===label).props.disabled,true);
});

test('PCOPY-08: actual client refuses storage-loss writes before dispatch and explains that nothing was submitted',async()=>{
  let requests=0;const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
  globalThis.fetch=async()=>{requests++;throw Error('No dispatch permitted');};
  globalThis.window={sessionStorage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}}};
  try{
    await assert.rejects(client.promotionCommand({operation:'saveDraft',targetId:'public-copy-storage-only',path:'/promotions/public-copy-storage-only/draft',method:'PUT',body:{draft:{name:'保留原输入'},reason:'原理由'}}),error=>error instanceof client.PromotionApiError&&error.status===422&&error.message==='当前页面无法保留本次操作记录，尚未提交。请检查浏览器设置后重试。');assert.equal(requests,0);
  }finally{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;globalThis.fetch=previousFetch;}
});

test('PCOPY-10: actual H4 confirmation callbacks preserve reasons, stale-value checks and probability/stock constraints',()=>{
  const model={dayOneTasks:[],weeklyTier1:[],weeklyTier2:[],monthlyMissions:[],events:[{id:'EV1',name:'PCGP event',kind:'quest',state:'ongoing',reward:'2 UVEL',featured:false}],wheelTiers:[{tier:'T1',prob:0,reward:'NEX'},{tier:'T2',prob:50,reward:'券'},{tier:'T3',prob:50,reward:'USDT',real:true}],wheelGuards:[{key:'kill',label:'启停',value:'已停用'}],trackables:[]};
  const hook=hooks({0:model,1:false,2:null}),Legacy=domain('h3-quest-events.tsx',hook,fresh).H3QuestEvents,confirmations=[];hook.reset();const element=Legacy({section:'events',ctx:{can:()=>true,toast(){},openActionConfirm:value=>confirmations.push(value),openConfirm:value=>confirmations.push(value)}}),buttons=nodes(element).filter(n=>n.type==='button');
  for(const label of ['编辑','下架','设主推','改奖池 / 概率'])buttons.find(n=>n.props.children===label).props.onClick();
  buttons.find(n=>n.props['aria-label']==='删除 T1（UVEL）').props.onClick();
  const html=confirmations.map(c=>markup(c.detail)).join('');for(const expected of ['确认后更新活动奖励','请确认目标状态','同时只能有一个进行中的主推活动','概率合计须为 100%','B1 红线','删除后仍至少保留 2 个档位'])assert(html.includes(expected),expected);assert.doesNotMatch(html,/后端|服务端|接口|互斥锁/);
  const state=confirmations.find(c=>c.action.startsWith('活动状态'));assert.equal(state.reason,true);const probability=confirmations.find(c=>c.action==='调整转盘档位概率');assert.equal(probability.businessForm.fields.length,3);assert.equal(probability.amplifies,true);
});
