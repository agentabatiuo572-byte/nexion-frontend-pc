import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "..");
const backend = path.resolve(repo, "..", "nexion-backend");

async function source(relative) {
  return readFile(path.join(backend, relative), "utf8");
}

test("F5 direct financial endpoints reject a single-authority call without approved A2 replay", async () => {
  const controller = await source("src/main/java/ffdd/opsconsole/team/web/F5CommissionController.java");
  const service = await source("src/main/java/ffdd/opsconsole/team/application/F5CommissionService.java");

  for (const endpoint of [
    '@PostMapping("/commissions/{commissionId}/reverse")',
    '@PostMapping("/commissions/reissue")',
    '@PostMapping("/users/{userId}/commission/suspend")',
  ]) {
    assert.match(controller, new RegExp(`${endpoint.replace(/[{}()[\].?+*^$|]/g, "\\$&")}[\\s\\S]{0,500}service\\.(reverse|reissue|suspend)\\(`));
  }
  for (const method of ["reverse", "reissue", "suspend"]) {
    assert.match(service, new RegExp(`public ApiResult<Map<String, Object>> ${method}[\\s\\S]{0,400}requireApprovedReplay\\(\\)`));
  }
  assert.match(service, /!A2ReplayContext\.isReplaying\(\) \|\| !StringUtils\.hasText\(A2ReplayContext\.operationId\(\)\)/);
  assert.match(service, /ApiResult\.fail\(409, "A2_CONFIRMATION_REQUIRED"\)/);
});

test("F5 replay checks the approved operation, target, reason, and idempotency key before exactly-once execution", async () => {
  const service = await source("src/main/java/ffdd/opsconsole/team/application/F5CommissionService.java");
  const team = await source("src/main/java/ffdd/opsconsole/team/application/OpsTeamService.java");
  const guard = await source("src/main/java/ffdd/opsconsole/platform/application/AuditReplayBusinessPermissionGuard.java");

  for (const op of ["f5_commission_reverse", "f5_commission_reissue", "f5_commission_suspension"]) {
    assert.match(team, new RegExp(`case "${op}"`));
    assert.match(guard, new RegExp(`"${op}"`));
  }
  assert.match(guard, /canonicalF5CommissionIds/);
  assert.match(guard, /canonicalF5Kinds/);
  assert.match(guard, /commission_user_kind/);
  assert.match(service, /reason\(request == null \? null : request\.reason\(\)\)/);
  assert.match(service, /idempotencyKey/);
  assert.match(service, /requestHash\(/);
  assert.match(service, /executeIdempotent\(/);
});
