import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const carrier = readFileSync(
  new URL("./e2e/k1-live-acceptance-20260722.spec.ts", import.meta.url),
  "utf8",
);

test("K1 lifecycle keeps cluster state in K1 but reads account state from an independent visible C2 checker", () => {
  const lifecycleStart = carrier.indexOf('test("K1 RISK 直调被拒');
  const lifecycleEnd = carrier.indexOf('test("K1 503', lifecycleStart);
  const lifecycle = carrier.slice(lifecycleStart, lifecycleEnd);

  assert.match(carrier, /K1_C2_PERMISSION_FIXTURE_PATH/);
  assert.match(carrier, /accounts\?\.readonly/);
  assert.match(lifecycle, /await openC2FromSidebar\(c2Page\)/);
  assert.match(lifecycle, /expect\(cluster\.status\)\.toBe\("frozen"\)/);
  assert.match(lifecycle, /expect\(cluster\.status\)\.toBe\("released"\)/);
  assert.match(lifecycle, /readC2AccountStatuses\(c2Page/);
  assert.match(carrier, /\/api\/admin\/users\/account-actions\/accounts\/\$\{encodeURIComponent\(userNo\)\}/);
  assert.match(carrier, /已按服务器查询结果打开该用户的 C2 处置上下文/);
  assert.doesNotMatch(lifecycle, /nodeStatuses\(/);
});

test("K1 carrier proves A2 replay count and preserves exact finally cleanup", () => {
  assert.match(carrier, /accountsFrozen/);
  assert.match(carrier, /toBe\(3\)/);
  assert.match(carrier, /idempotencyBaseline/);
  assert.match(carrier, /K1_PARAM:maxSignupPerIp24h/);
  assert.match(carrier, /K1_CLUSTER_STATUS:\$\{CLUSTER_ID\}/);
  assert.match(carrier, /residual !== "0,0,0,0,0"/);
});
