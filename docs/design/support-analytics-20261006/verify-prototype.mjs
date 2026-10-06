// Dependency-free checks for the design prototype; browser layout is verified separately.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./prototype.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
assert.ok(script, 'Prototype has a script');
const elements = new Map();
const element = selector => {
  if (!elements.has(selector)) elements.set(selector, {
    innerHTML: '', textContent: '', value: '', open: false, disabled: false,
    isConnected: true, scrollTop: 0, scrollHeight: 200,
    classList: { toggle() {} }, addEventListener() {}, focus() {},
    showModal() { this.open = true; }, close() { this.open = false; },
    insertAdjacentHTML(_position, text) { this.innerHTML += text; }
  });
  return elements.get(selector);
};
const context = vm.createContext({ document: {
  querySelector: element, querySelectorAll: () => [], addEventListener() {},
  activeElement: element('opener')
} });
vm.runInContext(script, context);
const run = source => vm.runInContext(source, context);
assert.match(element('#app').innerHTML, /我的工作台/);
run("role='supervisor'; render()");
assert.match(element('#app').innerHTML, /客服管理台/);
assert.doesNotMatch(element('#app').innerHTML, /P90/);
run("role='admin'; render()");
assert.match(element('#app').innerHTML, /8,420/);
assert.match(element('#app').innerHTML, /286,000/);
run("currency='NEX'; render()");
assert.match(element('#app').innerHTML, /NEX 演示数据暂未提供/);
assert.doesNotMatch(element('#app').innerHTML, /286,000/);
run("currency='USDT'; page='sessions'; role='supervisor'; render()");
assert.match(element('#app').innerHTML, /审阅模式/);
assert.match(element('#app').innerHTML, /id="sendMessage"[^>]+disabled/);
run("selected='陈默'; openAction('first')");
assert.match(element('#dialogBody').innerHTML, /累计购机<\/span><span>未采集/);
assert.doesNotMatch(element('#dialogBody').innerHTML, /2,400/);
run("selected='小雨儿'; openAction('first')");
assert.match(element('#dialogBody').innerHTML, /100.00 USDT/);
run("openAction('tickets')");
assert.match(element('#dialogBody').innerHTML, /0张/);
assert.doesNotMatch(element('#dialogBody').innerHTML, /TK-DEMO-0928/);
run("openAction('historicalThread','CS-DEMO-0921')");
assert.match(element('#dialogBody').innerHTML, /Chen · 历史顾问/);
assert.doesNotMatch(element('#dialogBody').innerHTML, /Mia · 专属顾问/);
run("role='agent'; selected='林海'; page='sessions'; render()");
element('#messageInput').value = '林海独立草稿';
run("navigate('sessions','小雨儿')");
assert.equal(element('#detailDialog').open, false, 'Conversation navigation closes the old dialog');
assert.equal(run("drafts.get('agent:林海')"), '林海独立草稿');
assert.equal(element('#messageInput').value, '', 'Other customer does not inherit a draft');
run("messages.set('林海',[{text:'local example',time:'10:31'}]); selected='林海'");
assert.doesNotMatch(run('threadHTML(current())'), /new-message/, 'Returning to history does not replay message entry');
assert.match(run("messageHTML(current(),'new',true,'10:31',true)"), /new-message/, 'Only newly inserted messages animate');
assert.match(run('clientsHTML()'), /<option value="yes"/, 'Confirmed-first-payment filter is a valid option');
assert.match(run('clientsHTML()'), /服务原因 \/ 当前归属/);
run("selected='陈默'");
assert.doesNotMatch(run('threadHTML(current())'), /DG20260928001/, 'A second customer does not inherit the first customer order');
run("openAction('funds')");
assert.doesNotMatch(element('#dialogBody').innerHTML, /DP-DEMO-1006/, 'Zero-recharge customer does not inherit another customer recharge');
run("openAction('devices')");
assert.match(element('#dialogBody').innerHTML, /未采集/);
assert.doesNotMatch(element('#dialogBody').innerHTML, /2 台 UVEL Air/);
run("role='supervisor'");
assert.equal(run('visibleGroups().length'), 2);
assert.equal(run('visibleStaff().length'), 5);
assert.equal(run("visibleCustomers().some(c=>c.name==='顾明')"), false);
assert.doesNotMatch(run('loadTable()'), /周芷宁|杨帆/);
assert.equal(run('visibleGroups().reduce((n,g)=>n+g.pool,0)'), 18);
run("role='admin'");
assert.equal(run('visibleGroups().length'), 3);
assert.equal(run("visibleCustomers().some(c=>c.name==='顾明')"), true);
assert.match(run('loadTable()'), /周芷宁/);
run("role='supervisor'; supervisorName='许安'; selectedGroup='all'; page='groups'; render()");
assert.equal(run('visibleGroups().length'), 1);
assert.match(element('#app').innerHTML, /海岚组/);
assert.doesNotMatch(element('#app').innerHTML, /星河组|晨光组|全局未路由<\/span>/);
assert.doesNotMatch(run('supervisorHome()'), /Mia|张晓雨|王浩然|林海/);
run("openAction('assign','海岚组')");
assert.doesNotMatch(element('#dialogBody').innerHTML, /Mia|张晓雨/);
run("openGroupDrill('recharge','ocean')");
assert.match(element('#dialogBody').innerHTML, /源业务号/);
assert.match(element('#dialogBody').innerHTML, /EV-DEMO-90523/);
assert.doesNotMatch(element('#dialogBody').innerHTML, /陈默|EV-DEMO-88421/);
run("openGroupDrill('firstPurchase','ocean')");
assert.match(element('#dialogBody').innerHTML, /首事件来源/);
assert.match(element('#dialogBody').innerHTML, /余额购机 \/ 成功/);
assert.match(element('#dialogBody').innerHTML, /200.00/);
run("openGroupDrill('gift','ocean')");
assert.match(element('#dialogBody').innerHTML, /<td>赠送<\/td>/);
assert.doesNotMatch(element('#dialogBody').innerHTML, /<td>正式购买<\/td>/);
run("openGroupDrill('offline','ocean')");
assert.match(element('#dialogBody').innerHTML, /<td>离线<\/td>/);
assert.doesNotMatch(element('#dialogBody').innerHTML, /<td>在网<\/td>/);
run("currency='NEX'; openGroupDrill('recharge','ocean')");
assert.match(element('#dialogBody').innerHTML, /没有提供事件样例/);
assert.doesNotMatch(element('#dialogBody').innerHTML, /EV-DEMO-90523/);
assert.match(run('groupsHTML()'), /data-kind="first"[^>]*>未提供/);
assert.match(run('groupSummaryTable(selectedGroups())'), /data-kind="first"[^>]*>未提供/);
assert.match(run('loadTable()'), /data-kind="first"[^>]*>未提供/);
run("currency='USDT'; role='supervisor'; supervisorName='许安'");
assert.doesNotMatch(run('clientsHTML()'), /Mia|张晓雨/);
run("openAction('outreachGroup')");
assert.doesNotMatch(element('#dialogBody').innerHTML, /林海|小雨儿|阿凯|U-88421/);
assert.match(element('#dialogBody').innerHTML, /顾明/);
run("openGroupDrill('unrouted','star')");
assert.equal(element('#dialogTitle').textContent, '无全局队列权限');
assert.doesNotMatch(element('#dialogBody').innerHTML, /样例1|50/);
run("role='agent'; supervisorName='林思远'; selected='林海'");
run("openEventSource('EV-DEMO-88422')");
assert.equal(element('#dialogTitle').textContent, '记录不可访问');
assert.doesNotMatch(element('#dialogBody').innerHTML, /安宁|张晓雨/);
assert.equal(run("canInspectSubject('star','安宁')"), false);
const personal = run('agentHome()');
assert.ok(personal.indexOf('<strong>陈默</strong>') < personal.indexOf('<strong>林海</strong>'));
assert.doesNotMatch(personal, /Sunny|126 分钟|72 分钟[\s\S]*72 分钟/);
assert.match(personal, /data-title="本月购机金额"/);
run("role='admin'; openCoverage('待分配')");
assert.match(element('#dialogBody').innerHTML, /组队列370/);
assert.doesNotMatch(element('#dialogBody').innerHTML, /U-88421/);
run("openAccounts('停用')");
assert.match(element('#dialogBody').innerHTML, /周凯/);
assert.match(element('#dialogBody').innerHTML, /孙怡/);
assert.doesNotMatch(element('#dialogBody').innerHTML, /Mia/);
run("currency='USDT'; role='admin'; selectedGroup='all'; page='home'; render()");
assert.equal(run('groupTotals(groups).customers'), 7960);
assert.equal(run('groupTotals(groups).pool+50'), 420);
assert.equal(run('groupTotals(groups).first+18+8'), 326);
assert.equal(run('groupTotals(groups).recharge+18000'), 286000);
assert.match(element('#app').innerHTML, /历史归属未知8/);
assert.match(element('#app').innerHTML, /未分配或历史组未知18,000/);
for (const count of ['326', '218', '108']) {
  assert.match(run('adminHome()'), new RegExp('data-action="drill"[^>]+>' + count + '<'));
}
run("role='supervisor'; supervisorName='林思远'; modalCustomer=null");
assert.match(run('supervisorHome()'), /待回复客户/);
assert.doesNotMatch(run('supervisorHome()'), /待回复会话/);
const attention = run('supervisorHome()').split('<h2>需要关注</h2>')[1];
const expectedWaiting = JSON.parse(run('JSON.stringify(visibleCustomers().filter(c=>c.wait>0).sort((a,b)=>b.wait-a.wait||a.uid.localeCompare(b.uid)).slice(0,3).map(c=>c.name))'));
assert.ok(expectedWaiting.every((name, index) => index === 0 || attention.indexOf(name) > attention.indexOf(expectedWaiting[index - 1])));
for (const call of ["openMetricDrill('待回复 · 等待最久优先')", "openGroupDrill('waiting','all')"]) {
  run(call);
  const body = element('#dialogBody').innerHTML;
  assert.match(body, /等待时长/);
  const minutes = [...body.matchAll(/<td>(\d+)分钟<\/td>/g)].map(match => Number(match[1]));
  assert.ok(minutes.length > 1 && minutes.every((value, index) => index === 0 || value <= minutes[index - 1]));
}
run("role='agent'; selected='林海'; modalCustomer=null; page='sessions'; render()");
element('#messageInput').value = '背景会话草稿';
run("openCustomerMetric('小雨儿','recharge')");
assert.equal(run('selected'), '林海', 'Opening a different subject does not change the background conversation');
assert.equal(run('detailCurrent().name'), '小雨儿');
assert.equal(element('#messageInput').value, '背景会话草稿');
assert.match(element('#dialogBody').innerHTML, /3,600/);
run("openCustomerMetric('陈默','team')");
assert.doesNotMatch(element('#dialogBody').innerHTML, /顾星|U-90523/);
run("role='admin'; openCustomerMetric('陈默','team')");
assert.match(element('#dialogBody').innerHTML, /顾星/);
run("role='supervisor'; supervisorName='许安'; modalCustomer=null");
for (const [name, agent] of [['顾明','周芷宁'], ['顾晓','周芷宁'], ['顾星','杨帆']]) {
  run(`openCustomerMetric('${name}','first')`);
  assert.match(element('#dialogBody').innerHTML, new RegExp('发生时顾问</span><span>' + agent));
  assert.match(element('#dialogBody').innerHTML, /data-action="eventSource" data-event="FIRST-DEMO-/);
}
run("openGroupDrill('balance','ocean')");
assert.match(element('#dialogBody').innerHTML, /data-action="groupCustomer"[^>]+data-section="funds"/);
assert.match(element('#dialogBody').innerHTML, /未提供完整账户快照/);
run("role='agent'; page='clients'; agentFilter='all'; clientTab='全部'; modalCustomer=null; render()");
for (const metric of ['direct', 'team', 'recharge', 'teamRecharge', 'first', 'activity']) {
  assert.match(element('#clientRows').innerHTML, new RegExp('data-metric="' + metric + '"'));
}
run("role='admin'; modalCustomer=null");
assert.match(run('rulesHTML()'), /按可信组路由进入组队列，由负责主管分配；没有可信组路由时由总管理员处理/);
assert.doesNotMatch(run('rulesHTML()'), /进入待分配池，由主管分配/);
assert.match(html, /--v5-bg:#0A0A0A/);
assert.match(html, /--surface:var\(--v5-surface\)/);
assert.doesNotMatch(html, /radial-gradient\(ellipse at 50% 30%/);
run("role='admin'; page='rules'; render()");
element('[name=inheritMode]:checked').value = 'LIMITED';
element('#inheritDepth').value = '0';
run('previewRules()');
assert.match(element('#dialogBody').innerHTML, /最多0代/);
for (const value of ['', '-1', '1.5']) {
  element('#inheritDepth').value = value;
  run('previewRules()');
  assert.match(element('#ruleError').textContent, /非负整数/);
}
assert.match(html, /prefers-reduced-motion/);
assert.doesNotMatch(script, /\b(?:fetch|XMLHttpRequest)\s*\(/);
console.log('PASS: role homes, supervisor isolation, scoped event/asset drills, currency boundaries, group reconciliation, v5 tokens, read-only sessions, consistent details, historical author, dialog navigation, draft isolation, non-negative depth, reduced motion, no real API calls.');
