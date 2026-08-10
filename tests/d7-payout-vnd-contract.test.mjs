import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const D7_VIEW = "app/components/domain-views/d-tabs/d7-payout-vnd.tsx";
const D7_CLIENT = "lib/admin/payout-vnd-client.ts";
const D7_LOCAL = "lib/admin/payout-vnd-local.ts";

test("D7 parameter management uses a real server client while the provider channel remains blocked", () => {
  const source = read(D7_VIEW);
  assert.match(source, /payout-vnd-client/);
  assert.match(source, /providerReady/);
  assert.match(source, /真实出款供应商未就绪/);
  assert.match(source, /loadPayoutVndConfig/);
  assert.ok(existsSync(path.join(ROOT, D7_CLIENT)));
  assert.ok(!existsSync(path.join(ROOT, D7_LOCAL)));
});

test("D7 writes use server CAS, reason, idempotency and never localStorage", () => {
  const view = read(D7_VIEW);
  const source = `${view}\n${read(D7_CLIENT)}`;
  assert.match(source, /expectedVersion/);
  assert.match(source, /reason/);
  assert.match(source, /idempotencyPrefix/);
  assert.match(source, /formatAdminApiError/);
  assert.match(source, /updatePayoutVndConfig/);
  assert.match(source, /togglePayoutVndChannel/);
  assert.match(source, /alignsToStep/);
  assert.match(source, /displayAdminError\(caught\)/);
  assert.equal((view.match(/const message = displayAdminError\(caught\);\s*await reload\(\);\s*setError\(message\);/g) ?? []).length, 2);
  assert.doesNotMatch(view, /setError\(caught instanceof Error/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.doesNotMatch(source, /saved locally|本地配置|local-history/i);
});

test("finance proxy exposes only the two explicit D7 backend resources", () => {
  const proxy = read("app/api/admin/finance/[...path]/route.ts");
  assert.match(proxy, /payout-vnd/);
  assert.match(proxy, /\["config", "channel"\]/);
  assert.match(proxy, /Idempotency-Key/);
});

test("D1-D6 never depend on a D7 client or retired local store", () => {
  const modules = ["d1-recon.tsx", "d2-withdrawals.tsx", "d3-treasury.tsx", "d4-ledger.tsx", "d5-params.tsx", "d6-fx.tsx"];
  for (const module of modules) {
    assert.doesNotMatch(read(`app/components/domain-views/d-tabs/${module}`), /payout-vnd-(?:local|client)/);
  }
});

test("D7 cross-domain links are gated by each target read authority", () => {
  const source = read(D7_VIEW);
  for (const authority of ["finance_d6_read", "finance_d2_read", "finance_d5_read", "platform_a2_read"]) {
    assert.match(source, new RegExp(`authorities\\.includes\\(\"${authority}\"\\)`));
  }
});

test("D7 registry and header describe the server parameter capability without claiming a live payout rail", () => {
  const source = `${read("lib/admin/registry/d.ts")}\n${read("app/components/domain-views/d-view.tsx")}`;
  assert.match(source, /服务端权威整组配置/);
  assert.match(source, /真实出款轨仍关闭/);
  assert.doesNotMatch(source, /只读 HOLD|本页不保存|通道停用不影响在途单|调整只影响新提现单/);
});
