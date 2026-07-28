import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const pcRoot = process.cwd();
const backendRoot = path.resolve(pcRoot, "..", "nexion-backend");

function read(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("F4 PC exposes A2 settlement without a direct money mutation", () => {
  const view = read(pcRoot, "app/components/domain-views/f-view.tsx");
  const tab = read(pcRoot, "app/components/domain-views/f-tabs/f4-ops.tsx");
  const registry = read(pcRoot, "lib/admin/high-ops-registry.ts");
  const route = read(pcRoot, "app/api/admin/teams/[...path]/route.ts");

  assert.match(tab, /提前结算本周池/);
  assert.match(tab, /ctx\.proposeF4Settlement\(reason\)/);
  assert.match(view, /findHighOp\("f4_pool_settle"\)/);
  assert.match(view, /sourceDomain:\s*"F4"/);
  assert.match(registry, /op:\s*"f4_pool_settle"/);
  assert.match(registry, /targetType:\s*"leadership_pool_settlement"/);
  assert.match(route, /leadership-pool\/settle/);
});

test("F4 backend has one source of truth, CAS, D4, A4 and A2 replay", () => {
  const service = read(backendRoot, "src/main/java/ffdd/opsconsole/team/application/LeadershipPoolService.java");
  const mapper = read(backendRoot, "src/main/java/ffdd/opsconsole/team/mapper/TeamCommissionMapper.java");
  const team = read(backendRoot, "src/main/java/ffdd/opsconsole/team/application/OpsTeamService.java");
  const guard = read(backendRoot, "src/main/java/ffdd/opsconsole/platform/application/AuditReplayBusinessPermissionGuard.java");

  assert.match(service, /team\.ui\.F\.pool\.ratio/);
  assert.doesNotMatch(service, /team\.ui\.F\.pool\.injectRate/);
  assert.match(service, /team\.ui\.F\.pool\.unlockVRank/);
  assert.match(service, /team\.ui\.F\.pool\.monthlyCap/);
  assert.match(service, /lockLeadershipSettlementMutex/);
  assert.match(mapper, /FOR UPDATE/);
  assert.match(mapper, /uk_f4_settlement_week|nx_team_f4_settlement_mutex/);
  assert.match(service, /STATUS_UNLOCKED,\s*0/);
  assert.match(service, /"SUCCESS"/);
  assert.match(service, /"commission\.paid"/);
  assert.match(service, /F4_LEADERSHIP_POOL_SETTLED/);
  assert.match(service, /A2_CONFIRMATION_REQUIRED/);
  assert.match(team, /case "f4_pool_settle"/);
  assert.match(guard, /case "f4_pool_settle" -> "network_f4_pool_fund"/);
});

test("F4 visible operations disclose the cross-domain contract", () => {
  const tab = read(pcRoot, "app/components/domain-views/f-tabs/f4-ops.tsx");
  for (const marker of ["A2", "A4", "B1", "D4", "F5", "CAS"]) {
    assert.match(tab, new RegExp(marker));
  }
  assert.match(tab, /补发、冲正、冻结在 F5/);
});
