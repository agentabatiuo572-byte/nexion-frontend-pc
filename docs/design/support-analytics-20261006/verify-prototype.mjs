// Dependency-free checks for the design prototype; browser layout is verified separately.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./prototype.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
assert.ok(script, 'Prototype has a script');
const elements = new Map();
const element = selector => {
  if (!elements.has(selector)) elements.set(selector, {
    innerHTML: '', textContent: '', value: '', open: false, disabled: false,
    isConnected: true, scrollTop: 0, scrollHeight: 200, style: {},
    getBoundingClientRect() { return this.rect || { top: 500, bottom: 200 }; },
    classList: { toggle() {} }, listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, focus() {},
    showModal() { this.open = true; }, close() { this.open = false; for (const listener of this.listeners.close || []) listener(); },
    insertAdjacentHTML(_position, text) { this.innerHTML += text; }
  });
  return elements.get(selector);
};
const localStore = new Map();
const documentEvents = new Map();
const context = vm.createContext({ localStorage: {
  getItem: key => localStore.get(key) ?? null,
  setItem: (key, value) => localStore.set(key, value)
}, document: {
  querySelector: element, querySelectorAll: () => [], addEventListener(type, listener) {
    if (!documentEvents.has(type)) documentEvents.set(type, []);
    documentEvents.get(type).push(listener);
  },
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
run("role='agent'; selected='林海'; modalCustomer=null; page='sessions'; currency='USDT'; render()");
run('closeDialog()');
element('#composer').rect = { top: 515 };
element('.chat-head').rect = { bottom: 210 };
run("openComposerTool('templates')");
assert.equal(element('#composerPopover').hidden, false);
assert.equal(element('#composerPopover').style.maxHeight, '291px', 'Tool list fits below the actual chat header');
assert.equal(element('#detailDialog').open, false, 'Composer tool opens without a page-blocking modal');
assert.match(element('#composerToolList').innerHTML, /R01/);
run("renderComposerToolList('不存在的话术')");
assert.match(element('#composerToolList').innerHTML, /没有匹配内容/);
element('#messageInput').value = '已有草稿';
run("chooseComposerTool('R01')");
assert.match(element('#messageInput').value, /^已有草稿\n已收到/);
assert.equal(run("messages.get('林海').length"), 1, 'Choosing a reply does not send');
run("openComposerTool('products'); chooseComposerTool('AIR-DEMO')");
assert.match(element('#pendingProduct').innerHTML, /待发送商品/);
assert.equal(run("pendingProducts.get(composeKey())"), 'AIR-DEMO');
run("selected='小雨儿'; renderPendingProduct()");
assert.equal(element('#pendingProduct').hidden, true, 'Pending product stays in its own customer conversation');
run("selected='林海'; openComposerTool('products'); chooseComposerTool('PRO-DEMO')");
assert.equal(run("pendingProducts.get(composeKey())"), 'AIR-DEMO', 'Unavailable product cannot replace the pending item');
run("role='supervisor'; openComposerTool('templates')");
assert.match(element('#composerToolList').innerHTML, /disabled/);
const beforeReadonly = element('#messageInput').value;
run("chooseComposerTool('R02')");
assert.equal(element('#messageInput').value, beforeReadonly);
run("role='agent'; selected='林海'; messages.set(selected,[]); pendingProducts.clear(); closeComposerTool(); sendScenario='unknown'");
for (const kind of ['templates', 'products']) {
  run(`openComposerTool('${kind}')`);
  element('#messageInput').value = '搜索期间应保留的草稿';
  let prevented = false;
  for (const listener of documentEvents.get('submit')) listener({ target: { id: 'composer' }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(run('messages.get(selected).length'), 0, kind + ' search implicit submit never sends');
  assert.equal(element('#messageInput').value, '搜索期间应保留的草稿');
}
assert.match(run('sessionsHTML()'), /id="sendMessage" type="button" data-action="sendLocal"/);
element('#messageInput').value = '<img onerror=alert(1)>';
run('sendMessage()');
assert.match(element('#chatScroll').innerHTML, /&lt;img onerror=alert\(1\)&gt;/);
assert.match(run('threadHTML(current())'), /发送结果未知/);
assert.equal(run("messages.get(selected)[0].read"), null, 'Unconfirmed send has no unread claim');
const unknownId = run('messages.get(selected)[0].id');
run(`changeMessageState('${unknownId}','retry')`);
assert.equal(run('messages.get(selected)[0].attempts'), 1, 'Unknown send cannot retry');
run(`sendScenario='unread'; changeMessageState('${unknownId}','query')`);
assert.equal(run('messages.get(selected)[0].state'), 'sent');
assert.equal(run('messages.get(selected)[0].read'), false);
assert.equal(run('messages.get(selected).length'), 1);
run(`changeMessageState('${unknownId}','read')`);
assert.equal(run('messages.get(selected)[0].read'), true);
element('#messageInput').value = '失败重试';
run("sendScenario='failed'; sendMessage()");
const failedId = run('messages.get(selected)[1].id');
run(`sendScenario='unread'; changeMessageState('${failedId}','retry')`);
assert.equal(run('messages.get(selected).length'), 2);
assert.equal(run('messages.get(selected)[1].id'), failedId);
assert.equal(run('messages.get(selected)[1].attempts'), 2);
assert.equal(run('messages.get(selected)[1].state'), 'sent');
run("pendingProducts.set(composeKey(),'AIR-DEMO'); productCatalog[0].available=false");
element('#messageInput').value = '下架时保留草稿';
run('sendMessage()');
assert.equal(run('messages.get(selected).length'), 2);
assert.equal(element('#messageInput').value, '下架时保留草稿');
assert.equal(run('pendingProducts.get(composeKey())'), 'AIR-DEMO');
assert.match(element('#composerNote').textContent, /下架/);
run("productCatalog[0].available=true; sendScenario='failed'; sendMessage()");
const failedProductId = run('messages.get(selected)[2].id');
run(`productCatalog[0].available=false; changeMessageState('${failedProductId}','retry')`);
assert.equal(run('messages.get(selected)[2].state'), 'failed');
assert.equal(run('messages.get(selected)[2].attempts'), 1);
assert.equal(run('messages.get(selected).length'), 3);
run('productCatalog[0].available=true');
run("role='admin'; openTimeout()");
assert.match(element('#dialogBody').innerHTML, /新会话段/);
assert.match(element('#dialogBody').innerHTML, /失败或结果未知/);
for (const [remind, end, reason] of [['0','5','阈值调整演示'],['1','1','阈值调整演示'],['31','60','阈值调整演示'],['1','121','阈值调整演示'],['1.5','5','阈值调整演示'],['','5','阈值调整演示'],['1','5','不足']]) {
  element('#timeoutRemind').value = remind;
  element('#timeoutEnd').value = end;
  element('#timeoutReason').value = reason;
  run('previewTimeout()');
  assert.match(element('#timeoutError').textContent, /整数/);
}
element('#timeoutRemind').value = '2'; element('#timeoutEnd').value = '8'; element('#timeoutReason').value = '调整本地演示阈值';
run('previewTimeout()');
assert.match(element('#dialogBody').innerHTML, /原值[\s\S]*1分钟提醒[\s\S]*新值[\s\S]*2分钟提醒/);
run('openTimeout()');
assert.match(element('#dialogBody').innerHTML, /id="timeoutRemind"[^>]+value="2"/);
assert.match(element('#dialogBody').innerHTML, /id="timeoutEnd"[^>]+value="8"/);
assert.match(element('#dialogBody').innerHTML, /调整本地演示阈值<\/textarea>/);
run('previewTimeout()');
element('#timeoutConfirm').checked = false; run('saveTimeout()');
assert.equal(localStore.has('uvel-support-design-timeout-v1'), false);
element('#timeoutConfirm').checked = true; run('saveTimeout()');
assert.equal(run('loadTimeout().end'), 8, 'Timeout design survives a fresh storage load');
run("role='supervisor'; openTimeout()");
assert.match(element('#dialogBody').innerHTML, /id="timeoutRemind"[^>]+disabled/);
assert.doesNotMatch(element('#dialogBody').innerHTML, /id="timeoutReason"/);
run('closeDialog()');
assert.equal(run('timeoutDraft'), null, 'Closing the strategy dialog cancels its edit draft');
assert.equal(run('customers.every(c=>Boolean(avatarFile(c)))'), true);
assert.equal(run('staff.every(r=>Boolean(avatarFile({name:r[0]})))'), true);
for (const file of JSON.parse(run('JSON.stringify(allAvatarFiles)'))) assert.ok(existsSync(new URL('./assets/avatars/' + file, import.meta.url)));
assert.match(run("avatar({name:'Mia'})"), /women-39.jpg/);
assert.match(run("avatar({name:'林海'})"), /men-75.jpg/);
assert.match(run("avatar({name:'林海'})"), /avatar-fallback[^>]*>林/);
const brokenPhoto = { tagName: 'IMG', hidden: false, closest() { return { setAttribute() {} }; } };
for (const listener of documentEvents.get('error')) listener({ target: brokenPhoto });
assert.equal(brokenPhoto.hidden, true, 'Broken photo reveals the stable text fallback');
assert.equal(run("Array.from({length:50},()=>randomAvatar('male')).every(file=>avatarPools.male.includes(file))"), true);
assert.equal(run("Array.from({length:50},()=>randomAvatar('female')).every(file=>avatarPools.female.includes(file))"), true);
run("role='admin'; openStaffForm()");
assert.match(element('#dialogBody').innerHTML, /aria-label="选择男头像 1"/);
assert.doesNotMatch(element('#dialogBody').innerHTML, /aria-label="[^"]*\.jpg/);
element('#staffSampleName').value = '演示客服'; element('#staffSampleGender').value = 'female';
run("staffDraft.avatar='women-7.jpg'; saveStaffSample()");
assert.equal(run('loadDesignAccounts().items.length'), 1);
assert.equal(run("loadDesignAccounts().items[0].avatar"), 'women-7.jpg');
assert.equal(run('groupTotals(groups).members'), 24, 'Local account examples never change operational totals');
run("openStaffForm(designAccounts.items[0].id)");
assert.equal(run('staffDraft.manual'), true, 'Saved avatar is not rerandomized when editing gender');
run("role='supervisor'; openStaffAccounts()");
assert.equal(element('#dialogTitle').textContent, '无客服账号管理权限');
const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
const allowedFontSizes = new Set([0, 10, 10.5, 11, 11.5, 12, 12.5, 13.5, 14, 15, 18, 20, 26, 28, 30, 48]);
const typeScale = new Map([...css.matchAll(/(--type-[\w-]+):([\d.]+)px/g)].map(match => [match[1], Number(match[2])]));
assert.ok(typeScale.size >= 10, 'Typography uses a shared semantic size scale');
for (const [name, size] of typeScale) assert.ok(allowedFontSizes.has(size), name + ' uses an approved size');
for (const declaration of html.matchAll(/font-size\s*:\s*([^;}"\n]+)/g)) {
  const value = declaration[1].trim();
  const variable = value.match(/^var\((--type-[\w-]+)\)$/)?.[1];
  const size = variable ? typeScale.get(variable) : Number(value.replace(/px$/, ''));
  assert.ok(allowedFontSizes.has(size), 'Unapproved font size: ' + value);
  if (size === 0) assert.match(css, /\.control-label\{font-size:0\}/, 'Zero size is reserved for the narrow hidden label');
}
for (const match of html.matchAll(/font-weight\s*:\s*([^;}"\n]+)/g)) {
  assert.ok(/^\d+$/.test(match[1]) && Number(match[1]) >= 100 && Number(match[1]) <= 600, 'All explicit weights are at most 600');
}
assert.match(css, /h1,h2,h3\{font-weight:600\}/, 'Every native heading overrides the browser default bold weight');
assert.match(css, /--font-display:"Manrope",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif/);
assert.match(css, /font-family:var\(--font-v5\)/);
assert.match(css, /button\{font-size:var\(--type-control\);font-weight:500/);
assert.match(css, /\.metric-value,[^}]+font-variant-numeric:tabular-nums/);
assert.doesNotMatch(css, /font-family:[^;}]*monospace/);
assert.match(css, /input::placeholder,textarea::placeholder\{color:var\(--v5-ink3\);opacity:1\}/);
console.log('PASS: role/currency isolation, metric drills, composer popover bounds, draft/product isolation, delivery/read states, same-ID retry, unknown query, timeout validation/local persistence, explicit photo mappings/account sample persistence, no real API calls.');
