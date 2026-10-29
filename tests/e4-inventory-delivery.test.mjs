import test from 'node:test';
import assert from 'node:assert/strict';
import { parseE4OrderPage } from '../lib/admin/e456-overview-contract.ts';
import { stateLabel, ostate } from '../app/components/domain-views/e-tabs/data.ts';

test('E4 preserves a completed warehouse delivery and labels it without claiming activation', () => {
  const page = parseE4OrderPage({ total: 1, pageNum: 1, pageSize: 20, records: [{
    orderNo: 'UPGRADE-INVENTORY-1', userNo: 'U001', skuName: 'UVELBox Pro', amount: 100,
    state: 'inventory', dcLocation: 'Cloud-Global', ageText: '1分钟',
  }] });
  assert.equal(page.records[0].state, 'inventory');
  assert.equal(stateLabel(page.records[0].state), '已入库');
  assert.equal(ostate[page.records[0].state], 'ok');
  assert.notEqual(stateLabel(page.records[0].state), stateLabel('activated'));
});
