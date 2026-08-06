import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  resolveNexionAppRoot,
  resolveNexionBackendRoot,
} from "../scripts/lib/nexion-workspace-paths.mjs";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolveNexionAppRoot({ adminRoot });
const backendRoot = resolveNexionBackendRoot({ adminRoot });
const readWorkspaceFile = (root, relative) => readFileSync(path.join(root, ...relative.split("/")), "utf8");

const component = readFileSync(
  new URL("../app/components/domain-views/j-tabs/j1-killswitch.tsx", import.meta.url),
  "utf8",
);
const client = readFileSync(new URL("../lib/admin/j-client.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../app/components/domain-views/j-view.tsx", import.meta.url), "utf8");
const designKit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const registry = readFileSync(new URL("../lib/admin/high-ops-registry.ts", import.meta.url), "utf8");
const opsAlertsClient = readFileSync(new URL("../lib/admin/ops-dashboard-client.ts", import.meta.url), "utf8");
const notificationBell = readFileSync(new URL("../app/components/shell/notification-bell.tsx", import.meta.url), "utf8");
const commandCenter = readFileSync(new URL("../app/_console/page.tsx", import.meta.url), "utf8");
const bClient = readFileSync(new URL("../lib/admin/b-client.ts", import.meta.url), "utf8");
const b5RiskRadar = readFileSync(new URL("../app/_console/overview/risk-radar/page.tsx", import.meta.url), "utf8");
const syncChip = readFileSync(new URL("../app/components/shell/sync-chip.tsx", import.meta.url), "utf8");
const backendKillSwitch = readWorkspaceFile(
  backendRoot,
  "src/main/java/ffdd/opsconsole/emergency/application/OpsKillSwitchService.java",
);
const backendWithdrawal = readWorkspaceFile(
  backendRoot,
  "src/main/java/ffdd/opsconsole/finance/application/AppWithdrawalService.java",
);
const backendTrial = readWorkspaceFile(
  backendRoot,
  "src/main/java/ffdd/opsconsole/growth/application/AppTrialLifecycleService.java",
);
const appWithdrawalApi = readWorkspaceFile(appRoot, "src/api/withdrawal-api.ts");
const appTrialApi = readWorkspaceFile(appRoot, "src/api/trial-api.ts");

