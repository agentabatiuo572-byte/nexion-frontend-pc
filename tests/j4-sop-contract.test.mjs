import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../app/components/domain-views/j-tabs/j4-sop.tsx", import.meta.url),
  "utf8",
);
const jView = readFileSync(
  new URL("../app/components/domain-views/j-view.tsx", import.meta.url),
  "utf8",
);
const client = readFileSync(new URL("../lib/admin/j-client.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/components/domain-views/j-domain.css", import.meta.url), "utf8");
const backend = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/emergency/application/OpsEmergencyControlService.java", import.meta.url),
  "utf8",
);
const emergencyMapper = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/emergency/mapper/EmergencyControlMapper.java", import.meta.url),
  "utf8",
);
const emergencyRepository = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/emergency/infrastructure/MybatisEmergencyControlRepository.java", import.meta.url),
  "utf8",
);
const runRequest = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/emergency/dto/SopPlaybookRunRequest.java", import.meta.url),
  "utf8",
);
const designKit = readFileSync(
  new URL("../app/components/domain-views/design-kit.tsx", import.meta.url),
  "utf8",
);
const j4OverviewBackend = backend.slice(
  backend.indexOf("sopOverview()"),
  backend.indexOf("createPlaybook(", backend.indexOf("sopOverview()")),
);

