import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBankEligibility, parseBankSettlement, readBankEvidence, bankEvidenceTime } from '../lib/admin/bank-payout-evidence.ts';

const settlement = () => ({ status:'unconfirmed',evidenceRef:null,providerOrderId:null,providerStatus:null,checkedAt:null,amountUsdt:null });
test('account identity readiness is required without any external verification evidence', () => {
  assert.equal(parseBankEligibility(undefined),null);
  assert.equal(parseBankEligibility({canWithdraw:false,reasonCode:'BANK_BENEFICIARY_CHANGED'}).canWithdraw,false);
  assert.equal(parseBankEligibility({canWithdraw:true,reasonCode:null}).canWithdraw,true);
  for (const value of [{canWithdraw:'true',reasonCode:null},{canWithdraw:true,reasonCode:'BANK_BENEFICIARY_CHANGED'},{reasonCode:null}])
    assert.throws(()=>parseBankEligibility(value),/EVIDENCE_INVALID/);
});
test('success/refund needs receipt evidence rather than a failed order label', () => {
  for(const status of ['paid','refunded']) assert.throws(()=>parseBankSettlement({...settlement(),status}),/EVIDENCE_INVALID/);
  const refund={...settlement(),status:'refunded',evidenceRef:'ledger-1',checkedAt:'2026-09-16T01:00:00',amountUsdt:100};
  assert.equal(parseBankSettlement(refund).amountUsdt,100);
  assert.throws(()=>parseBankSettlement({...refund,amountUsdt:true}),/EVIDENCE_INVALID/);
  for (const amountUsdt of ['0x64','1e200','100.1234567',100.1234567,1e200]) assert.throws(()=>parseBankSettlement({...refund,amountUsdt}),/EVIDENCE_INVALID/);
  assert.equal(parseBankSettlement({...refund,amountUsdt:'20.000001'}).amountUsdt,20.000001);
  assert.equal(parseBankSettlement({...refund,status:'paid',providerOrderId:'1234',providerStatus:3}).status,'paid');
});
test('evidence timestamps show Vietnam time consistently',()=>{
  assert.match(bankEvidenceTime('2026-09-16T01:00:00Z'),/08:00:00/);
  assert.equal(bankEvidenceTime('2026-09-16T09:00:00'),bankEvidenceTime('2026-09-16T01:00:00Z'));
  assert.equal(bankEvidenceTime('2026-09-16 09:00:00'),bankEvidenceTime('2026-09-16T01:00:00Z'));
  assert.equal(parseBankSettlement({...settlement(),checkedAt:'2026-09-16 09:00:00'}).checkedAt,'2026-09-16T09:00:00+08:00');
  assert.throws(()=>parseBankSettlement({...settlement(),checkedAt:'2026-02-30 09:00:00'}),/EVIDENCE_INVALID/);
});

test('malformed optional evidence denies approval without losing the surrounding order or config',()=>{
  for (const [parser,value] of [[parseBankEligibility,{canWithdraw:'true',reasonCode:null}],[parseBankSettlement,{...settlement(),status:'refunded'}]]) {
    assert.equal(readBankEvidence(parser,value),null);
  }
  assert.throws(()=>readBankEvidence(()=>{throw new Error('unexpected programming error');},{}),/unexpected programming error/);
});
