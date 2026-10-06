/* Standalone static design: public staff aggregates only. Host globals are read at call time. */
const leaderboardState={metric:'first',month:'2026-10',coin:'USDT',scope:'all',query:'',page:1,located:false};
let leaderboardComposing=false;
const leaderboardMetrics={first:{label:'首充人数',unit:'人'},recharge:{label:'充值贡献',money:true},purchase:{label:'购机贡献',money:true},size:{label:'客户规模',unit:'人'}};
const leaderboardSnapshot={version:'公开样例 10-06-A',at:'2026-10-06 10:30',baseline:'2026-10-05 日末',zone:'Asia/Tokyo',pageSize:5};
// Published previous ranks are a separate, explicit design sample; missing rows are not new qualifiers.
const leaderboardPrevious={周芷宁:{rank:2,value:15},杨帆:{rank:1,value:18},张晓雨:{rank:3,value:12},Mia:{rank:5,value:8},王浩然:{rank:4,value:9},李思琪:{newQualifier:true},陈子航:{}};

function leaderboardRank(rows){
 const sorted=rows.map((row,index)=>({...row,stable:index})).sort((a,b)=>a.value==null?b.value==null?a.stable-b.stable:1:b.value==null?-1:a.value===b.value?a.stable-b.stable:a.value>b.value?-1:1);
 let previous=null,rank=0;
 return sorted.map((row,index)=>{if(row.value==null)return {...row,rank:null};if(previous===null||row.value!==previous)rank=index+1;previous=row.value;return {...row,rank};});
}
function leaderboardNet(success,refund,complete){
 if(!complete||typeof success!=='bigint'||typeof refund!=='bigint'||success<0n||refund<0n||refund>success)return null;
 return success-refund;
}
function leaderboardAmount(value){
 if(value==null)return '未提供';
 const whole=value/1000000n,decimal=(value%1000000n).toString().padStart(6,'0').replace(/0+$/,'');
 return whole.toLocaleString('en-US')+(decimal?'.'+decimal:'');
}
function leaderboardScopes(){
 const allowed=role==='agent'?groups.filter(g=>g.id===staff.find(r=>r[0]==='Mia')?.[7]):visibleGroups();
 return [{id:'all',name:'全员'},...allowed.map(g=>({id:g.id,name:role==='agent'?'本人所在组 · '+g.name:g.name}))];
}
function leaderboardScopeName(){return leaderboardScopes().find(g=>g.id===leaderboardState.scope)?.name||'全员';}
function leaderboardSelectScope(next){if(!leaderboardScopes().some(g=>g.id===next))return false;leaderboardState.scope=next;leaderboardState.page=1;leaderboardState.located=false;return true;}
function leaderboardSampleRows(){
 const s=leaderboardState,m=leaderboardMetrics[s.metric],available=(s.metric==='size'||s.month==='2026-10')&&(!m.money||s.coin==='USDT');
 return staff.map(r=>{
  const success=!available?null:s.metric==='recharge'?BigInt(r[6])*1000000n:s.metric==='purchase'&&r[0]==='Mia'?8600000000n:null;
  const value=!available?null:s.metric==='first'?BigInt(r[5]):s.metric==='size'?BigInt(r[1]):leaderboardNet(success,null,false);
  return {name:r[0],group:r[7],value,success,refund:null,reason:!available?'该条件未提供样例':m.money?'退款覆盖未提供，暂不可排名':null};
 });
}
function leaderboardRows(){
 const scope=leaderboardState.scope;
 return leaderboardRank(leaderboardSampleRows().filter(row=>scope==='all'||row.group===scope));
}
function leaderboardValue(value){return value==null?'暂不可比':leaderboardMetrics[leaderboardState.metric].money?leaderboardAmount(value):value.toLocaleString('en-US');}
function leaderboardChange(row){
 const s=leaderboardState,old=leaderboardPrevious[row.name];
 if(s.metric!=='size'&&s.month!=='2026-10')return {type:'hidden',label:'历史月不显示日升降',reason:'每个自然月重新开始比较，不跨月接续名次。'};
 if(row.rank==null)return {type:'unknown',label:'无基线',reason:'本次有效成绩缺数，当前名次暂不可比。'};
 if(s.metric!=='first')return {type:'unknown',label:'无基线',reason:'当前指标未提供同条件昨日末名次样例。'};
 if(s.scope!=='all')return {type:'unknown',label:'无基线',reason:'当前成员范围未提供可比的昨日末快照；成员集合变化时不推算组范围升降。全员榜不因单纯调组停止比较。'};
 if(old?.newQualifier)return {type:'new',label:'新入榜',reason:'设计样例已明确：李思琪于 10-06 新获得参榜资格；不是把缺少昨日数据当成新入榜。'};
 if(!Number.isInteger(old?.rank))return {type:'unknown',label:'无基线',reason:'未提供该客服的昨日末名次证据，无法判断升降，也不标新入榜。'};
 const delta=old.rank-row.rank;
 return {type:delta>0?'up':delta<0?'down':'same',label:delta>0?'↑ 上升 '+delta+' 位':delta<0?'↓ 下降 '+Math.abs(delta)+' 位':'— 持平',delta,old,reason:'昨日末已发布名次 − 当前名次；相同成绩共享名次，不按行号比较。'};
}
function leaderboardChangeButton(row){const change=leaderboardChange(row);return change.type==='hidden'?'<span class="lb-muted">—</span>':`<button type="button" class="lb-change lb-${change.type}" data-lb-change="${esc(row.name)}" aria-label="${esc(row.name)}，${esc(change.label)}，查看比较依据">${change.label}</button>`;}
function leaderboardHonor(rank){return Number.isInteger(rank)&&rank>=1&&rank<=3?['','gold','silver','bronze'][rank]:'';}
function leaderboardRankLabel(row,rows){return row.rank==null?'暂不可排名':`${rows.filter(r=>r.rank===row.rank).length>1?'并列':''}第 ${row.rank} 名`;}
function leaderboardAvatar(row,large=false){
 const honor=leaderboardHonor(row.rank);
 return `<span class="lb-avatar ${honor?'lb-honor lb-'+honor:''} ${large?'lb-avatar-large':''}">${honor?`<svg class="lb-crown" viewBox="0 0 30 20" aria-hidden="true"><path d="M3 5 9 9 15 2 21 9 27 5 24 17H6Z"/><path class="lb-crown-line" d="M8 14h14"/></svg>`:''}${avatar({name:row.name})}</span>`;
}
function leaderboardGap(row,rows){
 if(row?.rank==null||rows.some(r=>r.value==null)||row.rank===1)return null;
 const higher=rows.filter(r=>r.value>row.value).at(-1);
 return higher?higher.value-row.value:null;
}
function leaderboardMyHTML(rows){
 const scope=leaderboardScopeName();
 if(role!=='agent')return `<div class="lb-manager"><span>当前查看 <strong>${esc(scope)}</strong> · 公开成绩样例</span><span>此身份未兼任专属客服，不显示个人名次</span></div>`;
 const me=rows.find(r=>r.name==='Mia'),gap=leaderboardGap(me,rows),complete=rows.every(r=>r.value!=null),metric=leaderboardMetrics[leaderboardState.metric],unit=metric.money?leaderboardState.coin:'人';
 if(!me)return '<div class="lb-manager">Mia 不在当前参榜范围，未显示个人名次。</div>';
 return `<section class="lb-mine" aria-label="我的表现"><div class="lb-my-identity">${leaderboardAvatar(me,true)}<div><div class="lb-my-name">Mia <span>我的表现</span></div><p>${leaderboardRankLabel(me,rows)}${leaderboardState.scope==='all'?'':' · 本范围'}</p></div></div><div class="lb-my-stat"><div><strong>${me.value==null?'—':leaderboardValue(me.value)}</strong>${me.value==null?'':`<small>${unit}</small>`}</div><span>${metric.label}${me.value==null?' · 有效额未知':''}</span></div><div class="lb-my-stat lb-my-change"><div>${leaderboardChangeButton(me)}</div><span>较昨日末</span></div><div class="lb-my-stat lb-gap"><div>${gap!=null?`<strong>${leaderboardValue(gap)}</strong><small>${unit}</small>`:`<span>${me.rank===1?'同范围第 1 名':complete?'暂无上一档':'暂不可比'}</span>`}</div><span>${me.rank===1?'当前成绩':gap!=null?'距上一档':complete?'比较状态':'覆盖不足'}</span></div><div class="lb-my-action"><button type="button" class="text-button lb-locate" data-lb-locate>⌖ 定位我</button></div></section>`;
}
function leaderboardCondition(){const s=leaderboardState;return `${s.metric==='size'?'当前绑定快照':s.month==='2026-10'?'本月累计 · 10-01 至 10-06 10:30':'上月 · 2026-09'}${leaderboardMetrics[s.metric].money?' · '+s.coin:''} · ${leaderboardScopeName()}`;}
function leaderboardHeader(){
 const s=leaderboardState,m=leaderboardMetrics[s.metric];
 return `<header class="lb-head"><div><div class="lb-title-line"><h1>业绩榜</h1><span class="demo-badge">演示数据</span></div><p class="page-sub">同一口径，看见每一份进步。</p></div><div class="lb-filters">${s.metric!=='size'?`<label>月份<select id="lbMonth" aria-label="榜单月份"><option value="2026-10" ${s.month==='2026-10'?'selected':''}>本月</option><option value="2026-09" ${s.month==='2026-09'?'selected':''}>上月 · 样例未提供</option></select></label>`:'<span class="lb-snapshot-label">截至现在 · 非本月新增</span>'}${m.money?`<label>币种<select id="lbCoin" aria-label="榜单币种"><option ${s.coin==='USDT'?'selected':''}>USDT</option><option ${s.coin==='NEX'?'selected':''}>NEX</option></select></label>`:''}<label>参榜范围<select id="lbScope" aria-label="参榜人员范围">${leaderboardScopes().map(g=>`<option value="${g.id}" ${s.scope===g.id?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label></div></header><div class="lb-tabs" role="tablist" aria-label="业绩榜单">${Object.entries(leaderboardMetrics).map(([key,metric])=>`<button type="button" role="tab" id="lbTab-${key}" data-lb-tab="${key}" aria-selected="${s.metric===key}" aria-controls="lbPanel" tabindex="${s.metric===key?'0':'-1'}">${metric.label}</button>`).join('')}</div>`;
}
function leaderboardStateHTML(kind){
 const state={empty:['暂无参榜成员','空态演示：当前条件下没有符合资格的成员。真实成绩全为 0 时仍应正常列榜。'],loading:['正在读取榜单','加载态演示：当前查询尚无可用结果，保留筛选，不显示旧成绩。'],error:['暂时无法读取榜单','失败态演示：保留当前条件，重试只重新读取这份固定样例。'],history:['上月样例未提供','不是上月成绩为 0。历史月按自己的资格与数据版本计算，不沿用本月名次，不显示跨月日升降。'],coin:['NEX 样例未提供','有效额与退款覆盖均未知，不复用 USDT 金额或名次。']}[kind];
 return `<section class="lb-state" role="status"><span aria-hidden="true">${kind==='error'?'!':'◇'}</span><h2>${state[0]}</h2><p>${state[1]}</p>${['empty','loading','error'].includes(kind)?`<button type="button" class="btn-blue" data-lb-retry>${kind==='error'?'重试读取样例':'返回默认样例'}</button>`:''}</section>`;
}
function leaderboardTableHTML(rows){
 const s=leaderboardState,m=leaderboardMetrics[s.metric],q=s.query.trim().toLocaleLowerCase(),filtered=rows.filter(r=>r.name.toLocaleLowerCase().includes(q)),pages=Math.max(1,Math.ceil(filtered.length/leaderboardSnapshot.pageSize));
 s.page=Math.min(Math.max(1,s.page),pages);
 const unknown=rows.filter(r=>r.value==null).length,scope=leaderboardScopeName();
 return `<section class="lb-board" aria-label="公开业绩榜"><div class="lb-board-head"><div><h2>${esc(scope)}榜单</h2><p>${esc(leaderboardCondition())}${s.scope!=='all'?' · 按当前成员筛选':''}</p></div><label class="lb-search"><span class="sr-only">查找客服</span><span aria-hidden="true">⌕</span><input id="lbSearch" type="search" placeholder="查找客服" value="${esc(s.query)}" autocomplete="off"></label></div>${unknown?`<p class="lb-coverage">暂定：${unknown} 人有效额待核实，暂不可排名。已知成功额仅作旁列，不冒充有效额。</p>`:''}<div class="table-scroll lb-scroll" tabindex="0" role="region" aria-label="业绩榜表格，可横向滚动"><table class="lb-table"><thead><tr><th scope="col">名次${s.scope==='all'?'':' · 本范围'}</th><th scope="col">专属客服</th><th scope="col">当前组</th><th scope="col">${m.label}${m.money?' / '+s.coin:''}</th><th scope="col">较昨日末</th><th scope="col">操作</th></tr></thead><tbody>${filtered.slice((s.page-1)*leaderboardSnapshot.pageSize,s.page*leaderboardSnapshot.pageSize).map(row=>`<tr id="lb-row-${staff.findIndex(r=>r[0]===row.name)}" tabindex="-1" class="${row.name==='Mia'&&role==='agent'?'lb-self ':''}${s.located&&row.name==='Mia'?'lb-located ':''}${leaderboardHonor(row.rank)?'lb-top lb-top-'+leaderboardHonor(row.rank):''}"><td><span class="lb-rank ${leaderboardHonor(row.rank)?'lb-rank-'+leaderboardHonor(row.rank):''}">${row.rank==null?'—':String(row.rank).padStart(2,'0')}</span></td><td><div class="lb-person">${leaderboardAvatar(row)}<div class="lb-person-copy"><strong>${esc(row.name)}</strong><small class="lb-rank-label">${leaderboardRankLabel(row,rows)}</small></div>${row.name==='Mia'&&role==='agent'?'<span class="lb-me-tag">我</span>':''}</div></td><td>${esc(groups.find(g=>g.id===row.group)?.name||'待分组')}</td><td class="lb-score ${row.value==null?'lb-score-unknown':''}">${leaderboardValue(row.value)}${row.value!=null?'<small>'+ (m.money?'':'人')+'</small>':m.money?`<small class="lb-gross">${s.metric==='recharge'?'已知成功额':'已知实付'} ${leaderboardAmount(row.success)}</small>`:''}</td><td>${leaderboardChangeButton(row)}</td><td><button type="button" class="text-button" data-lb-summary="${esc(row.name)}">查看成绩 <span aria-hidden="true">↗</span></button></td></tr>`).join('')||'<tr><td colspan="6"><div class="lb-no-results">没有匹配的客服；搜索只定位，不改原榜名次，也不表示业绩为 0。<button type="button" data-lb-clear>清除搜索</button></div></td></tr>'}</tbody></table></div><footer class="lb-board-foot"><span>公开成绩仅展示 7 位客服样例，不代表平台完整榜单</span><div class="lb-pagination"><span>${filtered.length} 人 · ${s.page} / ${pages} 页</span><button type="button" id="lbPrev" data-lb-page="${s.page-1}" ${s.page===1?'disabled':''}>上一页</button><button type="button" id="lbNext" data-lb-page="${s.page+1}" ${s.page===pages?'disabled':''}>下一页</button></div></footer></section>`;
}
function leaderboardHTML(){
 const s=leaderboardState;if(!leaderboardScopes().some(g=>g.id===s.scope))s.scope='all';
 const status=viewState!=='default'?viewState:s.metric!=='size'&&s.month!=='2026-10'?'history':leaderboardMetrics[s.metric].money&&s.coin==='NEX'?'coin':null,rows=status?[]:leaderboardRows();
 return `<div class="page leaderboard-page">${leaderboardHeader()}<div id="lbPanel" role="tabpanel" aria-labelledby="lbTab-${s.metric}">${status?leaderboardStateHTML(status):leaderboardMyHTML(rows)+leaderboardTableHTML(rows)}</div><div class="lb-notes"><span>ⓘ 排名公开，客户明细仍按原权限查看。<button type="button" class="text-button" data-lb-rules>排名与比较说明</button></span><span>固定样例截至 10-06 10:30 · Asia/Tokyo <button type="button" class="text-button" id="lbRefresh" data-lb-refresh>重读样例</button></span></div><p class="lb-caption">${s.metric==='size'?'客户规模反映当前服务负载，不是本月新增业绩。':'月榜每月重置，历史归属不随当前调组搬移。'} ${s.scope==='all'?'':'本范围按当前成员筛选，不是事件发生时的组经营汇总。'}此页不连接真实服务，未设置自动刷新。</p></div>`;
}
function rankHomeLink(){return '<button type="button" class="text-button lb-home-link" data-page="leaderboard">查看业绩榜 <span aria-hidden="true">↗</span></button>';}
function leaderboardRulesHTML(){return `<p>本榜仅含七位公开设计样例；范围内完整数据先排名，再搜索、分页。真实同值采用 1、2、2、4；前三名的王冠与头像框随当前名次变化，并列享有相同标识，不代表永久等级或奖励。</p><p>首充人数含充值与合格购机，每客全历史一次、跨币种去重。金额榜分别统计原单有效额，不将充值与购机相加；退款完整覆盖缺失时暂不可排名。退款不抹去真实首充。</p><p>较昨日末固定比较 2026-10-05 日末与 ${leaderboardSnapshot.at}，业务时区 ${leaderboardSnapshot.zone}；沿用同指标、同月、同币种、同范围的已发布名次样例，不与上次打开页面比较。新入榜需要新增资格证据，缺旧数据显示无基线；组成员变化缺少可比快照时停止比较。</p><p>月初重新开始，不跨月比较；历史月不显示日升降。历史付款及退款修正应保留统计版本，不能静默拼接新旧结果。</p><p class="note">当前来源：既有客服公开汇总样例；昨日名次为独立设计样例。${leaderboardSnapshot.version} · 无真实数据。</p>`;}
function leaderboardOpenChange(name){
 const row=leaderboardRows().find(r=>r.name===name);if(!row)return false;const c=leaderboardChange(row);
 openDialog(name+' · 名次变化依据',`<p>${esc(leaderboardCondition())} · ${leaderboardSnapshot.version}</p><div class="lb-proof"><div><span>昨日末 · 10-05</span><strong>${c.old?'第 '+c.old.rank+' 名':'无可比名次'}</strong></div><span aria-hidden="true">→</span><div><span>当前 · 10-06 10:30</span><strong>${row.rank==null?'暂不可比':'第 '+row.rank+' 名'}</strong></div></div><p><strong>${c.label}</strong> · ${c.reason}</p>${c.old?`<p>昨日公开首充样例 ${c.old.value} 人，当前 ${leaderboardValue(row.value)} 人。名次变动 = ${c.old.rank} − ${row.rank} = ${c.delta}；昨日名次是固定快照字段，未按今天搜索结果重算。</p>`:''}<p class="note">昨日名次仅为明确设计的对比样例；陈子航没有昨日名次证据，李思琪有新增资格样例。数据不是当前真实经营结果。</p>`);return true;
}
function leaderboardOpenSummary(name){
 const row=leaderboardRows().find(r=>r.name===name);if(!row)return false;const s=leaderboardState,m=leaderboardMetrics[s.metric];
 const source=s.metric==='first'?(name==='Mia'?'充值来源 8 人 · 购机来源 4 人':'来源拆分样例未提供，不由组总量反推个人') :s.metric==='size'?'按当前有效绑定去重，不随月份变化':`已知${s.metric==='recharge'?'成功充值':'购机实付'} ${leaderboardAmount(row.success)}${row.success==null?'':' '+s.coin} · 退款/撤销额未提供 · 有效额未知`;
 openDialog(name+' · 公开成绩',`<div class="lb-public-person">${leaderboardAvatar(row,true)}<div><h2>${esc(name)}</h2><p>${esc(groups.find(g=>g.id===row.group)?.name||'待分组')} · 当前组</p></div></div><p>${esc(leaderboardCondition())} · ${leaderboardSnapshot.version}</p><div class="lb-public-value"><span>${m.label}${m.money?' / '+s.coin:''}</span><strong>${leaderboardValue(row.value)}${row.value!=null&&!m.money?' 人':''}</strong><span>${row.rank==null?'暂不可排名':'本范围第 '+row.rank+' 名'}</span></div><p>${source}</p><p>${s.metric==='first'?'每客全历史仅一次首次合格付款，含充值或实际付费购机；真实退款不抹去首次付款历史。':s.metric==='size'?'这是当前服务资产，不代表新增贡献或服务质量。':'有效额 = 合格成功原单金额 − 同原单已成功退款/撤销。退款覆盖未提供，不以成功额代替净额；提现、内部转账、购机消费不当作充值退款。'}</p><p class="note">截至 ${leaderboardSnapshot.at} · ${leaderboardSnapshot.zone}。只展示当前所选单项公开汇总，未加载客户、订单或会话。原经营页面的抽样明细无法证明本榜全量，故此处不设置明细捷径。</p>`);return true;
}
function leaderboardRenderFocus(id){render();if(id)document.getElementById(id)?.focus({preventScroll:true});}
function leaderboardLocate(){
 if(role!=='agent'||viewState!=='default')return false;
 const rows=leaderboardRows(),index=rows.findIndex(r=>r.name==='Mia');if(index<0)return false;
 leaderboardState.query='';leaderboardState.page=Math.floor(index/leaderboardSnapshot.pageSize)+1;leaderboardState.located=true;render();
 const row=document.getElementById('lb-row-'+staff.findIndex(r=>r[0]==='Mia'));row?.scrollIntoView({block:'center',behavior:'auto'});row?.focus({preventScroll:true});announce('已定位 Mia；清除搜索并跳转至本人所在页，排名未改变。');return true;
}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button||button.disabled)return;
 if(button.dataset.lbTab){const next=button.dataset.lbTab;if(!leaderboardMetrics[next])return;leaderboardState.metric=next;leaderboardState.page=1;leaderboardState.located=false;leaderboardRenderFocus('lbTab-'+next);}
 else if(button.hasAttribute('data-lb-locate'))leaderboardLocate();
 else if(button.dataset.lbSummary)leaderboardOpenSummary(button.dataset.lbSummary);
 else if(button.dataset.lbChange)leaderboardOpenChange(button.dataset.lbChange);
 else if(button.dataset.lbPage){const next=Number(button.dataset.lbPage),q=leaderboardState.query.trim().toLocaleLowerCase(),total=leaderboardRows().filter(r=>r.name.toLocaleLowerCase().includes(q)).length;if(!Number.isInteger(next)||next<1||next>Math.max(1,Math.ceil(total/leaderboardSnapshot.pageSize)))return;leaderboardState.page=next;leaderboardState.located=false;leaderboardRenderFocus(next===1?'lbNext':'lbPrev');}
 else if(button.hasAttribute('data-lb-clear')){leaderboardState.query='';leaderboardState.page=1;leaderboardRenderFocus('lbSearch');}
 else if(button.hasAttribute('data-lb-rules'))openDialog('排名与比较说明',leaderboardRulesHTML());
 else if(button.hasAttribute('data-lb-retry')){viewState='default';const control=document.getElementById('viewState');if(control)control.value='default';leaderboardRenderFocus('lbTab-'+leaderboardState.metric);announce('已重新读取固定设计样例，筛选保持不变，未请求真实数据。');}
 else if(button.hasAttribute('data-lb-refresh')){leaderboardRenderFocus('lbRefresh');announce('已重读同一固定样例：截至 2026-10-06 10:30。没有请求真实数据，也没有更新时间。');}
});
document.addEventListener('change',event=>{
 const target=event.target;if(!['lbMonth','lbCoin','lbScope'].includes(target.id))return;
 if(target.id==='lbScope'){if(!leaderboardSelectScope(target.value))return;}
 else if(target.id==='lbMonth'){if(!['2026-10','2026-09'].includes(target.value))return;leaderboardState.month=target.value;}
 else {if(!['USDT','NEX'].includes(target.value))return;leaderboardState.coin=target.value;}
 leaderboardState.page=1;leaderboardState.located=false;leaderboardRenderFocus(target.id);
});
function leaderboardSearch(input){const position=input.selectionStart;leaderboardState.query=input.value;leaderboardState.page=1;leaderboardState.located=false;leaderboardRenderFocus('lbSearch');document.getElementById('lbSearch')?.setSelectionRange(position,position);}
document.addEventListener('input',event=>{if(event.target.id!=='lbSearch'||leaderboardComposing||event.isComposing)return;leaderboardSearch(event.target);});
document.addEventListener('compositionstart',event=>{if(event.target.id==='lbSearch')leaderboardComposing=true;});
document.addEventListener('compositionend',event=>{if(event.target.id!=='lbSearch')return;leaderboardComposing=false;leaderboardSearch(event.target);});
document.addEventListener('keydown',event=>{const key=event.target.dataset.lbTab;if(!key||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const keys=Object.keys(leaderboardMetrics),index=keys.indexOf(key),next=event.key==='Home'?keys[0]:event.key==='End'?keys.at(-1):keys[(index+(event.key==='ArrowRight'?1:keys.length-1))%keys.length];leaderboardState.metric=next;leaderboardState.page=1;leaderboardState.located=false;leaderboardRenderFocus('lbTab-'+next);});
