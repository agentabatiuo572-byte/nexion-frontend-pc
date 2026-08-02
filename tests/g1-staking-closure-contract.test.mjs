import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const OPS_ROOT = path.resolve(import.meta.dirname, "..");
const APP_ROOT = resolveNexionAppRoot({ adminRoot: OPS_ROOT });
const BACKEND_ROOT = path.resolve(OPS_ROOT, "..", "nexion-backend");

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

test("G1 admin writes are immediate server commands with least-privilege controls", () => {
  const page = read(OPS_ROOT, "app/components/domain-views/g-tabs/g1-staking.tsx");
  const client = read(OPS_ROOT, "lib/admin/g1-client.ts");

  assert.doesNotMatch(page, /usePropose|findHighOp/);
  assert.match(page, /updateG1StakingPoolParam/);
  assert.match(page, /finprod_g1_apy_write/);
  assert.match(page, /finprod_g1_penalty_write/);
  assert.match(page, /finprod_g1_min_write/);
  assert.match(page, /finprod_g1_kill_toggle/);
  assert.match(page, /kind:\s*"number"[\s\S]*min:\s*0[\s\S]*max:\s*300/);
  assert.match(page, /amplifiesWhen:\s*"increase"/);
  assert.match(page, /amplifiesWhen:\s*"decrease"/);
  assert.match(page, /coverage:\s*\{\s*coverageRatio:\s*coverage\.coverageRatio,\s*redlinePct:\s*coverage\.redlinePct\s*\}/);
  assert.match(page, /disallowCurrent:\s*true/);
  assert.match(page, /triggerBasis/);
  assert.match(page, /dispositionPlan/);
  assert.match(page, /href="\/emergency\/kill-switch"/);
  assert.match(client, /Idempotency-Key/);
  assert.match(client, /triggerBasis, dispositionPlan/);
});

test("G1 app state is a projection of authenticated server APIs", () => {
  const store = read(APP_ROOT, "src/store/staking.ts");
  const service = read(APP_ROOT, "src/api/staking-api.ts");
  const page = read(APP_ROOT, "src/pages/staking/staking.vue");
  const sheet = read(APP_ROOT, "src/components/staking/stake-sheet.vue");
  const repurchase = read(APP_ROOT, "src/pages/me/wallet-repurchase.vue");

  assert.doesNotMatch(store, /localStorage|uni\.setStorage|Math\.random/);
  assert.match(store, /fetchStakingPools/);
  assert.match(store, /fetchStakingPositions/);
  assert.match(store, /openStakingPosition/);
  assert.match(store, /claimStakingPosition/);
  assert.match(store, /earlyWithdrawStakingPosition/);
  assert.match(service, /\/api\/config\/staking\/pools/);
  assert.match(service, /\/api\/stakes/);
  assert.match(service, /idempotencyKey/);
  assert.doesNotMatch(page, /creditBalance|bills\.add|markMatured/);
  assert.doesNotMatch(sheet, /debitBalance|bills\.add|STAKING_APY|STAKING_PENALTY|STAKING_MIN/);
  assert.match(page, /staking\.refreshAll/);
  assert.match(sheet, /staking\.openStakingPosition/);
  assert.doesNotMatch(repurchase, /debitBalance|bills\.add|staking\.stake|openStakingPosition/);
  assert.match(repurchase, /useRepurchase/);
  assert.match(repurchase, /repurchase\.open/);
  assert.doesNotMatch(repurchase, /useStaking|staking\.stake|openStakingPosition/);
});

test("G1 user mutations are transactional, idempotent and emit durable evidence", () => {
  const service = read(BACKEND_ROOT, "src/main/java/ffdd/opsconsole/market/application/AppStakingService.java");
  const controller = read(BACKEND_ROOT, "src/main/java/ffdd/opsconsole/market/web/AppStakingController.java");

  assert.match(service, /@Transactional[\s\S]*ApiResult<Map<String, Object>> open/);
  assert.match(service, /idempotency\.execute/);
  assert.match(service, /debitWallet/);
  assert.match(service, /insertPosition/);
  assert.match(service, /insertLedger/);
  assert.match(service, /publishUserEvent/);
  assert.match(service, /recordRequiredForTrustedActor/);
  assert.match(service, /STAKING_POOL_KILLED/);
  assert.match(controller, /@RequestHeader\("Idempotency-Key"\)/);
});

test("G1 admin commands are durable and recovery remains owned by J1", () => {
  const command = read(BACKEND_ROOT, "src/main/java/ffdd/opsconsole/market/application/G1AdminCommandService.java");
  const market = read(BACKEND_ROOT, "src/main/java/ffdd/opsconsole/market/application/OpsNexMarketService.java");
  const mapper = read(BACKEND_ROOT, "src/main/java/ffdd/opsconsole/market/mapper/StakingMapper.java");
  const migration = read(BACKEND_ROOT, "scripts/migrations/20260722_g1_admin_staking_closure.sql");

  assert.match(command, /@Transactional/);
  assert.match(command, /idempotency\.execute/);
  assert.match(command, /admin\.staking_pool_config_changed/);
  assert.match(command, /admin\.staking_pool_enabled_changed/);
  assert.match(command, /admin\.staking_pool_killed/);
  assert.match(command, /G1_RESTORE_MUST_USE_J1/);
  assert.match(command, /slashOpenPositionsByTier/);
  assert.match(market, /auditRequired\("G1_STAKING_POOL_PARAM_CHANGED"/);
  assert.match(mapper, /status='SLASHED'/);
  assert.match(migration, /'100%',94/);
  assert.match(migration, /'100%',96/);
});

test("G1 open-position KPI excludes closed terminal states", () => {
  const market = read(BACKEND_ROOT, "src/main/java/ffdd/opsconsole/market/application/OpsNexMarketService.java");
  assert.match(market, /"positionCount",\s*pendingCount\s*\+\s*activeCount\s*\+\s*matureCount/);
  assert.doesNotMatch(market, /"positionCount",[\s\S]{0,100}claimedCount/);
});

test("G1 operation confirmation mirrors directional B1 blocking without blocking tightening", () => {
  const modal = read(OPS_ROOT, "app/components/domain-views/design-kit.tsx");
  const shell = read(OPS_ROOT, "app/components/domain-views/g-view.tsx");
  assert.match(modal, /amplifiesWhen\?:\s*"increase"\s*\|\s*"decrease"/);
  assert.match(modal, /effectiveAmplifies/);
  assert.match(modal, /effectiveAmplifies\s*&&\s*coverage\s*&&\s*coverage\.coverageRatio\s*<\s*coverage\.redlinePct/);
  assert.match(shell, /coverage=\{mc\.coverage\}/);
});
