import assert from 'node:assert/strict';
import test from 'node:test';
import { eventRuleDraftRules, eventRuleFields, eventRegionText, parseEventRegions, eventRuleMissingLabel, eventRuleReadinessText } from '../lib/admin/event-rule-form.ts';

test('each event kind edits its actual rule fields, with separate boost actions', () => {
  assert.deepEqual(eventRuleFields({kind:'boost', rules:{action:'CHECKIN_MULTIPLIER'}}).map(f=>f.key), ['multiplier','weekdays','timeZone','budgetNex']);
  assert.deepEqual(eventRuleFields({kind:'boost', rules:{action:'REINVEST_TICKETS'}}).map(f=>f.key), ['thresholdUsdt','ticketsPerThreshold','ticketBudget']);
  assert.equal(eventRuleFields({kind:'referral',rules:{}}).some(f=>f.key==='giftProductNo'),true);
  assert.deepEqual(eventRuleFields({kind:'seasonal',rules:{}}).map(f=>f.key),['voucherId','promotionActivityId','extraGenesisTickets','ticketBudget']);
  assert.equal(eventRuleFields({kind:'seasonal',rules:{}})[0].type,'voucher');
  assert.equal(eventRuleFields({kind:'discount',rules:{}}).some(f=>f.key==='voucherId'),false);
  assert.deepEqual(eventRuleFields({kind:'wheel',rules:{}}),[]);
});
test('regional inputs round trip without dropping countries and reject ambiguous rows', () => {
  const regions=[{name:'SEA',countries:['VN','TH']},{name:'EU',countries:['DE','FR']}];
  assert.deepEqual(parseEventRegions(eventRegionText(regions)),regions);
  assert.deepEqual(parseEventRegions('SEA: vn, th'),[regions[0]]);
  assert.throws(()=>parseEventRegions('SEA VN'),/每行填写/);
  assert.throws(()=>parseEventRegions('SEA: Vietnam'),/每行填写/);
  assert.equal(eventRuleMissingLabel('giftProductNo'),'赠送设备商品编号');
  assert.equal(eventRuleMissingLabel('private-backend-code'),'参与条件或奖励配置');
});

test('empty holding and regional drafts include their fixed settlement contract', () => {
  assert.deepEqual(eventRuleDraftRules({kind:'holding',rules:{minNex:1000}}),{minNex:1000,allocation:'EQUAL'});
  assert.deepEqual(eventRuleDraftRules({kind:'regional',rules:{}}),{allocation:'PROPORTIONAL_VOLUME',metric:'PAID_ORDER_USDT'});
});

test('fixed boost activities cannot be configured as the other activity', () => {
  assert.equal(eventRuleDraftRules({eventCode:'evt-weekend-double-nex',kind:'boost',rules:{}}).action,'CHECKIN_MULTIPLIER');
  assert.equal(eventRuleDraftRules({eventCode:'evt-reinvest-bonus',kind:'boost',rules:{action:'CHECKIN_MULTIPLIER'}}).action,'REINVEST_TICKETS');
});

test('expired activated rules show ended status while draft readiness and enablement remain separate', () => {
  const now = Date.parse('2026-10-26T07:00:00Z');
  const ended = {rulesLocked:true,endsAt:'2026-10-26T07:00:00Z',readiness:{ready:false,missing:['endsAt']}};
  assert.equal(eventRuleReadinessText(ended,now),'活动已结束，参与条件与有效期保持原配置。');
  assert.equal(eventRuleReadinessText({...ended,rulesLocked:false},now),'待补齐：结束时间。');
  assert.equal(eventRuleReadinessText({...ended,endsAt:null},now),'待补齐：结束时间。');
  assert.equal(eventRuleReadinessText({...ended,endsAt:'2026-10-26T07:00:01Z',readiness:{ready:true,missing:[]}},now),'配置已满足开启条件。');
  assert.deepEqual(ended.readiness,{ready:false,missing:['endsAt']});
});
