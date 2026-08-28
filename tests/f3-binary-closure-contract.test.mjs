import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const backend = path.resolve(repo, "..", "nexion-backend");
const appRoot = resolveNexionAppRoot({ adminRoot: repo });
const readPc = (relative) => readFileSync(path.join(repo, relative), "utf8");
const readBackend = (relative) => readFileSync(path.join(backend, relative), "utf8");

test("F3 PC exposes protected settlement closure without mocked money defaults", () => {
  const route = readPc("app/api/admin/teams/[...path]/route.ts");
  const client = readPc("lib/admin/f1-client.ts");
  const page = readPc("app/components/domain-views/f-tabs/f3-binary.tsx");

  assert.match(route, /parts\[1\] === "assignments" \|\| parts\[1\] === "settlements"/);
  assert.match(client, /f1Request<Record<string, unknown>>\("\/binary\/settlements"/);
  assert.match(client, /JSON\.stringify\(\{ ownerUserId, settlementDate, reason \}\)/);
  assert.doesNotMatch(client, /asText\(formula\.matchRate,\s*"10%"\)/);
  assert.doesNotMatch(client, /asText\(dailyCap\.currentLabel,\s*"\$5,000"\)/);
  assert.match(page, />执行结算</);
  assert.match(page, /前往 F5 补发 \/ 冲正/);
  assert.match(page, /aria-label="按结算状态筛选"/);
  assert.match(page, /aria-label="按用户群筛选"/);
  assert.doesNotMatch(page, /左轨|右轨|>gvResetCron</);
});

test("F3 periodic controls state their next-cycle, non-retroactive effect in confirmation", () => {
  const component = readPc("app/components/domain-views/f-tabs/f3-binary.tsx");
  const view = readPc("app/components/domain-views/f-view.tsx");

  assert.match(component, /completionCopy:\s*"保存后只影响下一周期结算，不回溯已计提。"/);
  assert.match(component, /改后对下一周期结算生效,不回溯已计提/);
  assert.match(view, /completionCopy=\{mc\.completionCopy\}/);
});

test("F3 backend consumes locked controls and publishes the shared commission event atomically", () => {
  const service = readBackend(
    "src/main/java/ffdd/opsconsole/team/application/BinaryCommissionSettlementService.java",
  );
  const policy = readBackend(
    "src/main/java/ffdd/opsconsole/team/application/BinarySettlementPolicyProvider.java",
  );
  const request = readBackend(
    "src/main/java/ffdd/opsconsole/team/dto/BinarySettlementRequest.java",
  );
  const appController = readBackend(
    "src/main/java/ffdd/opsconsole/team/web/AppBinaryController.java",
  );
  const appProjection = readBackend(
    "src/main/java/ffdd/opsconsole/team/application/AppBinaryProjectionService.java",
  );
  const migration = readBackend("scripts/migrations/20260727_f3_binary_settlement_closure.sql");

  for (const key of [
    "F.binary.spillover",
    "F.binary.settlePeriod",
    "F.binary.residualPolicy",
    "F.binary.gvResetCron",
  ]) {
    assert.match(policy, new RegExp(key.replaceAll(".", "\\.")));
  }
  assert.match(service, /autoPlaceMissing\(/);
  assert.match(service, /isSettlementDue\(settlementDate, policy\.settlePeriod\(\)\)/);
  assert.match(service, /"commission\.paid"/);
  assert.match(service, /insertPairResetCursorCas/);
  assert.match(service, /F3_PAIR_RESET_CURSOR_CAS_CONFLICT/);
  assert.match(service, /consumedMatchedBefore/);
  assert.match(request, /@NotBlank @Size\(min = 8, max = 200\) String reason/);
  assert.match(appController, /@GetMapping\("\/api\/team\/binary"\)/);
  assert.match(appController, /"USER"\.equals/);
  assert.match(appProjection, /mapper\.listPaidOrderCandidates/);
  assert.match(appProjection, /mapper\.countAssignmentsByLeg/);
  assert.match(appProjection, /GrowthRhythmSnapshot\.from/);
  assert.match(migration, /commission\.paid/);
  assert.match(migration, /F3BinarySettlement/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS nx_binary_volume_cursor/);
  assert.doesNotMatch(migration, /UPDATE nx_binary_volume_cursor/);
});

test("App remote F3 consumes the authenticated server snapshot and clears stale account facts", () => {
  const api = readFileSync(path.join(appRoot, "src/api/commission-config-api.ts"), "utf8");
  const store = readFileSync(path.join(appRoot, "src/store/commission.ts"), "utf8");
  const page = readFileSync(path.join(appRoot, "src/pages/team/binary.vue"), "utf8");
  const team = readFileSync(path.join(appRoot, "src/pages/team/team.vue"), "utf8");

  assert.match(api, /path: "\/api\/team\/binary"/);
  assert.match(api, /authenticated F3 snapshot|CanonicalBinaryState/);
  assert.match(store, /refreshCanonicalBinary/);
  assert.match(store, /binarySnapshot\.value = null/);
  assert.match(store, /events\.value = \[\]/);
  assert.match(page, /leftMonthVol = computed\(\(\) => remoteApiEnabled \? remoteTrackA\.value : network\.leftVolumeMonth\(\)\)/);
  assert.match(page, /rightMonthVol = computed\(\(\) => remoteApiEnabled \? remoteTrackB\.value : network\.rightVolumeMonth\(\)\)/);
  assert.match(page, /commission\.binarySnapshot\?\.trackA/);
  assert.match(team, /commission\.binarySnapshot/);
});
