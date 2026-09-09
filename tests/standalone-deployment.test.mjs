import test from 'node:test';
import assert from 'node:assert/strict';

test('deployment opts into standalone without changing ordinary local builds or security headers', async () => {
  delete process.env.NEXGRID_STANDALONE_BUILD;
  const ordinary = (await import('../next.config.ts?ordinary')).default;
  process.env.NEXGRID_STANDALONE_BUILD = '1';
  try {
    const deploy = (await import('../next.config.ts?deploy')).default;
    assert.equal(ordinary.output, undefined);
    assert.equal(deploy.output, 'standalone');
    assert.deepEqual(await deploy.headers(), await ordinary.headers());
    assert.deepEqual(await deploy.redirects(), await ordinary.redirects());
  } finally { delete process.env.NEXGRID_STANDALONE_BUILD; }
});
