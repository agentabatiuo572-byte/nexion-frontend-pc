import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
export async function prepareRewardFailure(root,activityId){
const mysql='D:/WORKS/PLAN/.local-runtime/phone-calibration-tools/mysql-verified/mysql-8.4.6-winx64/bin/mysql.exe';
const sql=q=>{const r=spawnSync(mysql,[`--defaults-extra-file=${root}/mysql/client.private.ini`,'--default-character-set=utf8mb4','-N','-B','growth_promotions_20261007'],{input:q,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
assert.equal(sql("SELECT CONCAT(DATABASE(),':',@@port);"),'growth_promotions_20261007:33339');
const sessions=JSON.parse(fs.readFileSync(root+'/sessions-owned-v2.private.json')),accounts=JSON.parse(fs.readFileSync(root+'/accounts-owned-v2.private.json'));
const member=accounts.members[2];assert(member&&Number.isSafeInteger(member.id));assert.notEqual(member.id,accounts.members[3].id);
assert.equal(sql(`SELECT COUNT(*) FROM nx_user WHERE id=${member.id} AND nickname='Isolated owned HTTP fixture';`),'1');
assert.equal(sql("SELECT COUNT(*) FROM nx_admin_role WHERE role_code='GP_HTTP_AUTHOR' AND remark LIKE 'EXPLICIT AUTHORIZATION FIXTURE:%' AND is_deleted=0;"),'1');
assert.equal(sql("SELECT COUNT(*) FROM nx_admin_permission WHERE permission_code='user_c1_read' AND status=1 AND is_deleted=0;"),'1');
const grants="SELECT COUNT(*) FROM nx_admin_role_permission rp JOIN nx_admin_role r ON r.id=rp.role_id JOIN nx_admin_permission p ON p.id=rp.permission_id WHERE r.role_code='GP_HTTP_AUTHOR' AND p.permission_code='user_c1_read' AND rp.is_deleted=0;";
const before=sql(grants);
assert.equal(before,'1','The explicit isolated C1 fixture grant must already exist');
const evidence={fixtureOnly:true,database:'growth_promotions_20261007:33339',permission:{role:'GP_HTTP_AUTHOR',permission:'user_c1_read',before,after:sql(grants)},startedAt:new Date().toISOString(),steps:[]};
const run='PCFAULT-'+randomUUID().slice(0,8);
const api=async(actor,method,url,body)=>{const admin=actor==='admin',token=admin?sessions.admins.growth_author.accessToken:sessions.members[member.referralCode].accessToken;const r=await fetch('http://127.0.0.1:8139'+url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Nexion-Client-Surface':'H5',...(method==='GET'?{}:{'Idempotency-Key':run+'-'+randomUUID()})},body:body===undefined?undefined:JSON.stringify(body)});const b=await r.json();evidence.steps.push({method,url,status:r.status,code:b.code});assert.equal(r.status,200,b.message);assert.equal(b.code,0,b.message);return b.data;};
const a=await api('admin','GET','/api/admin/growth/promotions/'+activityId);assert.match(a.name,/^PCGP-/);assert.equal(a.state,'ACTIVE');
const draft=a.current.draft,product=draft.rules[0].productNo;assert.equal(draft.rules[0].buyerReward.type,'NEX');
const quote=await api('member','POST','/api/orders/quote',{items:[{productNo:product,quantity:1}],activityId,clientCapabilities:draft.minimumClientCapabilities});
const order=await api('member','POST','/api/orders',{productNo:product,quantity:1,promotionQuoteId:quote.quoteId});assert.match(order.orderNo,/^[A-Za-z0-9_-]+$/);
assert.equal(sql(`SELECT COUNT(*) FROM nx_order WHERE order_no='${order.orderNo}' AND user_id=${member.id} AND payment_status='PENDING';`),'1');
const trigger='pc_reward_fail_'+randomUUID().replaceAll('-','').slice(0,16);assert.equal(sql(`SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME='${trigger}';`),'0');
let installed=false;
try{
 sql(`DELIMITER $$\nCREATE TRIGGER ${trigger} BEFORE INSERT ON nx_wallet_ledger FOR EACH ROW BEGIN IF NEW.biz_type='PROMOTION_REWARD' AND EXISTS(SELECT 1 FROM nx_promotion_reward r WHERE r.order_no='${order.orderNo}' AND r.beneficiary_id=${member.id} AND NEW.biz_no=CONCAT('PROMOTION-ISSUE-',r.obligation_id)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PC_ISOLATED_REWARD_POSTING_FAULT'; END IF; END$$\nDELIMITER ;`);installed=true;
 const beforeWallet=sql(`SELECT usdt_available,nex_available FROM nx_user_wallet WHERE user_id=${member.id};`);
 await api('member','POST',`/api/orders/${order.orderNo}/pay`);
 // Shared isolated reversal fixtures take about 100s per dispatch cycle; keep the fault installed until this order is attempted.
 let rewards;for(let i=0;i<150;i++){rewards=await api('member','GET','/api/promotion-rewards?orderNo='+order.orderNo);if(rewards.items?.length&&rewards.items.every(r=>r.state==='RETRYABLE_FAILED'))break;await new Promise(resolve=>setTimeout(resolve,2000));}
 assert.equal(rewards.items.length,1);const reward=rewards.items[0];assert.equal(reward.state,'RETRYABLE_FAILED');assert.equal(reward.assetReceipt,null);assert.match(reward.obligationId,/^[A-Za-z0-9_-]+$/);
 assert.equal(sql(`SELECT COUNT(*) FROM nx_wallet_ledger WHERE biz_no='PROMOTION-ISSUE-${reward.obligationId}';`),'0');
 assert.equal(sql(`SELECT COUNT(*) FROM nx_earnings_release_entry WHERE source_type='PROMOTION_REWARD' AND source_ref='${reward.obligationId}';`),'0');
 const afterWallet=sql(`SELECT usdt_available,nex_available FROM nx_user_wallet WHERE user_id=${member.id};`);assert.equal(beforeWallet.split('\t')[1],afterWallet.split('\t')[1]);
 Object.assign(evidence,{activityId,orderNo:order.orderNo,obligationId:reward.obligationId,memberId:member.id,failedReward:reward,verifiedNoLedger:true,verifiedNoEarnings:true,verifiedNoNexCredit:true,trigger});
}finally{if(installed)sql(`DROP TRIGGER ${trigger};`);evidence.triggerRemoved=sql(`SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME='${trigger}';`)==='0';evidence.finishedAt=new Date().toISOString();const file=root+'/pc-reward-failure-'+run+'.json';evidence.file=file;fs.writeFileSync(file,JSON.stringify(evidence,null,2));fs.writeFileSync(root+'/pc-reward-failure-fixture.json',JSON.stringify(evidence,null,2));}
return evidence;
}
