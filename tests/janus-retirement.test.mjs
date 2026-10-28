import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import test from 'node:test';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('retired K6 cannot be navigated to or proxied from the admin application', () => {
  assert.doesNotMatch(read('lib/nav/console-nav.ts'), /janus-c2|id: "K6"/);
  for (const path of ['app/api/admin/janus/[...path]/route.ts','app/components/domain-views/k-tabs/k6-janus-c2.tsx','lib/admin/k6-client.ts','lib/store/admin/janus-c2-store.ts']) assert.equal(existsSync(new URL('../' + path, import.meta.url)), false, path);
  assert.doesNotMatch(read('app/components/domain-views/k-view.tsx'), /Janus|K6/);
});
test('phone calibration remains while E6 has no pairing or installer editor', () => {
  const page = read('app/components/domain-views/e-tabs/e6-compute-config.tsx');
  assert.match(page, /PhoneCalibrationPanel/); assert.match(page, /PhoneReplacementPolicyPanel/);
  assert.doesNotMatch(page, /computeShareEnabled|gpuTier_|downloadUrl|Janus/);
  const manifest = JSON.parse(read('docs/ops-actions.manifest.json'));
  assert.equal(manifest.activeLeafCoverage.K6, undefined);
  assert.equal(manifest.rows.some(row => ['OPS-K-15','OPS-K-16','OPS-K-17'].includes(row.id)), false);
});
test('browser fixtures cannot recreate the retired K6 menu or permissions', () => {
  for (const file of readdirSync(new URL('./e2e/', import.meta.url)).filter(name => name.endsWith('.ts'))) {
    const source = read('tests/e2e/' + file).replace(/expect\(authorities\)\.not\.toContain\("risk_k6_write"\);/g, '');
    assert.doesNotMatch(source, /["']K6["']|risk_k6_|janusReportPayload|nx_janus_/, file);
  }
  const smoke = read('tests/e2e/hifi-merge-b2e0a24-3c72116-live.spec.ts');
  assert.match(smoke, /expect\(janusEntry\)\.toHaveCount\(0\)/);
  assert.match(smoke, /expect\(reportResponse\.status\(\)\)\.toBe\(410\)/);
  assert.match(smoke, /expect\(securityResponse\.status\(\), securityPayload\.message\)\.toBe\(200\)/);
});
