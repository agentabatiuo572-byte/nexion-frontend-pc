import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const pcRoot = process.cwd();
const backendRoot = path.resolve(pcRoot, "..", "nexion-backend");
const appRoot = resolveNexionAppRoot({ adminRoot: pcRoot });
const read = (root, relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("H7 PC writes carry CAS and expose inventory, grant metrics and revocation", () => {
  const client = read(pcRoot, "lib/admin/h-client.ts");
  const page = read(pcRoot, "app/components/domain-views/h-tabs/h7-voucher-config.tsx");
  const form = read(pcRoot, "app/components/domain-views/design-kit.tsx");
  assert.match(client, /expectedVersion/);
  assert.match(client, /grants\/revoke-available/);
  assert.match(page, /issuanceLimit/);
  assert.match(page, /issuedCount/);
  assert.match(page, /redeemedCount/);
  assert.match(page, /撤销未核销/);
  assert.match(page, /H7_VOUCHER_RESPONSE_INVALID/);
  assert.match(form, /发行上限须为 0-10000000 的整数/);
});

test("H7 backend serializes issuance, rejects stale writes and preserves claimed definitions", () => {
  const mapper = read(backendRoot, "src/main/java/ffdd/opsconsole/growth/mapper/GrowthVoucherMapper.java");
  const grant = read(backendRoot, "src/main/java/ffdd/opsconsole/growth/application/GrowthVoucherGrantFacadeAdapter.java");
  const lifecycle = read(backendRoot, "src/main/java/ffdd/opsconsole/growth/mapper/AppGrowthLifecycleMapper.java");
  const service = read(backendRoot, "src/main/java/ffdd/opsconsole/growth/application/OpsGrowthService.java");
  const migration = read(backendRoot, "scripts/migrations/20260727_h7_voucher_inventory_cas.sql");
  assert.match(mapper, /version = #\{expectedVersion\}/);
  assert.match(mapper, /revokeAvailableGrants/);
  assert.match(grant, /H7_VOUCHER_INVENTORY_EXHAUSTED/);
  assert.match(grant, /replayOrConflict\(request\)/);
  assert.doesNotMatch(lifecycle, /v\.is_deleted\s*=\s*0/);
  assert.doesNotMatch(lifecycle, /v\.status\s*=\s*'active'/);
  assert.match(service, /H7_VOUCHER_STALE/);
  assert.match(service, /OBJECT_LOCKED_BY_A2/);
  assert.match(migration, /issuance_limit/);
  assert.match(migration, /version/);
});

test("H7 App remote mode uses canonical claim and order redemption only", () => {
  const api = read(appRoot, "src/api/voucher-api.ts");
  const store = read(appRoot, "src/store/voucher.ts");
  const checkout = read(appRoot, "src/pages/store/checkout.vue");
  const runtime = read(appRoot, "src/api/runtime.ts");
  assert.match(api, /GET[\s\S]*\/api\/vouchers/);
  assert.match(api, /\/api\/vouchers\/\$\{encodeURIComponent/);
  assert.match(store, /remoteApiEnabled/);
  assert.match(store, /createRemoteAccountEpoch/);
  assert.match(store, /remoteRequestIsCurrent/);
  assert.match(store, /await voucherApi\.claim/);
  assert.match(store, /return refreshRemote\(\)/);
  assert.doesNotMatch(store, /pendingClaimKeys/);
  assert.match(checkout, /voucherId: requestedVoucherId/);
  assert.match(checkout, /created\.voucherId !== requestedVoucherId/);
  assert.match(checkout, /receipt\.voucherId !== requestedVoucherId/);
  assert.match(checkout, /if \(requestedVoucherId\) await voucher\.refreshRemote\(\)/);
  assert.match(runtime, /createVoucherApi/);
});
