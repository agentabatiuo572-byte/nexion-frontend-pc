import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerConversations, replyTimeout } from '../lib/admin/customer-conversations.ts';
test('one row per customer retains all unread and earliest unhandled deadline',()=>{
 const rows=customerConversations([
  {id:'old',customerId:'42',status:'closed',lastTs:10,unread:2,pendingReplyCount:1,pendingReplySince:1000},
  {id:'current',customerId:'42',status:'open',lastTs:20,unread:3,pendingReplyCount:2,pendingReplySince:5000},
  {id:'other',customerId:'43',status:'open',lastTs:30,unread:7,pendingReplyCount:null}
 ]);
 assert.equal(rows.length,2);assert.equal(rows[1].id,'current');assert.equal(rows[1].unread,5);assert.equal(rows[1].pendingReplyCount,3);assert.equal(rows[1].pendingReplySince,1000);assert.equal(rows[0].pendingReplyCount,null);
});
test('deadline boundary is precise and malformed time is not an overdue claim',()=>{
 assert.equal(replyTimeout(1000,300999,5,10),'');assert.equal(replyTimeout(1000,301000,5,10),'已超时 · 待处理');assert.equal(replyTimeout(1000,601000,5,10),'严重超时 · 待处理');assert.equal(replyTimeout(NaN,900000,5,10),'');
});
