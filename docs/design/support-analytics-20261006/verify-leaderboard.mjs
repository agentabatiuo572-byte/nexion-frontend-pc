import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('./leaderboard.js',import.meta.url),'utf8');
const html=readFileSync(new URL('./prototype.html',import.meta.url),'utf8');
const css=readFileSync(new URL('./leaderboard.css',import.meta.url),'utf8');
const listeners=new Map(),elements=new Map();
const element=id=>{if(!elements.has(id))elements.set(id,{id,value:'',focus(){this.focused=true;},scrollIntoView(){this.scrolled=true;},setSelectionRange(){}});return elements.get(id);};
const context=vm.createContext({document:{addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},getElementById:element},Intl});
const run=code=>vm.runInContext(code,context);
// This must execute before the host's lexical const/let globals exist.
run(script);
run(`${html.match(/const groups=\[[\s\S]*?\];/)[0]}\n${html.match(/const staff=\[[\s\S]*?\];/)[0]}
 let role='agent',supervisorName='林思远',viewState='default';
 const visibleGroups=()=>role==='admin'?groups:role==='supervisor'?groups.filter(g=>g.supervisor===supervisorName):groups.filter(g=>g.id==='star');
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const avatar=c=>'<span class="avatar" data-name="'+esc(c.name)+'"></span>';
 let rendered='',dialog='',announcement='';
 function render(){rendered=leaderboardHTML();}
 function openDialog(title,body){dialog=title+' '+body;}
 function announce(message){announcement=message;}
`);
let passed=0;
function check(name,fn){fn();passed++;console.log('PASS '+name);}
function reset(){run("role='agent';supervisorName='林思远';viewState='default';Object.assign(leaderboardState,{metric:'first',month:'2026-10',coin:'USDT',scope:'all',query:'',page:1,located:false});");}
const plain=value=>JSON.parse(JSON.stringify(value));

