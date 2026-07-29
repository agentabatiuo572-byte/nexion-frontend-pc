import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pcRoot = new URL("../", import.meta.url);
const backendRoot = new URL("../../nexion-backend/", import.meta.url);
const eView = readFileSync(new URL("app/components/domain-views/e-view.tsx", pcRoot), "utf8");
const registry = readFileSync(new URL("lib/admin/high-ops-registry.ts", pcRoot), "utf8");
const guard = readFileSync(new URL(
  "src/main/java/ffdd/opsconsole/platform/application/AuditReplayBusinessPermissionGuard.java",
  backendRoot,
), "utf8");
const guardTest = readFileSync(new URL(
  "src/test/java/ffdd/opsconsole/platform/application/AuditReplayBusinessPermissionGuardTest.java",
  backendRoot,
), "utf8");

test("E6 批量提案的展示对象与多锁都由排序后的 command values 键生成", () => {
  assert.match(
    eView,
    /obj:\s*mc\.paramKeys\.map\(\(\{\s*paramKey\s*\}\)\s*=>\s*paramKey\)\.sort\(\)\.join\(","\)/,
  );
  assert.match(
    registry,
    /Object\.keys\(\(ctx\.values as Record<string,\s*unknown>\)\s*\?\?\s*\{\}\)\s*\.sort\(\)\s*\.map\(\(key\)\s*=>\s*\(\{\s*domain:\s*"E",\s*type:\s*"e6_compute_config",\s*id:\s*key\s*\}\)\)/s,
  );
});

test("delegated E6 batch 只接受白名单非空 values 与全等 canonical targets", () => {
  assert.match(guard, /case "e6_compute_config_batch" -> computeConfigBatchDescriptor\(params\)/);
  assert.match(guard, /ComputeConfigRegistry\.isComputeParamKey\(key\)/);
  assert.match(guard, /input\.isEmpty\(\)/);
  assert.match(guard, /values\.putIfAbsent\(key,\s*entry\.getValue\(\)\)\s*!=\s*null/);
  assert.match(guard, /suppliedTarget == null\s*&& canonicalTargets\.equals\(request\.targets\(\)\)/s);
  assert.match(guard, /new AuditLockTarget\("E",\s*"e6_compute_config",\s*key\)/);
});

test("后端合同覆盖合法 maker、恶意 key、跨域 target、重复 target 与空批量", () => {
  assert.match(
    guardTest,
    /delegatedE6BatchUsesServerCanonicalSortedTargetsAndFailsClosedForMaliciousKeys/,
  );
  for (const token of [
    "D.finance.dailyLimit",
    "duplicateTarget",
    "crossDomainTarget",
    "A2_BUSINESS_CONTEXT_UNMAPPED",
    "A2_BUSINESS_CONTEXT_MISMATCH",
    'Map.of("values", Map.of())',
  ]) {
    assert.ok(guardTest.includes(token), `missing E6 fail-closed coverage: ${token}`);
  }
});
