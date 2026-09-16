import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBankCapability, parseBankVerification, parseBankSettlement, readBankEvidence, bankEvidenceTime } from '../lib/admin/bank-payout-evidence.ts';

const verification = () => ({ verificationStatus:'unavailable',payoutCapability:'unknown',ownershipStatus:'unknown',accountType:'unknown',reasonCode:'BANK_VERIFICATION_PROVIDER_UNAVAILABLE',checkedAt:null,expiresAt:null,evidenceRef:null,capabilityVersion:null,canWithdraw:false });
const capability = () => ({ status:'unavailable',provider:null,country:'VN',currency:'VND',recipientIdentifier:'bank_account',accountVerificationAvailable:false,ownershipVerificationAvailable:false,reasonCode:'BANK_VERIFICATION_PROVIDER_UNAVAILABLE',capabilityVersion:null,checkedAt:null });
const settlement = () => ({ status:'unconfirmed',evidenceRef:null,providerOrderId:null,providerStatus:null,checkedAt:null,amountUsdt:null });
test('missing old-server evidence remains unknown rather than enabling payments', () => {
  assert.equal(parseBankCapability(undefined),null); assert.equal(parseBankVerification(null),null); assert.equal(parseBankSettlement(undefined),null);
  assert.equal(parseBankVerification(verification()).canWithdraw,false);
});
test('transport readiness cannot substitute for account and ownership verification', () => {
  assert.equal(parseBankCapability(capability()).status,'unavailable');
  assert.throws(()=>parseBankCapability({...capability(),status:'ready'}),/EVIDENCE_INVALID/);
  assert.throws(()=>parseBankCapability({...capability(),accountVerificationAvailable:'true'}),/EVIDENCE_INVALID/);
  assert.throws(()=>parseBankVerification({...verification(),canWithdraw:true}),/EVIDENCE_INVALID/);
  const valid={...verification(),verificationStatus:'verified',payoutCapability:'supported',ownershipStatus:'matched',accountType:'payment_account',canWithdraw:true,checkedAt:'2026-09-16T01:00:00Z',expiresAt:'2026-09-17T01:00:00Z',evidenceRef:'verification-1',capabilityVersion:'v1'};
  assert.equal(parseBankVerification(valid).canWithdraw,true);
  for(const change of [{ownershipStatus:'mismatched'},{accountType:'credit_card'},{payoutCapability:'unsupported'},{evidenceRef:null}]) assert.throws(()=>parseBankVerification({...valid,...change}),/EVIDENCE_INVALID/);
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
  for (const [parser,value] of [[parseBankCapability,{...capability(),status:'ready'}],[parseBankVerification,{...verification(),canWithdraw:true}],[parseBankSettlement,{...settlement(),status:'refunded'}]]) {
    assert.equal(readBankEvidence(parser,value),null);
  }
  assert.throws(()=>readBankEvidence(()=>{throw new Error('unexpected programming error');},{}),/unexpected programming error/);
});