check('competition ranking uses all exact values, preserves ties and unknowns',()=>{
 assert.deepEqual(plain(run("leaderboardRank([{name:'A',value:20n},{name:'B',value:12n},{name:'C',value:12n},{name:'D',value:9n},{name:'unknown',value:null}]).map(r=>r.rank)")),[1,2,2,4,null]);
 assert.deepEqual(plain(run("leaderboardRank([{value:0n},{value:0n}]).map(r=>r.rank)")),[1,1]);
 assert.equal(run("leaderboardRank([{name:'lower',value:9007199254740992n},{name:'higher',value:9007199254740993n}])[0].name"),'higher');
});
check('minor-unit arithmetic does not round, conceal refunds or invent zero',()=>{
 assert.equal(run('leaderboardNet(100000001n,40000000n,true)'),60000001n);
 assert.equal(run('leaderboardAmount(60000001n)'),'60.000001');
 assert.equal(run('leaderboardNet(100n,101n,true)'),null);
 assert.equal(run('leaderboardNet(100n,0n,false)'),null);
 assert.equal(run('leaderboardNet(100n,null,true)'),null);
 assert.equal(run('leaderboardNet(100n,100n,true)'),0n);
});
check('current staff is the source, tied third place shares honors',()=>{
 reset();assert.equal(run("leaderboardRows().find(r=>r.name==='张晓雨').value"),12n);
 assert.equal(run("leaderboardRows().find(r=>r.name==='Mia').rank"),3);
 assert.equal(run("leaderboardGap(leaderboardRows().find(r=>r.name==='Mia'),leaderboardRows())"),6n);
 assert.equal(run("leaderboardHonor(3)"),'bronze');assert.equal(run("leaderboardHonor(4)"),'');
 assert.equal((run('leaderboardTableHTML(leaderboardRows())').match(/class="lb-avatar lb-honor lb-bronze/g)||[]).length,2);
});
check('public filters do not allow arbitrary external-group slices',()=>{
 reset();assert.deepEqual(plain(run('leaderboardScopes().map(g=>g.id)')),['all','star']);
 assert.equal(run("leaderboardSelectScope('ocean')"),false);
 assert.equal(run("leaderboardSelectScope('star')"),true);
 assert.deepEqual(plain(run('leaderboardRows().map(r=>r.rank)')),[1,1]);
 run("role='supervisor';supervisorName='林思远'");assert.deepEqual(plain(run('leaderboardScopes().map(g=>g.id)')),['all','star','dawn']);
 assert.equal(run("leaderboardSelectScope('ocean')"),false);
 run("supervisorName='许安';leaderboardHTML()");assert.equal(run('leaderboardState.scope'),'all');
 assert.deepEqual(plain(run('leaderboardScopes().map(g=>g.id)')),['all','ocean']);
 run("role='admin'");assert.deepEqual(plain(run('leaderboardScopes().map(g=>g.id)')),['all','star','dawn','ocean']);
});
check('search locates the existing rank; no-result is not a zero score',()=>{
 reset();run("leaderboardState.query='陈子航'");const result=run('leaderboardTableHTML(leaderboardRows())');
 assert.match(result,/>07<\/span>/);assert.doesNotMatch(result,/>01<\/span>/);
 run("leaderboardState.query='<no-result>'");assert.match(run('leaderboardHTML()'),/搜索只定位，不改原榜名次/);
 assert.match(run('leaderboardHTML()'),/&lt;no-result&gt;/);
});
check('locating Mia crosses pages and returns keyboard focus',()=>{
 reset();run("leaderboardState.metric='size';leaderboardState.query='张';leaderboardLocate()");
 assert.equal(run('leaderboardState.page'),2);assert.equal(run('leaderboardState.query'),'');
 assert.equal(element('lb-row-4').focused,true);assert.equal(element('lb-row-4').scrolled,true);
 assert.match(run('rendered'),/lb-located/);assert.match(run('announcement'),/排名未改变/);
});
check('all daily movement categories have fixed baseline evidence',()=>{
 reset();assert.deepEqual(plain(run("['周芷宁','杨帆','张晓雨','李思琪','陈子航'].map(name=>leaderboardChange(leaderboardRows().find(r=>r.name===name)).type)")),['up','down','same','new','unknown']);
 assert.equal(run("leaderboardChange(leaderboardRows().find(r=>r.name==='Mia')).delta"),2);
 run("leaderboardOpenChange('Mia')");assert.match(run('dialog'),/5 − 3 = 2/);
 run("leaderboardSelectScope('star')");assert.equal(run("leaderboardChange(leaderboardRows()[0]).type"),'unknown');
 reset();run("staff[0][7]='dawn'");assert.equal(run("leaderboardChange(leaderboardRows()[0]).type"),'up');run("staff[0][7]='star'");
 run("leaderboardState.month='2026-09'");assert.equal(run("leaderboardChange(leaderboardRows()[0]).type"),'hidden');
});
check('four states retain active tabs and filters without stale rows',()=>{
 for(const state of ['default','empty','loading','error']){reset();run(`viewState='${state}';leaderboardState.scope='star';leaderboardState.metric='recharge'`);const output=run('leaderboardHTML()');
  assert.match(output,/id="lbTab-recharge"[^>]*aria-selected="true"/);assert.match(output,/<option value="star" selected>/);assert.match(output,/id="lbCoin"/);
  if(state!=='default'){assert.doesNotMatch(output,/class="lb-table"/);assert.doesNotMatch(output,/class="lb-mine"/);}
 }
});
check('currency, month and no-qualification guards stay truthful',()=>{
 reset();run("leaderboardState.coin='NEX'");assert.equal(run("leaderboardRows().find(r=>r.name==='Mia').value"),12n);assert.doesNotMatch(run('leaderboardHTML()'),/id="lbCoin"/);
 run("leaderboardState.metric='recharge'");assert.match(run('leaderboardHTML()'),/NEX 样例未提供/);assert.equal(run('leaderboardRows()[0].value'),null);
 run("leaderboardState.coin='USDT';leaderboardState.month='2026-09'");assert.match(run('leaderboardHTML()'),/上月样例未提供/);
 run("leaderboardState.metric='size'");assert.doesNotMatch(run('leaderboardHTML()'),/id="lbMonth"|id="lbCoin"/);assert.equal(run("leaderboardRows().find(r=>r.name==='Mia').value"),120n);
 for(const who of ['supervisor','admin']){run(`role='${who}'`);assert.doesNotMatch(run('leaderboardHTML()'),/class="lb-mine"|data-lb-locate/);assert.match(run('leaderboardHTML()'),/未兼任专属客服/);}
});
check('single-metric public summaries do not fabricate effective money or detail access',()=>{
 reset();run("leaderboardState.metric='recharge';leaderboardOpenSummary('Mia')");const summary=run('dialog');
 assert.match(summary,/24,000 USDT/);assert.match(summary,/有效额未知/);assert.doesNotMatch(summary,/8,600|data-action=|客户ID|U-\d|EV-DEMO/);
 assert.equal(run('leaderboardRows().filter(r=>r.rank!=null).length'),0);
 run("leaderboardState.metric='purchase';leaderboardOpenSummary('Mia')");assert.match(run('dialog'),/8,600 USDT/);
 assert.equal(run("leaderboardSampleRows().find(r=>r.name==='张晓雨').success"),null);
 assert.equal(run("leaderboardOpenSummary('not-a-staff')"),false);
});
check('refresh and retry reuse fixed data and keyboard events remain scoped',()=>{
 reset();const button={dataset:{},disabled:false,hasAttribute:key=>key==='data-lb-refresh'};
 for(const listener of listeners.get('click'))listener({target:{closest:()=>button}});
 assert.match(run('announcement'),/没有请求真实数据，也没有更新时间/);
 assert.equal(run('leaderboardSnapshot.at'),'2026-10-06 10:30');
 let prevented=false;for(const listener of listeners.get('keydown'))listener({target:{dataset:{}},key:'Enter',preventDefault(){prevented=true;}});assert.equal(prevented,false);
 assert.doesNotMatch(script,/fetch\s*\(|XMLHttpRequest|setInterval\s*\(|setTimeout\s*\(|localStorage|\bcustomers\b|\bdemoEvents\b/);
 assert.match(css,/min-width:1000px/);assert.match(css,/prefers-reduced-motion:reduce/);
 assert.equal(element('lbRefresh').focused,true);assert.match(run('leaderboardHTML()'),/id="lbRefresh"/);
});
check('Chinese composition keeps its input until text is committed',()=>{
 reset();run("rendered='composition-must-not-replace'");const input={id:'lbSearch',value:'周',selectionStart:1};
 for(const listener of listeners.get('compositionstart'))listener({target:input});
 for(const listener of listeners.get('input'))listener({target:input,isComposing:true});
 assert.equal(run('rendered'),'composition-must-not-replace');assert.equal(run('leaderboardState.query'),'');
 for(const listener of listeners.get('compositionend'))listener({target:input});
 assert.equal(run('leaderboardState.query'),'周');assert.match(run('rendered'),/value="周"/);
});
check('refined layout has one compact personal summary and accurate tied ranks',()=>{
 reset();const my=run('leaderboardMyHTML(leaderboardRows())'),table=run('leaderboardTableHTML(leaderboardRows())');
 assert.match(my,/Mia <span>我的表现<\/span>/);assert.match(my,/并列第 3 名/);assert.doesNotMatch(my,/我的名次/);
 assert.equal((my.match(/class="lb-my-stat/g)||[]).length,3);assert.match(my,/较昨日末/);assert.match(my,/距上一档/);
 assert.equal((table.match(/class="lb-rank-label">并列第 3 名/g)||[]).length,2);
 run("leaderboardSelectScope('star')");assert.match(run('leaderboardMyHTML(leaderboardRows())'),/并列第 1 名 · 本范围/);
 assert.equal((run('leaderboardTableHTML(leaderboardRows())').match(/class="lb-avatar lb-honor lb-gold/g)||[]).length,2);
});
check('small honor rings work in dialogs and large decorations cannot return',()=>{
 assert.match(css,/:root\{[^}]*--lb-gold:[^}]*--lb-silver:[^}]*--lb-bronze:/);
 assert.match(css,/\.lb-avatar>\.avatar\{[^}]*width:48px;height:48px/);
 assert.match(css,/\.lb-crown\{[^}]*width:18px;height:13px/);
 assert.match(css,/\.lb-honor\{[^}]*border-color:var\(--lb-metal\);[^}]*inset 0 0 0 2px/);
 assert.doesNotMatch(css,/gradient\(|clip-path:|lb-rank-art|lb-top-gold \.lb-avatar|lb-top-gold \.lb-crown/);
 assert.doesNotMatch(script,/leaderboardRankArt|lb-rank-art|<text\b/);
 assert.match(css,/\.lb-table td\{height:88px/);assert.match(css,/\.lb-table \.lb-top-gold td\{height:104px/);
 reset();run("leaderboardOpenSummary('Mia')");assert.match(run('dialog'),/lb-honor lb-bronze/);
});
check('typography remains readable with a restrained 36px heading',()=>{
 const sizes=new Map([...`${html}\n${css}`.matchAll(/(--[\w-]+):\s*(\d+(?:\.\d+)?)px/g)].map(([,name,value])=>[name,Number(value)]));
 assert.equal(sizes.get('--lb-title-size'),36);
 for(const [,value] of css.matchAll(/font-size:([^;}]+)/g)){
  const token=value.match(/^var\((--[\w-]+)\)$/)?.[1],size=token?sizes.get(token):Number.parseFloat(value);
  assert.ok(Number.isFinite(size)&&size>=12.5,`Readable explicit type size: ${value}`);
 }
 for(const [,weight] of css.matchAll(/font-weight:(\d+)/g))assert.ok(Number(weight)<=600);
 assert.doesNotMatch(css,/\.lb-gap\{display:none/);
});
console.log(`Leaderboard checks: ${passed} passed; browser layout still requires live inspection.`);