test("J1 executes kill, resume and batch kill through the immediate business API", () => {
  assert.match(component, /actions\.toggleJ1KillSwitch/);
  assert.match(component, /actions\.emergencyDisableJ1/);
  assert.doesNotMatch(component, /usePropose|\bpropose\(/);
  assert.doesNotMatch(registry, /op:\s*"j1_(?:gate_kill|gate_resume|batch_kill)"/);
});

test("J1 rejects partial or internally inconsistent matrix payloads", () => {
  assert.match(client, /J1_GATE_KEYS\s*=\s*\["withdraw",\s*"staking",\s*"genesis",\s*"exchange",\s*"trial"\]/);
  assert.match(client, /activeGateCount\s*!==\s*J1_GATE_KEYS\.length/);
  assert.match(client, /coveragePrecheckRequired\s*!==\s*amplifies/);
  assert.match(client, /typeof value === "number"/);
  assert.match(client, /typeof value === "string" && \/\^-/);
  assert.match(client, /yellowLinePct <= redlinePct/);
  assert.match(client, /\(emergency && enabled\)/);
  assert.match(client, /every\(Number\.isInteger\)/);
  assert.match(client, /J1_GATE_SEMANTICS/);
  assert.match(client, /expected\.coveragePrecheckRequired/);
  assert.match(client, /recoveryAllowed\s*!==\s*\(coverageRatio\s*>=\s*redlinePct\)/);
  assert.match(client, /liveGateCount\s*!==\s*activeGates\.filter/);
  assert.match(client, /J1_EMERGENCY_SLA_IDS\s*=\s*\["autoConfirmMins",\s*"recoverGate"\]/);
  assert.match(client, /J1_AUTO_RULE_IDS\s*=\s*\["withdrawSurge",\s*"maturityGap",\s*"tamperCluster",\s*"regulatoryDirective"\]/);
  assert.match(client, /exactRowIds\(\s*emergencySlaRows/);
  assert.match(client, /exactRowIds\(autoRuleRows/);
  assert.match(client, /row\.configKey/);
  assert.match(client, /numericValue !== redlinePct/);
  assert.match(client, /fetchJEmergencyOverviews\(tab:/);
  assert.match(view, /fetchJEmergencyOverviews\(tab\)/);
  assert.doesNotMatch(client, /const \[killSwitch, geoBlock, tamper, sop, notifyTemplates\]/);
});

test("J1 exposes the auto-trigger confirmation loop without restoring a gate", () => {
  assert.match(client, /autoConfirmations/);
  assert.match(client, /confirmJ1AutoTrigger/);
  assert.match(component, /actions\.confirmJ1AutoTrigger/);
  assert.match(component, /row\.incidentId/);
  assert.match(client, /withReason\(\{ incidentId, decision \}/);
  assert.match(component, /keep_disabled/);
  assert.match(component, /recommend_restore/);
  assert.match(component, /自动关停待补录/);
});

test("J1 duty alerts use the all-operator minimal snapshot and refresh while the console stays open", () => {
  assert.match(opsAlertsClient, /fetch\("\/api\/admin\/emergency\/kill-switches\/alerts"/);
  assert.match(opsAlertsClient, /payload\.data\.autoConfirmations/);
  assert.match(opsAlertsClient, /payload\.data\.activeGates/);
  assert.match(opsAlertsClient, /J1_ALERT_GATE_KEYS\s*=\s*\["withdraw",\s*"staking",\s*"genesis",\s*"exchange",\s*"trial"\]/);
  assert.match(opsAlertsClient, /payload\.data\.activeGateCount !== J1_ALERT_GATE_KEYS\.length/);
  assert.match(opsAlertsClient, /new Set\(gates\.map\(\(gate\) => gate\.key\)\)/);
  assert.match(opsAlertsClient, /gates\.length !== J1_ALERT_GATE_KEYS\.length/);
  assert.match(opsAlertsClient, /gateKeys\.size !== J1_ALERT_GATE_KEYS\.length/);
  assert.match(opsAlertsClient, /new Set\(pending\.map\(\(row\) => row\.key\)\)\.size !== pending\.length/);
  assert.match(opsAlertsClient, /J1-KILL-STATE/);
  assert.doesNotMatch(opsAlertsClient, /ops-dashboard\/summary/);
  assert.match(opsAlertsClient, /j1DutyAlertSubscribers\.size === 1/);
  assert.match(opsAlertsClient, /window\.setInterval\(refreshJ1DutyAlerts, 30_000\)/);
  assert.match(opsAlertsClient, /requestSequence !== j1DutyAlertRequestSequence/);
  assert.match(opsAlertsClient, /J1 值班告警暂时无法读取，请稍后重试/);
  assert.doesNotMatch(opsAlertsClient, /error:\s*error instanceof Error \? error\.message/);
  assert.match(notificationBell, /const session = useAdminAuth\(\(state\) => state\.session\)/);
  assert.match(notificationBell, /const hasAdminSession = session != null/);
  assert.match(commandCenter, /authorities\.includes\("emergency_j1_read"\)/);
  assert.match(notificationBell, /useJ1DutyAlerts\(hasAdminSession\)/);
  assert.match(commandCenter, /useJ1DutyAlerts\(canReadJ1\)/);
  assert.doesNotMatch(notificationBell, /setInterval\(refreshJ1Alerts/);
  assert.doesNotMatch(commandCenter, /setInterval\(refreshJ1Alerts/);
});

test("B5 owns structured bank-run bands and displays the same redline referenced by J1 R1", () => {
  assert.match(bClient, /updateB5BankRunThresholds/);
  assert.match(bClient, /risk\.bankRunRedlinePct <= risk\.bankRunYellowPct/);
  assert.match(bClient, /typeof value === "string" && \/\^-\?/);
  assert.match(bClient, /expectedGateKeys = \["withdraw", "staking", "genesis", "exchange", "trial"\]/);
  assert.match(b5RiskRadar, /bankRunYellowPct = riskRadar\.bankRunYellowPct/);
  assert.match(b5RiskRadar, /bankRunRedlinePct = riskRadar\.bankRunRedlinePct/);
  assert.match(b5RiskRadar, /J1 R1 已同步引用/);
  assert.doesNotMatch(b5RiskRadar, /bankRunRatio < 20/);
  assert.match(b5RiskRadar, /R1 自动关停后须补录处置结论/);
  assert.match(b5RiskRadar, /P0 告警表示挤兑比率达到当前动态红线/);
});

test("J1 R3 renders the backend-provided J3 canonical alert threshold", () => {
  assert.match(component, /const effThr = \(r: AutoRuleRow\) => r\.thr/);
  assert.doesNotMatch(component, /emergency\.tamper\?\.alertConfig/);
  assert.doesNotMatch(component, /10 次 \/ 24h/);
});

test("J1 retries an uncertain command with the same idempotency key", () => {
  assert.match(component, /createJEmergencyCommandKey/);
  assert.match(client, /toggleJ1KillSwitch: \(key, enabled, reason, context, commandKey\)/);
  assert.match(client, /emergencyDisableJ1: \(keys, reason, operator, context, commandKey\)/);
  assert.match(client, /confirmJ1AutoTrigger: \(key, incidentId, decision, reason, commandKey\)/);
  assert.match(view, /catch \(error\)[\s\S]*?throw error/);
});

test("J1 configuration writes carry the visible baseline and reject no-op edits", () => {
  assert.match(client, /updateJ1Sla:\s*\(paramKey,\s*value,\s*expectedValue,\s*reason,\s*commandKey\)/);
  assert.match(client, /updateJ1AutoRule:\s*\(ruleId,\s*value,\s*expectedValue,\s*reason,\s*commandKey\)/);
  assert.match(client, /withReason\(\{ value, expectedValue \}, reason\)/);
  assert.match(component, /actions\.updateJ1Sla\(row\.id,\s*newValue \?\? cur,\s*cur,\s*reason,\s*commandKey\)/);
  assert.match(component, /actions\.updateJ1AutoRule\(r\.id,\s*newValue \?\? cur,\s*cur,\s*reason,\s*commandKey\)/);
  assert.match(component, /disallowCurrent:\s*true/);
  assert.match(backendKillSwitch, /request\.expectedValue\(\)/);
  assert.match(backendKillSwitch, /compareAndSetSetting/);
  assert.match(backendKillSwitch, /J1_CONFIG_STALE_VERSION/);
  assert.match(backendKillSwitch, /J1_CONFIG_NO_CHANGES/);
});

test("J1 classifies Genesis restore as an immediate B1 cashflow impact", () => {
  assert.match(client, /genesis:\s*\{\s*coveragePrecheckRequired:\s*true,\s*coverageImpactCategory:\s*"immediate"\s*\}/);
  assert.match(backendKillSwitch, /new GateSeed\("genesis"[\s\S]*?"immediate"/);
});

test("J1 withdraw and trial gates are enforced at real App command boundaries and propagated", () => {
  assert.match(backendWithdrawal, /WITHDRAWAL_KILL_SWITCH_DISABLED/);
  assert.match(backendWithdrawal, /submitOnce[\s\S]*?withdrawGateEnabled\(\)/);
  assert.match(backendWithdrawal, /"withdrawalEnabled", withdrawalEnabled/);
  assert.match(appWithdrawalApi, /withdrawalEnabled:\s*boolean/);
  assert.match(appWithdrawalApi, /row\.gateSource !== "J1"/);
  assert.match(backendTrial, /TRIAL_KILL_SWITCH_DISABLED/);
  assert.match(backendTrial, /startOnce[\s\S]*?trialGateEnabled\(\)/);
  assert.match(backendTrial, /result\.put\("trialGateEnabled", trialGateEnabled\)/);
  assert.match(appTrialApi, /trialGateEnabled:\s*boolean/);
  assert.match(appTrialApi, /source\.canStart && !source\.trialGateEnabled/);
});

test("J1 fails closed on refresh errors and keeps failed confirmations open", () => {
  assert.match(view, /setEmergency\(\{\}\)/);
  assert.match(view, /await mc\.run/);
  assert.match(component, /coverage:\s*g\.coveragePrecheckRequired/);
  assert.match(component, /throw error/);
  assert.match(component, /return runBackend\(actions\.toggleJ1KillSwitch/);
  assert.match(component, /triggerBasis/);
  assert.match(component, /regulatoryContext/);
  assert.match(component, /dispositionPlan/);
});

test("operation confirmation cannot close or resubmit while a request is in flight", () => {
  assert.match(designKit, /if \(!submitting\) onClose\(\)/);
  assert.match(designKit, /<Modal[^>]+onClose=\{handleClose\}/);
  assert.match(designKit, /<Btn disabled=\{submitting\} onClick=\{handleClose\}>取消<\/Btn>/);
  assert.match(designKit, /!submitting && reasonOk/);
});

test("J1 gates actions by direction-specific authorities", () => {
  assert.match(component, /emergency_j1_gate_kill/);
  assert.match(component, /emergency_j1_gate_resume/);
  assert.match(component, /emergency_j1_batch_kill/);
  assert.match(component, /emergency_j1_write/);
  assert.match(component, /r\.adjustable\s*&&\s*canWrite/);
  assert.doesNotMatch(component, /disabled=\{!canWrite\}/);
});

test("J1 renders server stats and uses a numeric R2 threshold editor", () => {
  assert.match(component, /coverageBlockedCount/);
  assert.match(component, /emergencyGateCount/);
  assert.match(component, /edit:\s*\{\s*kind:\s*"number"/);
  assert.doesNotMatch(component, /B1 前置阻断 0|应急轨提案/);
});

test("J1 exposes actionable, localized control and error states", () => {
  assert.match(component, /aria-label=\{`勾选\$\{g\.name\}纳入批量关停`\}/);
  assert.match(component, /恢复受阻/);
  assert.match(component, /当前没有待补录事项/);
  assert.match(component, /即时资金流出/);
  assert.match(component, /未来负债增加/);
  assert.match(component, /autoRuleDisplayName/);
  assert.doesNotMatch(component, /\{row\.ruleId\}/);
  assert.match(view, /role="alert"/);
  assert.match(view, /重新读取/);
  assert.match(client, /无法识别的内容/);
  assert.match(client, /无法连接应急控制服务，请检查网络后重试/);
  assert.match(client, /text = await res\.text\(\)/);
  assert.doesNotMatch(client, /Failed to fetch/);
  assert.match(syncChip, /服务端权威 · 已同步/);
  assert.doesNotMatch(syncChip, />\s*server-canonical · live\s*</);
});
