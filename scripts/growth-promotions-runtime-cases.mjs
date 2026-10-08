import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// Read only this run's audit; the policy lifecycle still uses the real HTTP commands.
async function deviceAudiencePolicy({catalog,api,accounts,external,reason,facts}){
  const existing=catalog.policies.find(p=>p.state==='APPROVED'&&p.content.kind==='DEVICE_AUDIENCE'&&p.content.sources.length===1&&p.content.sources[0]==='ORDER'&&p.content.states.length===1&&p.content.states[0]==='ACTIVE');
  if(existing)return existing;
  const mysql='D:/WORKS/PLAN/.local-runtime/phone-calibration-tools/mysql-verified/mysql-8.4.6-winx64/bin/mysql.exe';
  const sql=query=>{const result=spawnSync(mysql,[`--defaults-extra-file=${external}/mysql/client.private.ini`,'--default-character-set=utf8mb4','-N','-B','growth_promotions_20261007'],{input:query,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  assert.equal(sql("SELECT CONCAT(DATABASE(),':',@@port);"),'growth_promotions_20261007:33339');
  const actorId=accounts.admins.find(a=>a.username==='growth_author').id;assert(Number.isSafeInteger(actorId));
  const evidenceDraft=await api('growth_author','POST','/api/admin/growth/promotions',{draft:{category:'PROMOTION',template:'SKU_GIFT',name:'PCGP device-audience evidence '+randomUUID().slice(0,8)},reason});
  const activityId=evidenceDraft.resource.id;assert.match(activityId,/^[A-Za-z0-9_-]+$/);
  const auditId=sql(`SELECT id FROM nx_audit_log WHERE actor_id=${actorId} AND action='CREATEPROMOTION' AND resource_id='${activityId}' ORDER BY id DESC LIMIT 1;`);assert.match(auditId,/^\d+$/);
  const content={kind:'DEVICE_AUDIENCE',executorCode:'PROMOTION_DEVICE_AUDIENCE_V1',sources:['ORDER'],states:['ACTIVE'],excludeExpired:true,excludePhoneAndTrial:true};
  const created=await api('growth_author','POST','/api/admin/growth/promotion-policies',{content,reason,evidenceRefs:[auditId]});
  const target=created.resource.id,id=target.slice(0,target.lastIndexOf(':'));assert(id);
  await api('growth_author','POST',`/api/admin/growth/promotion-policies/${id}/versions/1/approve`,{expectedRevision:1,reason,evidenceRefs:[auditId]});
  const policy=await api('growth_author','GET',`/api/admin/growth/promotion-policies/${id}/versions/1`);assert.equal(policy.state,'APPROVED');assert.deepEqual(policy.content,content);
  facts.isolatedPolicy={policyId:id,version:1,auditId,evidenceActivityId:activityId,policyCommands:'Real policy HTTP commands in isolated database only'};
  return policy;
}

/** Controlled setup uses real approved policies and HTTP; all assertions inspect rendered product and real readback. */
export async function runTemplateCases({page,base,source,click,fill,command,open,snap,record,runId}){
  const api=async(url,method='GET',body)=>{const r=await page.request.fetch(base+'/api/admin/growth'+url,{method,headers:method==='GET'?{}:{'Idempotency-Key':'pc-template-'+randomUUID()},data:body});const b=await r.json();assert.equal(r.status(),200,b.message);assert.equal(b.code,0,b.message);return b.data;};
  const catalog=await api('/promotion-catalog'),templates={SKU_GIFT:'单设备赠礼',FIRST_PURCHASE:'首购礼',DIRECT_REFERRAL:'直邀首购双向礼',MULTI_PRODUCT:'多型号组合',REPURCHASE:'复购召回'},cases=[];
  const first=catalog.policies.find(p=>p.content.kind==='FIRST_PURCHASE'&&p.state==='APPROVED');
  assert(first,'A real approved isolated first-purchase reference is required');
  const reference=p=>({policyId:p.policyId,version:p.version,contentHash:p.contentHash});
  let last;
  for(const [template,label]of Object.entries(templates)){
    await page.goto(base+'/growth/events');await expect(page.getByRole('button',{name:'新建活动',exact:true}).first()).toBeEnabled();await click('新建活动');await click(label,page.getByRole('dialog'));const created=await command('五模板创建 '+label),id=created.resource.id;
    const createdDraft=await api('/promotions/'+id);assert.equal(createdDraft.current.draft.template,template);assert.equal(createdDraft.activeVersion,null);
    const draft=structuredClone(source.current.draft);Object.assign(draft,{name:`PCGP-${runId.slice(0,8)} ${label}`,template,category:template==='DIRECT_REFERRAL'?'REFERRAL':'PROMOTION',startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()});
    draft.buyerAudience.purchaseHistory=['FIRST_PURCHASE','DIRECT_REFERRAL'].includes(template)?'NEVER_PAID':template==='REPURCHASE'?'HAS_VALID_PURCHASE':'ANY';
    draft.buyerAudience.lastValidPurchaseAge={minDays:template==='REPURCHASE'?1:null,maxDays:null};
    draft.buyerAudience.sponsor=template==='DIRECT_REFERRAL'?'REQUIRED':'ANY';
    draft.inviterAudience=template==='DIRECT_REFERRAL'?{...structuredClone(source.current.draft.buyerAudience),purchaseHistory:'ANY'}:null;
    draft.policies.firstPurchase=['FIRST_PURCHASE','DIRECT_REFERRAL'].includes(template)?reference(first):null;
    draft.rules[0].ruleId='rule-'+randomUUID();draft.rules[0].buyerReward.rewardRuleId='reward-'+randomUUID();
    draft.rules[0].inviterReward=template==='DIRECT_REFERRAL'?{...structuredClone(draft.rules[0].buyerReward),rewardRuleId:'reward-'+randomUUID(),beneficiaryRole:'DIRECT_INVITER'}:null;
    draft.combinationMatch=template==='MULTI_PRODUCT'?'ALL':'ANY';
    if(template==='MULTI_PRODUCT'){
      const second=catalog.skus.find(s=>s.available&&s.productNo!==draft.rules[0].productNo);assert(second);
      draft.rules.push({...structuredClone(draft.rules[0]),ruleId:'rule-'+randomUUID(),productNo:second.productNo,buyerReward:{...structuredClone(draft.rules[0].buyerReward),rewardRuleId:'reward-'+randomUUID()}});
    }
    await api('/promotions/'+id+'/draft','PUT',{expectedRevision:createdDraft.current.revision,draft,reason:'隔离五模板完整场景准备，真实批准引用，不发布。'});
    await open('edit',id);await expect(page.getByLabel('活动模板 *',{exact:true})).toHaveValue(template);await fill('活动名称 *',draft.name+' · 已核对');await click('保存草稿');await command('五模板配置保存 '+label);await page.reload();await page.waitForLoadState('networkidle');await expect(page.getByLabel('活动名称 *')).toHaveValue(draft.name+' · 已核对');
    await click('下一步');await expect(page.getByLabel('参与人群 *',{exact:true}).first()).toHaveValue(draft.buyerAudience.purchaseHistory);
    if(template==='DIRECT_REFERRAL')await expect(page.getByText('直接邀请人条件',{exact:true})).toBeVisible();
    if(template==='REPURCHASE')await expect(page.getByLabel('最短购机间隔（天）',{exact:true})).toHaveValue('1');
    await click('下一步');await expect(page.getByRole('button',{name:'编辑',exact:true})).toHaveCount(template==='MULTI_PRODUCT'?2:1);
    if(template==='MULTI_PRODUCT')await expect(page.getByLabel('组合购买匹配 *')).toHaveValue('ALL');
    if(template==='DIRECT_REFERRAL'){await click('编辑');await expect(page.getByRole('group',{name:'购买者奖励',exact:true})).toBeVisible();await expect(page.getByRole('group',{name:'直接邀请人奖励',exact:true})).toBeVisible();await click('取消',page.getByRole('dialog'));}
    await open('review',id);await click('提交审核');await command('五模板完整合同校验 '+label);assert.equal((await api('/promotions/'+id)).current.state,'PENDING_APPROVAL');await click('撤回审核');await command('五模板验收后撤回 '+label);
    cases.push(await snap('template-'+template));if(template==='SKU_GIFT')last={id,draft};
  }
  record('five-templates',cases);
  // Real server resource calculation against an explicitly undersized candidate budget.
  await page.goto(base+'/growth/events?promotion=edit&activity='+last.id+'&step=3');await expect(page.getByRole('button',{name:'编辑预算',exact:true})).toBeVisible();await click('编辑预算');await fill('NEX 总额度',last.draft.rules[0].buyerReward.amount,page.getByRole('dialog'));await click('保留到草稿',page.getByRole('dialog'));await click('保存草稿');await command('资源不足候选保存');await open('review',last.id);await click('重新试算');const modal=page.getByRole('dialog');await click('添加购买项',modal);await modal.getByLabel('购买设备 1',{exact:true}).selectOption(last.draft.rules[0].productNo);await fill('购买数量','2',modal);const samplesResponse=page.waitForResponse(r=>r.url().endsWith('/audience-preview')&&r.request().method()==='POST');await click('读取授权账户样本',modal);const samples=(await(await samplesResponse).json()).data.samples;const sample=samples.find(s=>s.status==='MATCHED');assert(sample,'A genuinely matched authorized sample is required');await modal.getByLabel('样本账户（可选）').selectOption(sample.accountId);const response=page.waitForResponse(r=>r.url().endsWith('/simulate')&&r.request().method()==='POST');await click('运行试算',modal);const reply=await response,body=await reply.json();assert.equal(reply.status(),200,body.message);const simulation=body.data;assert(simulation.resources.some(r=>r.status==='SHORTAGE'),'Real resource shortage required');await expect(page.getByText('不足',{exact:true}).first()).toBeVisible();assert.equal(simulation.reserved,false);record('resource-shortage',[await snap('real-resource-shortage')]);
  return {last,cases};
}

export async function runRewardRecovery({page,base,external,click,fill,command,open,snap,record}){
  const fixture=JSON.parse(fs.readFileSync(path.join(external,'pc-reward-failure-fixture.json')));
  assert.equal(fixture.triggerRemoved,true);assert.equal(fixture.verifiedNoLedger,true);assert.equal(fixture.verifiedNoEarnings,true);
  const read=async()=>{const r=await page.request.get(base+'/api/admin/growth/promotion-rewards/'+fixture.obligationId);assert.equal(r.status(),200);return(await r.json()).data;};
  const before=await read();assert.equal(before.state,'RETRYABLE_FAILED','Prepare a fresh real failed transaction before this case');assert.equal(before.assetReceipt,null);
  await open('rewards',fixture.activityId);await fill('订单',fixture.orderNo);await click('查询');await expect(page.getByRole('button',{name:'查看与处置',exact:true})).toHaveCount(1);await click('查看与处置');await click('重试原奖励项');await fill('操作理由 *','PC 原奖励恢复：真实发奖回滚后只重试原义务，丢失响应后核对原命令。',page.getByRole('dialog'));
  const lost=[];let routeFailure=false;await page.route('**/api/admin/growth/promotion-rewards/'+fixture.obligationId+'/retry',async route=>{try{const response=await route.fetch({timeout:45000});assert.equal(response.status(),200);const receipt=(await response.json()).data;assert.equal(receipt.status,'SUCCEEDED');lost.push({key:route.request().headers()['idempotency-key'],receipt});}catch{routeFailure=true;}await route.abort('failed').catch(()=>{});},{times:1});
  await click('确认操作');await expect(page.getByText('原命令待核实',{exact:true})).toBeVisible();await expect.poll(()=>lost.length||Number(routeFailure),{timeout:50000}).toBe(1);assert.equal(routeFailure,false,'Retry lost-response setup requires a definitive original success; request diagnostics intentionally omit credential-bearing headers');await snap('reward-retry-response-lost');await page.reload();await page.waitForLoadState('networkidle');await click('核查原操作');const result=page.waitForResponse(r=>r.url().includes('/promotion-commands/'+lost[0].key));await click('核查原命令');const receipt=(await(await result).json()).data;assert.equal(receipt.idempotencyKey,lost[0].key);assert.equal(receipt.status,'SUCCEEDED');await expect(page.getByRole('dialog')).toHaveCount(0);
  const issued=await read();assert.equal(issued.state,'ISSUED');assert.equal(issued.obligationId,before.obligationId);assert.deepEqual(issued.reward,before.reward);assert(issued.assetReceipt?.ledgerBizNo&&issued.assetReceipt?.earningsEntryNo);assert.equal(lost.length,1);
  await fill('订单',fixture.orderNo);await click('查询');await expect(page.getByRole('button',{name:'查看与处置',exact:true})).toHaveCount(1);await click('查看与处置');await expect(page.getByRole('button',{name:'重试原奖励项',exact:true})).toBeDisabled();await click('核查原结果');await command('核对真实原账本与收益条目',true);const reconciled=await read();assert.equal(reconciled.state,'ISSUED');assert.deepEqual(reconciled.assetReceipt,issued.assetReceipt);assert.equal(reconciled.attempts.filter(a=>a.state==='ISSUED').length,issued.attempts.filter(a=>a.state==='ISSUED').length+1);record('reward-retry-reconcile',[fixture.file||path.join(external,'pc-reward-failure-fixture.json'),await snap('reward-original-receipt-reconciled')]);
}

export async function runQualificationChange({page,base,external,source,click,open,snap,record,runId}){
  const accounts=JSON.parse(fs.readFileSync(path.join(external,'accounts-owned-v2.private.json'))),sessions=JSON.parse(fs.readFileSync(path.join(external,'sessions-owned-v2.private.json'))),member=accounts.members[1];
  assert(Number.isSafeInteger(member.id));assert.notEqual(member.id,accounts.members[3].id);
  const facts={scenario:'Actual ordinary paid purchase invalidates the previously quoted no-device eligibility',activityId:null,memberId:member.id,requests:[]};
  const api=async(actor,method,url,body,expected=200)=>{const token=actor==='member'?sessions.members[member.referralCode].accessToken:sessions.admins[actor].accessToken;const r=await fetch('http://127.0.0.1:8139'+url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Nexion-Client-Surface':'H5',...(method==='GET'?{}:{'Idempotency-Key':'pc-qualification-'+randomUUID()})},body:body===undefined?undefined:JSON.stringify(body)});const b=await r.json();facts.requests.push({actor:actor==='member'?'owned-member-1':actor,method,url,status:r.status,code:b.code});assert.equal(r.status,expected,b.message);if(expected===200)assert.equal(b.code,0,b.message);return b.data;};
  const catalog=await api('growth_author','GET','/api/admin/growth/promotion-catalog');
  const reason='隔离验收：真实普通购机改变无设备资格，原报价不得继续建单。';
  const policy=await deviceAudiencePolicy({catalog,api,accounts,external,reason,facts});
  const draft=structuredClone(source.current.draft);Object.assign(draft,{name:'PCGP-'+runId.slice(0,8)+' 真实无设备资格失效',startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()});draft.rules[0].ruleId='rule-'+randomUUID();draft.rules[0].buyerReward.rewardRuleId='reward-'+randomUUID();draft.buyerAudience.devicePresence='NONE';draft.buyerAudience.deviceAudiencePolicy={policyId:policy.policyId,version:policy.version,contentHash:policy.contentHash};
  const created=await api('growth_author','POST','/api/admin/growth/promotions',{draft,reason}),id=created.resource.id;facts.activityId=id;
  await api('growth_author','POST',`/api/admin/growth/promotions/${id}/submit`,{expectedRevision:1,version:1,reason,evidenceRefs:[]});await api('growth_reviewer','POST',`/api/admin/growth/promotions/${id}/approve`,{expectedRevision:2,version:1,reason,evidenceRefs:[]});await api('growth_author','POST',`/api/admin/growth/promotions/${id}/publish`,{expectedRevision:3,version:1,reason,evidenceRefs:[]});
  const product=draft.rules[0].productNo,simulateBody={draft,items:[{productNo:product,quantity:1}],sampleAccountId:String(member.id)};
  const before=await api('growth_author','POST',`/api/admin/growth/promotions/${id}/simulate`,simulateBody);assert.equal(before.eligibility,'ELIGIBLE','The owned account must genuinely start with no qualifying device');
  const preview=async()=>{await page.goto(`${base}/growth/events?promotion=edit&activity=${id}&step=1`);await expect(page.getByRole('button',{name:'重新预览',exact:true})).toBeEnabled();const response=page.waitForResponse(r=>r.url().endsWith('/audience-preview'));await click('重新预览');await(await response).finished();await expect(page.getByText('符合条件',{exact:true}).first()).toBeVisible();};
  await preview();const beforeShot=await snap('qualification-before-ordinary-payment');
  const quoted=await api('member','POST','/api/orders/quote',{items:simulateBody.items,activityId:id,clientCapabilities:draft.minimumClientCapabilities});
  const ordinary=await api('member','POST','/api/orders',{productNo:product,quantity:1});let paid=false;
  const file=path.join(external,'pc-qualification-facts-'+runId+'.json');facts.ordinaryOrderNo=ordinary.orderNo;fs.writeFileSync(file,JSON.stringify(facts,null,2));
  try{
  await api('member','POST',`/api/orders/${ordinary.orderNo}/pay`);paid=true;
  await api('member','POST','/api/orders',{productNo:product,quantity:1,promotionQuoteId:quoted.quoteId},409);
  const after=await api('growth_author','POST',`/api/admin/growth/promotions/${id}/simulate`,simulateBody);assert.equal(after.eligibility,'INELIGIBLE');assert.equal(after.rewardUnits.length,0);
  const activity=await api('growth_author','GET','/api/admin/growth/promotions/'+id);assert.equal(activity.impact.reservedOrders.length,0);assert.equal(activity.impact.pendingRewards,0);const rewards=await api('growth_author','GET','/api/admin/growth/promotion-rewards?activityId='+id);assert.equal(rewards.total,0);
  await preview();const afterShot=await snap('qualification-after-ordinary-payment');Object.assign(facts,{ordinaryOrderNo:ordinary.orderNo,quoteId:quoted.quoteId,beforeEligibility:before.eligibility,afterEligibility:after.eligibility,reservations:activity.impact.reservedOrders.length,rewardCount:rewards.total});
  facts.verification={status:'passed',beforeShot,afterShot};
  }finally{
    if(paid){const refunded=await api('growth_reviewer','POST',`/api/admin/devices/orders/${ordinary.orderNo}/refund`,{refundChannel:'WALLET',reason:'隔离资格变化验收结束，按实际订单整单退款恢复测试账户。'});assert.equal(refunded.state,'refunded');facts.cleanup={orderNo:ordinary.orderNo,state:refunded.state,method:'Real E4 whole-order wallet refund'};}
    fs.writeFileSync(file,JSON.stringify(facts,null,2));
  }
  assert.equal(facts.verification?.status,'passed');record('qualification-expired',[file,beforeShot,facts.verification.afterShot]);
}
