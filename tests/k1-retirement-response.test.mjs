import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const exports={};
const source=readFileSync(new URL('../lib/admin/k-client.ts',import.meta.url),'utf8')+'\nexport { normalizeK1 };';
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('exports','require',js)(exports,()=>({formatAdminApiError:message=>message}));
const row=(key,value)=>({key,name:key,value,version:1,adjustable:true,sub:'',note:''});
const fixture=()=>({serverCanonical:true,domain:'K1',
 stats:{activeClusters:0,highClusters:0,frozenClusters:0,frozenAccounts:0,flaggedAccounts:0},
 params:[row('maxSignupPerIp24h','2'),row('maxAccountsPerDevice','2'),row('maxAccountsPerPaymentInstrument','2'),row('clusterFreezeSuggestThreshold','0.7'),row('linkWeight','设备 0.5 · 支付 0.3 · IP 0.2')],
 releaseParams:[row('freePhoneSlotsPerCluster','1'),row('duplicateAccountPendingFrom','2'),row('duplicateAccountFreezeFrom','3'),row('pendingReleaseHours','24'),row('releaseMode','manual_only'),row('freeSlotRequiresBinding','true')],
 clusters:{total:0,pageNum:1,pageSize:20,records:[]},whitelist:{total:0,pageNum:1,pageSize:20,records:[]},
 sources:['nx_user_registration_otp:consumed_client_ip','nx_risk_decision:device_fingerprint','nx_wallet_bank_card:card_token','nx_admin_risk_multi_account_cluster','nx_admin_risk_ip_whitelist']});
test('K1 reads both current and historical wire fields without enabling automated release',()=>{
 const current=exports.normalizeK1(fixture());assert.equal(current.releaseParams.length,6);
 const legacy=fixture();legacy.releaseParams.push(row('appAttestationReleaseHours','1'));
 legacy.releaseParams.find(row=>row.key==='releaseMode').value='attest_or_manual';
 const parsed=exports.normalizeK1(legacy);
 assert.deepEqual(parsed.releaseParams,current.releaseParams);
 assert.equal(parsed.releaseParams.find(row=>row.key==='releaseMode').adjustable,false);
 const bad=fixture();bad.releaseParams.find(row=>row.key==='releaseMode').value='unknown';
 assert.throws(()=>exports.normalizeK1(bad),/K1_RESPONSE_INVALID/);
 const missing=fixture();missing.releaseParams.shift();assert.throws(()=>exports.normalizeK1(missing),/K1_RESPONSE_INVALID/);
});
