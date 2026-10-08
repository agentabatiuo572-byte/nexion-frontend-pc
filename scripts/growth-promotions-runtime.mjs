import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import {capturePromotionPage,readBackendSource} from './growth-promotions-capture.mjs';
import {runTemplateCases,runRewardRecovery,runQualificationChange} from './growth-promotions-runtime-cases.mjs';
import {prepareRewardFailure} from './growth-promotions-runtime-fixture.mjs';

// Commands under test use rendered controls. Explicit scenario setup uses the authenticated isolated BFF.
// The external session file contains already MFA-verified isolated accounts; it is never logged.
const external=process.env.PROMOTION_EVIDENCE_DIR||'C:/Users/jason/.codex/workflow-runs/growth-promotions-20261007';
const base=process.env.PROMOTION_PC_URL||'http://127.0.0.1:3039';
assert.equal(new URL(base).port,'3039','Only the isolated PC service is authorized');
const sessions=JSON.parse(fs.readFileSync(path.join(external,'sessions-owned-v2.private.json'),'utf8'));
const source=JSON.parse(fs.readFileSync(path.join(external,'pc-source-fixture.json'),'utf8'));
const reportArg=process.argv.indexOf('--report');
const report=reportArg>=0?path.resolve(process.argv[reportArg+1]):path.join(external,'pc-runtime-browser.json');
const runId=randomUUID(),dir=path.join(external,'pc-runtime-evidence',runId);
fs.mkdirSync(dir,{recursive:true});
const proof={status:'running',capability:'runtime',startedAt:new Date().toISOString(),source:{repo:process.cwd(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),transport:base,...readBackendSource(external),designHash:JSON.parse(fs.readFileSync('docs/design/growth-promotions/admin-r1-baseline.json')).designHash},steps:[],network:[],pageErrors:[],clicks:[],screenshots:[]};
const sourcePaths=['app/api/admin/growth/[...path]/route.ts','app/components/domain-views/design-kit.tsx','app/components/domain-views/h-view.tsx',...fs.readdirSync('app/components/domain-views/h-tabs').filter(n=>/^h4-promotion/.test(n)).map(n=>'app/components/domain-views/h-tabs/'+n),...fs.readdirSync('lib/admin').filter(n=>/^promotion-/.test(n)).map(n=>'lib/admin/'+n),...fs.readdirSync('scripts').filter(n=>/^growth-promotions-(runtime|capture)/.test(n)).map(n=>'scripts/'+n)];
const sourceHashes=()=>Object.fromEntries(sourcePaths.sort().map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
proof.source.files=sourceHashes();proof.source.dirtySourceHash=createHash('sha256').update(JSON.stringify(proof.source.files)).digest('hex');
const browser=await chromium.launch({headless:true});
let page,activityId;
const record=(id,evidence)=>proof.steps.push({id,status:'passed',evidence});
async function actor(name){
  const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  await context.addCookies([{name:'nexion_admin_token',value:sessions.admins[name].accessToken,url:base,httpOnly:true,sameSite:'Lax'}]);
  const next=await context.newPage();next.setDefaultTimeout(15000);
  next.on('pageerror',e=>proof.pageErrors.push(e.message));
  next.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/admin/growth/promotion'))proof.network.push({at:new Date().toISOString(),actor:name,method:r.request().method(),path:u.pathname,status:r.status()});});
  return next;
}
async function snap(name){await page.evaluate(()=>document.fonts.ready);const file=path.join(dir,name+'.png');const segments=await capturePromotionPage(page,file);proof.screenshots.push({name,file,segments,url:page.url(),viewport:page.viewportSize(),dpr:1,font:await page.locator('body').evaluate(e=>getComputedStyle(e).fontFamily)});return file;}
async function click(name,root=page){proof.clicks.push({action:'click',name});await root.getByRole('button',{name,exact:true}).click();}
async function select(label,value,root=page){proof.clicks.push({action:'select',label,value});await root.getByLabel(label,{exact:true}).selectOption(String(value));}
async function fill(label,value,root=page){proof.clicks.push({action:'fill',label,value:String(value)});await root.getByLabel(label,{exact:true}).fill(String(value));}
async function command(name,returnsRewardDetail=false){
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await fill('操作理由 *','PC 实景验收：'+name+'，仅隔离活动，不是线上政策批准。',dialog);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname.startsWith('/api/admin/growth/')&&['POST','PUT'].includes(r.request().method())&&!r.url().includes('audience-preview'));
  await click('确认操作',dialog);const r=await response;const data=await r.json();
  assert.equal(r.status(),200,`${name}: HTTP ${r.status()} ${data.message}`);assert.equal(data.code,0,`${name}: ${data.message}`);assert.equal(data.data.status,'SUCCEEDED');
  if(returnsRewardDetail)await expect(page.getByRole('heading',{name:'原奖励承诺与真实回执',exact:true})).toBeVisible();else await expect(dialog).toHaveCount(0);return data.data;
}
async function open(screen,id=activityId){await page.goto(`${base}/growth/events?promotion=${screen}&activity=${encodeURIComponent(id)}`);await page.waitForLoadState('networkidle');await expect(page.locator('.prm')).toBeVisible();}
async function readActivity(){const r=await page.request.get(`${base}/api/admin/growth/promotions/${activityId}`);assert.equal(r.status(),200);return(await r.json()).data;}
const key=p=>`${p.policyId}:${p.version}`;
async function limit(label,value,root=page){await select(label+'设置方式',value.mode,root);if(value.mode==='LIMITED')await fill(label,value.value,root);}
const casesIndex=process.argv.indexOf('--cases'),onlyCases=casesIndex>=0?process.argv[casesIndex+1].split(','):null;
try{
  if(onlyCases){
    proof.mode='targeted';
    for(const name of onlyCases){page=await actor(name==='reward'?'growth_reviewer':'growth_author');if(name==='templates')await runTemplateCases({page,base,source,click,fill,command,open,snap,record,runId});else if(name==='qualification')await runQualificationChange({page,base,external,source,click,open,snap,record,runId});else if(name==='reward')await runRewardRecovery({page,base,external,click,fill,command,open,snap,record});else throw Error('Unknown targeted case');}
    assert.deepEqual(proof.pageErrors,[]);proof.status='passed';
  }else{
  proof.mode='full';
  page=await actor('growth_author');await page.goto(base+'/growth/events');await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading',{name:'活动中心',exact:true})).toBeVisible();await snap('ADM01-list');
  await click('新建活动');await click('单设备赠礼',page.getByRole('dialog'));const created=await command('新建部分草稿');activityId=created.resource.id;
  assert(!activityId.startsWith('HTTPGP-'));await expect(page.getByRole('heading',{name:'配置活动 · 基本信息'})).toBeVisible();
  const name='PCGP-'+runId.slice(0,8)+' 隔离实景活动';
  await fill('活动名称 *',name);await select('显示时区 *','UTC');
  const begin=new Date(Date.now()-60000).toISOString().slice(0,16),end=new Date(Date.now()+86400000).toISOString().slice(0,16);
  await fill('开始时间 *',begin);await fill('结束时间 *',end);
  for(const [label,lang]of [['中文','zh'],['English','en'],['Tiếng Việt','vi']]){await click(label);await fill('展示标题 *',name+' '+lang);await fill('活动规则 *','仅隔离端到端验收，不构成真实线上活动或承诺。');}
  await page.getByRole('checkbox',{name:'仅向支持促销报价、购买数量及奖励清单的客户端开放'}).check();
  await snap('ADM02-basic-filled');await click('保存草稿');await command('第一步部分草稿保存');await page.reload();await page.waitForLoadState('networkidle');await expect(page.getByLabel('活动名称 *',{exact:true})).toHaveValue(name);
  record('partial-save-reload',[await snap('ADM02-persisted')]);
  const original=await readActivity(),lost=[];let routeFailure=false;const dropped='**/api/admin/growth/promotions/'+activityId+'/draft';
  await fill('活动名称 *',name+' · 原键恢复');await click('保存草稿');await fill('操作理由 *','PC 原键恢复：服务端成功后丢失响应，刷新后只核查原命令。',page.getByRole('dialog'));
  await page.route(dropped,async route=>{if(route.request().method()!=='PUT')return route.continue();try{const response=await route.fetch({timeout:45000});assert.equal(response.status(),200);lost.push({key:route.request().headers()['idempotency-key'],bodyHash:createHash('sha256').update(route.request().postData()).digest('hex'),receipt:(await response.json()).data});}catch{routeFailure=true;}await route.abort('failed').catch(()=>{});},{times:1});
  await click('确认操作',page.getByRole('dialog'));await expect(page.getByText('原命令待核实',{exact:true})).toBeVisible();await expect(page.getByLabel('操作理由 *')).toBeDisabled();await expect.poll(()=>lost.length||Number(routeFailure),{timeout:50000}).toBe(1);assert.equal(routeFailure,false,'Lost-response setup did not obtain the original response');await snap('unknown-response-retained');
  await page.reload();await page.waitForLoadState('networkidle');await click('核查原操作');const recoveredResponse=page.waitForResponse(r=>r.url().includes('/promotion-commands/'+lost[0].key));await click('核查原命令');const recovered=await(await recoveredResponse).json();assert.equal(recovered.data.status,'SUCCEEDED');assert.equal(recovered.data.idempotencyKey,lost[0].key);await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText('有操作结果尚未核实',{exact:true})).toHaveCount(0);const afterRecovery=await readActivity();assert.equal(afterRecovery.current.revision,original.current.revision+1);assert.equal(afterRecovery.current.draft.name,name+' · 原键恢复');assert.equal(lost.length,1);record('unknown-original-key-recovery',[await snap('unknown-original-key-recovered')]);await fill('活动名称 *',name);

  await click('下一步');await command('下一步保存基本信息');assert.equal((await readActivity()).current.draft.name,name);await page.reload();await page.waitForLoadState('networkidle');await expect(page.getByLabel('参与人群 *',{exact:true})).toBeVisible();await snap('ADM03-next-basic-persisted');
  await select('参与人群 *','ANY');await select('设备条件 *','ANY');await click('补充条件与政策');await select('邀请关系 *','ANY');await select('历史购机排除 *','false');await click('返回参与资格');await select('等级选择方式','all');
  await click('重新预览');await expect(page.getByText('符合条件',{exact:true}).first()).toBeVisible();await snap('ADM03-audience');
  await click('下一步');await command('下一步保存参与资格');assert.equal((await readActivity()).current.draft.buyerAudience.purchaseHistory,'ANY');await page.reload();await page.waitForLoadState('networkidle');await click('添加购买设备');const dialog=page.getByRole('dialog');const rule=source.current.draft.rules[0];
  await select('购买设备 *',rule.productNo,dialog);await fill('每组购买数量 *',rule.minBuyQty,dialog);await select('计奖方式 *',rule.repeatMode,dialog);await limit('每单最大计奖组数',rule.maxGroups,dialog);await limit('活动内每人最大计奖组数',rule.maxGroupsPerPerson,dialog);await fill('规则优先级 *',rule.priority,dialog);await select('奖励类型 *','NEX',dialog);await fill('每组 NEX 奖励金额 *',rule.buyerReward.amount,dialog);await select('NEX 资产政策 *',key(rule.buyerReward.assetPolicy),dialog);
  await snap('ADM04-rule-modal');await click('保留到草稿',dialog);await snap('ADM04-rules');await click('下一步');await command('下一步保存逐设备奖励');assert.equal((await readActivity()).current.draft.rules[0].buyerReward.amount,rule.buyerReward.amount);await page.reload();await page.waitForLoadState('networkidle');await expect(page.getByRole('button',{name:'编辑预算',exact:true})).toBeVisible();await snap('ADM05-next-rules-persisted');
  await click('角色与每单设置');
  for(const [label,value] of [['购买者活动参与上限',source.current.draft.perPersonLimit.buyer],['直接邀请人活动参与上限',source.current.draft.perPersonLimit.directInviter],['全活动参与订单上限',source.current.draft.activityLimit],['每单奖励义务上限',source.current.draft.maxRewardUnitsPerOrder]])await limit(label,value);
  await click('返回预算与叠加');
  await click('编辑预算');await fill('NEX 总额度','10000.000000',page.getByRole('dialog'));await snap('ADM05-budget-modal');await click('保留到草稿',page.getByRole('dialog'));
  await click('设置批准政策');
  for(const [label,keyName]of [['结算与成熟政策 *','settlement'],['优惠叠加政策 *','stacking'],['售后追回政策 *','refund'],['报价与付款期限政策 *','quote'],['审核发布授权政策 *','authorization']])await select(label,key(source.current.draft.policies[keyName]));
  await select('额度不足后 *','RULE_STOP',page.getByRole('dialog'));await click('返回预算与叠加');await snap('ADM05-budget-policy');await click('保存草稿');await command('完整草稿保存');await page.reload();await page.waitForLoadState('networkidle');const saved=await readActivity();assert.equal(saved.current.draft.rules[0].buyerReward.amount,rule.buyerReward.amount);assert.equal(saved.current.draft.name,name);
  record('four-step-save-reload',[await snap('ADM02-complete-reloaded')]);
  await open('review');await click('重新试算');await click('添加购买项',page.getByRole('dialog'));await select('购买设备 1',rule.productNo,page.getByRole('dialog'));await fill('购买数量','2',page.getByRole('dialog'));await click('运行试算',page.getByRole('dialog'));await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText('占用真实资格 / 预算',{exact:true})).toBeVisible();record('simulation-readonly',[await snap('ADM06-simulation')]);
  await click('提交审核');await command('提交审核');assert.equal((await readActivity()).current.state,'PENDING_APPROVAL');
  await click('撤回审核');await command('撤回审核');assert.equal((await readActivity()).current.state,'DRAFT');await click('提交审核');await command('再次提交审核');
  const author=page;page=await actor('growth_reviewer');await open('review');await click('驳回候选版本');await command('审核驳回');assert.equal((await readActivity()).current.state,'DRAFT');
  const reviewer=page;page=author;await open('review');await click('提交审核');await command('修订后提交');page=reviewer;await open('review');await click('审核确认');await command('独立人员审核');assert.equal((await readActivity()).current.state,'APPROVED');await snap('ADM06-approved');
  page=author;await open('review');await click('发布确认');await command('独立发布');const published=await readActivity();assert.equal(published.activeVersion,1);assert.equal(published.state,'ACTIVE');
  await open('detail');await click('暂停新预留');await command('暂停新预留');assert.equal((await readActivity()).state,'PAUSED');await click('恢复新预留');await command('恢复新预留');assert.equal((await readActivity()).state,'ACTIVE');
  await click('创建改版草稿');await command('创建改版草稿');const dual=await readActivity();assert.equal(dual.activeVersion,1);assert.equal(dual.draftVersion,2);record('approval-publish-dual-lifecycle',[await snap('ADM07-dual')]);
  await open('metrics');const metricsFrom=await page.getByLabel('开始时间',{exact:true}).inputValue();await page.route('**/api/admin/growth/promotions/'+activityId+'/metrics?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:503,message:'PROMOTION_SOURCE_UNAVAILABLE',data:null})}),{times:1});await click('查询');await expect(page.getByText('读取未完成',{exact:true})).toBeVisible();await expect(page.getByLabel('开始时间',{exact:true})).toHaveValue(metricsFrom);await snap('ADM09-first-query-failed-input-retained');const retried=page.waitForResponse(r=>r.url().includes('/'+activityId+'/metrics?')&&r.status()===200);await click('重试读取');await(await retried).finished();await expect(page.getByRole('heading',{name:'奖励与成本',exact:true})).toBeVisible();await expect(page.getByText('未提供',{exact:true}).first()).toBeVisible();record('metrics-real-snapshot',[await snap('ADM09-metrics')]);
  page=reviewer;await open('metrics');await click('查询');await click('导出当前快照');await command('固定快照导出');record('metrics-export',[await snap('ADM09-export')]);
  await open('rewards',source.activityId);await expect(page.getByRole('button',{name:'查看与处置',exact:true}).first()).toBeVisible();await click('查看与处置');await expect(page.getByRole('heading',{name:'原权益与售后说明'})).toBeVisible();record('reward-original-receipt',[await snap('ADM08-reward-detail')]);
  await prepareRewardFailure(external,activityId);
  await runRewardRecovery({page,base,external,click,fill,command,open,snap,record});
  page=author;await runTemplateCases({page,base,source,click,fill,command,open,snap,record,runId});
  await runQualificationChange({page,base,external,source,click,open,snap,record,runId});
  page=await actor('growth_reader');await open('edit');await expect(page.getByLabel('活动名称 *',{exact:true})).toBeDisabled();await click('下一步');await expect(page.getByLabel('参与人群 *',{exact:true})).toBeDisabled();await click('下一步');await expect(page.getByRole('button',{name:'编辑',exact:true}).first()).toBeDisabled();record('real-reader-readonly',[await snap('ADM04-reader-disabled')]);
  const denied=await page.request.post(`${base}/api/admin/growth/promotions/${activityId}/pause`,{headers:{'Idempotency-Key':'deny-'+runId},data:{expectedRevision:dual.revision,reason:'仅验证真实只读账户拒绝权限',evidenceRefs:[]}});assert.equal(denied.status(),403);record('real-permission-denial',[`${base}/api/admin/growth/promotions/${activityId}/pause → HTTP 403`]);
  fs.writeFileSync(path.join(external,'pc-runtime-activities.json'),JSON.stringify({activityId,sourceActivityId:source.activityId,runId,name,createdAt:proof.startedAt},null,2));
  assert.deepEqual(proof.pageErrors,[]);proof.status='passed';
  }
}catch(error){proof.status='failed';proof.failure=String(error.stack||error);if(page)try{await snap('failure');proof.lastVisibleText=(await page.locator('body').innerText()).slice(-14000);}catch{}process.exitCode=1;}
finally{if(JSON.stringify(sourceHashes())!==JSON.stringify(proof.source.files)||readBackendSource(external).serviceSourceHash!==proof.source.serviceSourceHash){proof.status='failed';proof.failure='Product or backend source changed during runtime verification';process.exitCode=1;}proof.finishedAt=new Date().toISOString();proof.activityId=activityId;fs.writeFileSync(report,JSON.stringify(proof,null,2));await browser.close();console.log(JSON.stringify({status:proof.status,steps:proof.steps.map(s=>s.id),report,failure:proof.failure?.split('\n').slice(0,2)}));}
