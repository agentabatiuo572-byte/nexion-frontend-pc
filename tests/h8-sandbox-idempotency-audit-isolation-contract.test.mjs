import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const backend = resolve(root, "..", "backend");
const service = readFileSync(resolve(backend, "src/main/java/ffdd/opsconsole/growth/application/OpsReferralRewardService.java"), "utf8");
const command = () => readFileSync(resolve(backend, "src/main/java/ffdd/opsconsole/growth/application/H8AcceptanceSandboxCommandService.java"), "utf8");
const audit = () => readFileSync(resolve(backend, "src/main/java/ffdd/opsconsole/growth/application/H8AcceptanceSandboxAuditService.java"), "utf8");
const mapper = readFileSync(resolve(backend, "src/main/java/ffdd/opsconsole/growth/mapper/ReferralRewardMapper.java"), "utf8");
const migration = readFileSync(resolve(backend, "scripts/migrations/20260812_h8_acceptance_sandbox_run_scope.sql"), "utf8");
const pc = readFileSync(resolve(root, "app/components/domain-views/h-tabs/h8-referral-rewards.tsx"), "utf8");

test("acceptance H8 never uses shared A2 idempotency, audit, or outbox for sandbox success or rejection", () => {
  const sandbox = service.slice(service.indexOf("runAcceptanceSandboxSettlement"), service.indexOf("private Map<String, Object> settle("));
  assert.match(sandbox, /sandboxCommands\.execute\(runId, idempotencyKey/);
  assert.match(sandbox, /sandboxAudit\.recordRejected/);
  assert.doesNotMatch(sandbox, /idempotency\.execute|rejectedAudit\(|audit\(|outbox\.publish/);
  assert.match(service, /sandboxAudit\.recordSuccess/);
});

test("sandbox command facts are run-scoped, replay the same terminal result, and reject a changed payload", () => {
  assert.match(command(), /findSandboxCommand\(runId, idempotencyKey\)/);
  assert.match(command(), /H8_SANDBOX_IDEMPOTENCY_KEY_PAYLOAD_MISMATCH/);
  assert.match(command(), /STATUS_SUCCEEDED/);
  assert.match(command(), /completeSandboxCommand/);
  assert.match(migration, /nx_h8_sandbox_referral_command/);
  assert.match(migration, /UNIQUE KEY uk_h8_sandbox_command_run_key \(run_id, idempotency_key\)/);
});

test("sandbox audit facts are dedicated, run-scoped, and PC states the real A2 boundary", () => {
  assert.match(audit(), /Propagation\.REQUIRES_NEW/);
  assert.match(mapper, /insertSandboxAudit/);
  assert.match(migration, /nx_h8_sandbox_referral_audit/);
  assert.match(pc, /不写入生产 A2 审计、幂等或 Outbox/);
});

test("H8 sandbox settlements do not mutate the shared user wallet", () => {
  assert.doesNotMatch(service, /creditSandboxWallet/);
  const sandboxLedger = mapper.slice(mapper.indexOf("INSERT INTO nx_h8_sandbox_referral_ledger"), mapper.indexOf("int insertSandboxLedger"));
  assert.doesNotMatch(sandboxLedger, /UPDATE\s+nx_user_wallet/i);
  assert.doesNotMatch(mapper, /int\s+creditSandboxWallet/);
});

test("settlement idempotency is RunID scoped so a later fixture run can reuse its key", () => {
  const baseline = readFileSync(resolve(backend, "scripts/migrations/20260811_h8_acceptance_sandbox_referral_ledger.sql"), "utf8");
  const forward = readFileSync(resolve(backend, "scripts/migrations/20260812_h8_acceptance_sandbox_run_scope.sql"), "utf8");
  assert.match(baseline, /uk_h8_sandbox_referral_run_idempotency \(run_id,idempotency_key\)/);
  assert.doesNotMatch(baseline, /uk_h8_sandbox_referral_idempotency \(idempotency_key\)/);
  assert.match(forward, /DROP INDEX uk_h8_sandbox_referral_idempotency/);
  assert.match(forward, /uk_h8_sandbox_referral_run_idempotency \(run_id, idempotency_key\)/);
});