test("J4 executes the business command directly instead of creating a misleading A2 proposal", () => {
  assert.doesNotMatch(component, /usePropose|findHighOp|\bpropose\s*\(/);
  assert.match(component, /actions\.executeJ4Playbook/);
  assert.doesNotMatch(component, /后续 server|占位|立即生效 · 记入草稿位/);
});

test("J4 hides all write entry points while loading or after an overview failure", () => {
  assert.match(jView, /tab === "J4" && !contentLoading && !contentError/);
  assert.match(component, /disabled=\{!canExecute\}/);
  assert.match(component, /先完成演练/);
});

test("J4 keeps the confirmation modal open when a backend command fails", () => {
  assert.match(jView, /await mc\.run[\s\S]*catch \{[\s\S]*保留确认弹窗/);
  assert.equal((component.match(/throw error;/g) ?? []).length, 2);
  assert.equal((component.match(/return runBackend\(/g) ?? []).length, 5);
  assert.equal((component.match(/toast\(`操作失败/g) ?? []).length, 2);
  assert.doesNotMatch(component, /void runBackend\(/);
});

test("J4 only offers notification campaigns that can actually be dispatched", () => {
  assert.match(client, /item\.status === "scheduled"/);
  assert.doesNotMatch(client, /item\.status !== "cancelled"/);
  assert.match(client, /notifyTemplatesError/);
  assert.match(client, /I3_NOTIFY_TEMPLATE_LOAD_FAILED/);
});

test("J4 retries the same confirmation with a stable command key and always requires preflight", () => {
  assert.match(component, /createJEmergencyCommandKey/);
  assert.equal((component.match(/commandKey\)/g) ?? []).length, 5);
  assert.match(component, /drillRequired: true/);
  assert.match(backend, /"drillRequired", true/);
  assert.match(backend, /SOP_I3_NOTIFY_ACTION\.equals\(action\)/);
});

test("J4 removes retired escalation SLA fields and implementation-facing copy", () => {
  assert.doesNotMatch(component, /confirmSlaMins|escalateMaxMins|escalateMaxRounds|缺数据/);
  assert.doesNotMatch(component, /真实接口读取|业务表|coverage-ratio|draft=/);
  assert.doesNotMatch(j4OverviewBackend, /ops\.J\.emergency\.confirmSlaMins|ops\.J\.emergency\.escalateMaxMins|ops\.J\.emergency\.escalateMaxRounds/);
});

test("J4 backend exposes only actions with real target-domain executors", () => {
  assert.match(backend, /actionOption\("J1", "熔断提现通道"/);
  assert.match(backend, /actionOption\("I3", "发送通知模板"/);
  assert.doesNotMatch(backend, /actionOption\("(?:D2|B1|C2|K1|J2|I5)"/);
  assert.match(backend, /J4_ACTION_NOT_EXECUTABLE/);
});

test("J4 quarantines legacy playbooks that still contain retired actions", () => {
  assert.match(component, /supportedActionKeys/);
  assert.match(component, /unsupportedStepCount/);
  assert.match(component, /历史剧本 · 需迁移/);
  assert.match(component, /禁止演练/);
  assert.match(component, /disabled=\{!contractReady \|\| contentLoading \|\| legacyStepCount > 0\}/);
  assert.match(component, /data-testid=\{`j4-playbook-\$\{p\.code\}`\}/);
  assert.match(component, /data-testid=\{e\.executionId \? `j4-execution-\$\{e\.executionId\}` : undefined\}/);
  assert.match(styles, /\.jdom \.pb-ft \.acts button:disabled \{ opacity: \.35; filter: grayscale\(\.65\); cursor: not-allowed; \}/);
});

test("J4 uses the versioned safe-execution contract and degrades old backends to read-only", () => {
  assert.match(client, /contractVersion/);
  assert.match(backend, /J4_REAL_EXECUTION_V3/);
  assert.match(component, /const contractReady = data\.contractVersion === "J4_REAL_EXECUTION_V3"/);
  assert.match(component, /后端 J4 安全执行契约未就绪/);
});

test("J4 serializes canonical action refs and rejects duplicate side effects", () => {
  assert.match(backend, /parts\[1\]\.trim\(\)/);
  assert.match(backend, /J4_ACTION_DUPLICATED/);
  assert.match(backend, /expectedActionRef/);
});

test("J4 never offers rollback while an execution is pending or running", () => {
  assert.match(component, /e\.steps\.some\(\(step\) => step === "pending" \|\| step === "running" \|\| step === "recovering"\)/);
  assert.match(backend, /J4_EXECUTION_RECOVERY_LEASE/);
  assert.match(backend, /findEmergencyDispatch/);
});

test("J4 requires structured trigger evidence and every target-domain confirmation before execution", () => {
  assert.match(component, /j4-execution-confirmation/);
  assert.match(component, /stepConfirm\./);
  assert.match(component, /stepConfirmations/);
  assert.match(component, /监管点名.*挤兑风险.*安全事件.*其他/s);
  assert.match(client, /triggerBasis: string; triggerContext: string; stepConfirmations/);
  assert.match(runRequest, /String triggerBasis/);
  assert.match(runRequest, /List<SopStepConfirmationRequest> stepConfirmations/);
  assert.match(backend, /validateJ4StepConfirmations/);
  assert.match(backend, /GEO_TRIGGER_BASES\.contains\(triggerBasis\)/);
  assert.match(backend, /J4_STEP_CONFIRMATIONS_REQUIRED/);
  assert.match(backend, /J4_STEP_CONFIRMATION_INVALID/);
  assert.match(backend, /case "j4_playbook_execute"[\s\S]*j4StepConfirmations\(p\)/);
});

test("J4 trace action opens a real evidence view with domain, notification, audit and rollback facts", () => {
  assert.match(component, /setTraceExecution\(e\)/);
  assert.match(component, /逐步执行结果/);
  assert.match(component, /通知与审计/);
  assert.match(component, /回滚事实/);
  assert.match(component, /历史记录未保存逐步确认/);
  assert.match(component, /j4-trace-confirmation/);
  assert.match(client, /domainActions: Array<Record<string, unknown>>/);
  assert.match(client, /rollbackActions: Array<Record<string, unknown>>/);
});

test("J4 computes readiness and 90-day stats from authoritative timestamps", () => {
  assert.match(backend, /isJ4DrillFresh/);
  assert.match(backend, /minusDays\(90\)/);
  assert.match(backend, /countExecutionsSinceByMode\("drill"/);
  assert.match(emergencyMapper, /created_at >= #\{since\}/);
  assert.match(client, /executionReady/);
  assert.match(component, /p\.readinessReason/);
});

test("J4 execution JSON is parsed by its real shape and corrupt required evidence fails closed", () => {
  assert.match(emergencyRepository, /readRequiredStringList\(row\.get\("stepsJson"\)/);
  assert.match(emergencyRepository, /readRequiredMapList\(row\.get\("domainActionsJson"\)/);
  assert.match(emergencyRepository, /readOptionalMapList\(row\.get\("rollbackActionsJson"\)/);
  assert.match(emergencyRepository, /J4_EXECUTION_JSON_CORRUPT/);
});

test("J4 SLA editor converts legacy hours and rejects out-of-range minute values before submit", () => {
  assert.match(designKit, /Number\(match\[1\]\) \* 60/);
  assert.match(designKit, /parseSopSlaMinutes\(state\.sla\) == null/);
  assert.match(designKit, /min=\{1\}/);
  assert.match(designKit, /max=\{1440\}/);
  assert.match(backend, /amount >= 1 && amount <= 1440/);
});

test("J4 edit form de-duplicates the current owner from the fixed owner catalog", () => {
  assert.match(component, /owners: Array\.from\(new Set\(\[p\.owner, "风控", "合规审计", "超管"\]\)\)/);
  assert.doesNotMatch(component, /owners: \[p\.owner, "风控", "合规审计", "超管"\]/);
});

test("J4 distinguishes a completed rollback from the original step outcomes", () => {
  assert.match(component, /e\.rollbackStatus === "ROLLED_BACK"/);
  assert.match(component, /已回滚可逆动作/);
  assert.match(component, /通知等不可逆动作不受影响/);
  assert.match(component, /authorities\.includes\("emergency_j1_gate_resume"\)/);
  assert.match(backend, /J4_TARGET_AUTHORITY_REQUIRED:J1:emergency_j1_gate_resume/);
});

test("J4 recovery uses a fresh execution snapshot and rollback claims only audited terminal work", () => {
  const executeOnce = backend.indexOf("executePlaybookOnce(", backend.indexOf("private ApiResult"));
  const existingStart = backend.indexOf("executionByIdempotencyKeyIndependent", executeOnce);
  const existingBranch = backend.slice(
    existingStart,
    backend.indexOf("PlaybookSeed seed = playbookFromRow(lockedPlaybook.get())", existingStart),
  );
  const progressSql = emergencyMapper.slice(
    emergencyMapper.indexOf("UPDATE nx_emergency_sop_execution", emergencyMapper.indexOf("int insertExecution")),
    emergencyMapper.indexOf("int updateExecutionProgress"),
  );
  const rollbackClaimSql = emergencyMapper.slice(
    emergencyMapper.indexOf("SET rollback_status = 'ROLLING_BACK'"),
    emergencyMapper.indexOf("int claimExecutionRollback"),
  );
  assert.match(existingBranch, /storedRequestHash/);
  assert.doesNotMatch(existingBranch, /requireTargetAuthorities/);
  assert.match(backend, /playbookForUpdate/);
  assert.match(emergencyMapper, /playbookStepsForUpdate[\s\S]*FOR UPDATE/);
  assert.match(backend, /filter\(action -> "DONE"\.equals/);
  assert.doesNotMatch(progressSql, /auditStatus/);
  assert.match(rollbackClaimSql, /auditStatus.*AUDITED/s);
  assert.match(rollbackClaimSql, /pending/);
  assert.match(rollbackClaimSql, /running/);
});

test("J4 serializes catalog mutations before allocating codes or validating unique names", () => {
  assert.equal((backend.match(/lockPlaybookCatalogMutations\(\)/g) ?? []).length, 2);
  assert.equal((backend.match(/playbooksIndependent\(\)/g) ?? []).length, 2);
  assert.match(emergencyMapper, /emergency\.sop\.catalogMutationLock/);
  assert.match(emergencyMapper, /lockPlaybookCatalogMutations/);
});
