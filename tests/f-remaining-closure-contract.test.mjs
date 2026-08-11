import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const pc = process.cwd();
const backend = path.resolve(pc, "../nexion-backend");
const readPc = (file) => fs.readFileSync(path.join(pc, file), "utf8");
const readBackend = (file) => fs.readFileSync(path.join(backend, file), "utf8");

test("F compound edits are one A2 command and the backend replay is transactional", () => {
  const view = readPc("app/components/domain-views/f-view.tsx");
  const registry = readPc("lib/admin/high-ops-registry.ts");
  const service = readBackend("src/main/java/ffdd/opsconsole/team/application/OpsTeamService.java");
  assert.match(view, /updateFConfigBatch/);
  assert.match(registry, /op:\s*"f_config_batch"/);
  assert.match(service, /case\s+"f_config_batch"/);
  assert.match(service, /@Transactional\(rollbackFor\s*=\s*Exception\.class\)[\s\S]*replay\(/);
});

test("F business keys have authoritative consumers instead of UI-only persistence", () => {
  const service = readBackend("src/main/java/ffdd/opsconsole/team/application/OpsTeamService.java");
  const unilevel = readBackend("src/main/java/ffdd/opsconsole/team/application/UnilevelCommissionService.java");
  const pool = readBackend("src/main/java/ffdd/opsconsole/team/application/LeadershipPoolService.java");
  const scheduler = readBackend("src/main/java/ffdd/opsconsole/team/application/LeadershipPoolSettleScheduler.java");
  const guard = readBackend("src/main/java/ffdd/opsconsole/team/application/LeadershipPoolConfigGuard.java");
  assert.doesNotMatch(service, /bridge failed; keep ui value/);
  assert.match(service, /"F\.cooldown"\.equals\(key\)\s*\?\s*COMMISSION_COOLING_DAYS_KEY/);
  assert.match(unilevel, /mergeExitMaxPct/);
  assert.match(pool, /F\.pool\.top1MaxPct/);
  assert.match(pool, /F\.pool\.top5MaxPct/);
  assert.match(pool, /F\.pool\.periodPrize/);
  assert.match(pool, /F\.leaderboard\.poolUsd/);
  assert.match(pool, /F\.leaderboard\.minUsd/);
  assert.match(pool, /F\.leaderboard\.paused/);
  assert.match(guard, /team\.ui\.F\.pool\.settleCron/);
  assert.match(guard, /team\.ui\.F\.pool\.configVersion/);
  assert.match(scheduler, /settlementConfigGuard\.requireValid/);
  assert.doesNotMatch(scheduler, /orElse\("59 23 \* \* 0"\)/);
  assert.match(pool, /team\.runtime\.F\.leaderboard\.lastSettled\./);
  assert.match(pool, /catchUpDaily/);
  assert.match(pool, /catchUpWeekly/);
  assert.match(pool, /catchUpMonthly/);
  assert.match(pool, /settleApprovedLeaderboardPeriod\(String period, String requestedPeriodKey/);
});

test("F4 uses exact quota, ambassador and leaderboard objects", () => {
  const mapper = readBackend("src/main/java/ffdd/opsconsole/team/mapper/TeamCommissionMapper.java");
  const f4 = readPc("app/components/domain-views/f-tabs/f4-ops.tsx");
  const registry = readPc("lib/admin/high-ops-registry.ts");
  assert.match(mapper, /recycleHardwareQuotaUsage/);
  assert.match(mapper, /updateHardwareQuotaTierCas/);
  assert.match(mapper, /monthly_quota\s*=\s*#\{expectedMonthlyQuota\}/);
  assert.match(f4, /expectedVersion:\s*quota\.cap/);
  assert.match(registry, /expectedMonthlyQuota:\s*Number\(ctx\.expectedVersion\)/);
  assert.match(mapper, /ambassadorApplications/);
  assert.match(mapper, /insertLeaderboardMemberAction/);
  assert.doesNotMatch(f4, /F\.ambassador\.q3-2025\.status/);
  assert.match(f4, /quota\.id/);
  assert.match(f4, /application\.id/);
  assert.match(f4, /row\.memberUserId/);
});

test("SKU rewards enter fulfillment and F5 exports the server-side filtered full set", () => {
  const dispatcher = readBackend("src/main/java/ffdd/opsconsole/team/application/VRankRewardDispatcher.java");
  const fulfillment = readBackend("src/main/java/ffdd/opsconsole/team/application/VRankSkuFulfillmentService.java");
  const f5 = readPc("app/components/domain-views/f-tabs/f5-audit.tsx");
  const client = readPc("lib/admin/f1-client.ts");
  const verifier = readPc("lib/admin/f5-export-verifier.ts");
  const proxy = readPc("app/api/admin/teams/[...path]/route.ts");
  const exportService = readBackend("src/main/java/ffdd/opsconsole/team/application/F5CommissionService.java");
  assert.match(dispatcher, /enqueueVRankSkuFulfillment/);
  assert.doesNotMatch(dispatcher, /dispatchSkuStub/);
  assert.match(fulfillment, /reserveSkuStock/);
  assert.match(fulfillment, /hasGrantedEntitlement/);
  assert.match(fulfillment, /grantSkuPayout/);
  assert.match(f5, /恢复奖种/);
  assert.match(f5, /导出筛选全量 CSV/);
  assert.match(client, /\/api\/admin\/teams\/commissions\/export/);
  assert.match(client, /f1StableWrite\("f5-export", fingerprint/);
  assert.match(client, /reason is audit metadata/);
  assert.match(client, /body:\s*JSON\.stringify\(\{\s*\.\.\.filters, reason\s*\}\)/);
  assert.match(client, /"Idempotency-Key": commandKey/);
  assert.match(client, /verifyF5CsvArtifact/);
  assert.match(verifier, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(proxy, /upstream\.arrayBuffer\(\)/);
  assert.match(proxy, /"Content-Disposition", "X-Export-Id", "X-Export-Row-Count", "X-Export-Byte-Size",\s*\n\s*"X-Export-Sha256", "X-Export-Redacted"/);
  assert.match(exportService, /EXPORT_MAX_ROWS\s*=\s*50_000L/);
  assert.match(exportService, /queryExportEvents/);
  assert.match(exportService, /F5_COMMISSION_CSV_EXPORTED/);
});
