import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { downloadJ3ReportFile } from "../lib/admin/j3-report-download.ts";
import { formatAdminApiError } from "../lib/admin/error-messages.ts";

const component = readFileSync(
  new URL("../app/components/domain-views/j-tabs/j3-tamper.tsx", import.meta.url),
  "utf8",
);
const client = readFileSync(new URL("../lib/admin/j-client.ts", import.meta.url), "utf8");
const reportDownload = readFileSync(
  new URL("../lib/admin/j3-report-download.ts", import.meta.url),
  "utf8",
);
const controller = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/emergency/web/OpsEmergencyControlController.java", import.meta.url),
  "utf8",
);
const canonicalBoundaryController = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/shared/canonical/AppCanonicalBoundaryController.java", import.meta.url),
  "utf8",
);
const canonicalBoundaryService = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/shared/canonical/AppCanonicalBoundaryService.java", import.meta.url),
  "utf8",
);
const c2Component = readFileSync(
  new URL("../app/components/domain-views/c-tabs/c2-actions.tsx", import.meta.url),
  "utf8",
);
const k1Component = readFileSync(
  new URL("../app/components/domain-views/k-tabs/k1-multiaccount.tsx", import.meta.url),
  "utf8",
);
const dashboardClient = readFileSync(new URL("../lib/admin/ops-dashboard-client.ts", import.meta.url), "utf8");
const notificationBell = readFileSync(
  new URL("../app/components/shell/notification-bell.tsx", import.meta.url),
  "utf8",
);
const jView = readFileSync(
  new URL("../app/components/domain-views/j-view.tsx", import.meta.url),
  "utf8",
);
const independentAcceptance = readFileSync(
  new URL("./e2e/j3-independent-acceptance.spec.ts", import.meta.url),
  "utf8",
);
const usersProxy = readFileSync(
  new URL("../app/api/admin/users/[...path]/route.ts", import.meta.url),
  "utf8",
);
const usersClient = readFileSync(new URL("../lib/admin/user360-client.ts", import.meta.url), "utf8");
const emergencyProxy = readFileSync(
  new URL("../app/api/admin/emergency/[...path]/route.ts", import.meta.url),
  "utf8",
);
const kView = readFileSync(
  new URL("../app/components/domain-views/k-view.tsx", import.meta.url),
  "utf8",
);

test("J3 turns sanitized backend failures into actionable Chinese copy", () => {
  assert.equal(
    formatAdminApiError("INTERNAL_SERVER_ERROR", "fallback"),
    "服务暂时异常，请稍后重试；持续失败时请联系值班人员。",
  );
});

test("J3 configuration calls the immediate business API with structured controls", () => {
  assert.doesNotMatch(component, /usePropose|findHighOp|\bpropose\s*\(/);
  assert.match(component, /actions\.updateJ3AlertConfig/);
  assert.match(component, /type="number"/);
  assert.match(component, /min=\{1\}/);
  assert.match(component, /max=\{100\}/);
  assert.match(component, /step=\{1\}/);
  assert.match(component, /Number\.isInteger\(threshold\)/);
  assert.match(component, /sevenDayPreviewByThreshold/);
  assert.match(component, /role="switch"/);
  assert.match(component, /8–200/);
  assert.match(component, /await (?:ctx\.)?actions\.reloadJEmergency\(\)/);
});

test("J3 rendering follows read, export and alert-config authorities", () => {
  assert.match(component, /emergency_j3_export/);
  assert.match(component, /emergency_j3_alert_config/);
  assert.match(component, /useAdminAuth/);
  assert.match(controller, /hasAuthority\('emergency_j3_export'\)/);
});

test("J3 applies one selected window to charts, paths, accounts, pagination and export", () => {
  assert.match(client, /fetchJTamperOverview\(window/);
  assert.match(client, /window:\s*window/);
  assert.match(component, /loadJ3TamperPage\(win,/);
  assert.match(component, /createJ3Report\(\s*(?:win|window),/);
  assert.doesNotMatch(component, /createJ3Report\("24h"/);
  assert.match(component, /data\?\.window|data\.window/);
  assert.match(client, /effectiveThreshold/);
  assert.match(client, /sevenDayAlertAccounts/);
});

test("J3 produces a real masked CSV download only after the report API succeeds", () => {
  assert.match(client, /export type TamperReport/);
  assert.match(client, /contentBase64/);
  assert.match(component, /downloadJ3ReportFile/);
  assert.match(reportDownload, /new Blob/);
  assert.match(reportDownload, /URL\.createObjectURL/);
  assert.match(reportDownload, /download\s*=/);
  assert.match(reportDownload, /URL\.revokeObjectURL/);
  assert.match(client, /window !== expectedWindow/);
  assert.match(client, /!masked/);
  assert.match(client, /status !== "READY"/);
  assert.match(client, /endsWith\("\.csv"\)/);
  assert.match(client, /startsWith\("text\/csv"\)/);
});

test("J3 keeps the committed report when the browser download fails and retries locally", () => {
  assert.equal(component.match(/actions\.createJ3Report/g)?.length, 1);
  assert.ok(component.indexOf("if (retryableReport)") < component.indexOf("actions.createJ3Report"));
  assert.match(component, /setPendingReport\(report\)/);
  assert.match(component, /API 成功就是服务端提交边界/);
  assert.match(component, /仅重试下载已生成的报表，不会再次请求服务器/);
  assert.match(component, /放弃本次报表/);
  assert.match(component, /服务器已生成的报表和审计仍会保留/);
  assert.match(component, /const abandonPendingReport = \(\) => \{\s*setPendingReport\(null\)/);
});

test("J3 local download cleanup runs even when the browser click throws", () => {
  const calls = [];
  const link = {
    href: "",
    download: "",
    click() { calls.push("click"); throw new Error("download blocked"); },
    remove() { calls.push("remove"); },
  };
  const report = {
    reportId: "report-1", window: "24h", masked: true, status: "READY",
    filename: "j3.csv", contentType: "text/csv", contentBase64: "YQ==",
    eventCount: 1, accountCount: 1,
  };
  assert.throws(() => downloadJ3ReportFile(report, {
    decodeBase64: () => new Uint8Array([97]),
    createBlob: () => ({}),
    createObjectUrl: () => "blob:j3",
    revokeObjectUrl: (url) => calls.push(`revoke:${url}`),
    createLink: () => link,
    appendLink: () => calls.push("append"),
  }), /download blocked/);
  assert.deepEqual(calls, ["append", "click", "remove", "revoke:blob:j3"]);

  const decodeCalls = [];
  assert.throws(() => downloadJ3ReportFile(report, {
    decodeBase64: () => { decodeCalls.push("decode"); throw new Error("invalid base64"); },
    createBlob: () => { decodeCalls.push("blob"); return {}; },
    createObjectUrl: () => { decodeCalls.push("url"); return "blob:bad"; },
    revokeObjectUrl: () => decodeCalls.push("revoke"),
    createLink: () => link,
    appendLink: () => decodeCalls.push("append"),
  }), /invalid base64/);
  assert.deepEqual(decodeCalls, ["decode"]);
});

test("J3 truthful states do not claim K4 or B5 delivery without server status", () => {
  assert.match(client, /fedToK4/);
  assert.match(client, /b5Triggered/);
  assert.match(client, /alertState/);
  assert.match(component, /a\.fedToK4/);
  assert.match(component, /a\.b5Triggered/);
  assert.match(component, /当前窗口暂无服务器拦截事件/);
  assert.match(component, /disabled=\{[^}]*!hasData/);
  assert.doesNotMatch(component, /资金实际损失为 0/);
  assert.match(component, /监控接入未完成/);
  assert.match(component, /activeCount/);
  assert.match(component, /registeredCount/);
  assert.match(component, /服务器拒绝入口已全部接入/);
  assert.match(component, /data\.coverage\.activeCount/);
  assert.doesNotMatch(component, /当前仅风险披露验真已接入/);
});

test("J3 client and backend use PUT, optimistic snapshots and fixed-window validation", () => {
  assert.match(client, /method:\s*"PUT"/);
  assert.match(client, /expectedThreshold/);
  assert.match(client, /expectedFeedK4/);
  assert.match(client, /updateJ3AlertConfig:[\s\S]{0,500}"Idempotency-Key": commandKey/);
  assert.match(controller, /@PutMapping\("\/tamper\/alert-config"\)/);
  assert.match(controller, /@RequestParam\(value = "window"/);
});

test("J3 retains idempotency keys when a write outcome is uncertain", () => {
  assert.match(component, /isEmergencyOutcomeUncertain/);
  assert.match(component, /复用同一请求编号/);
  assert.match(component, /exportAttempt\.current = null/);
  assert.match(component, /commandAttempt\.current = null/);
  assert.match(component, /if \(isEmergencyOutcomeUncertain\(error\)\)[\s\S]{0,260}else \{\s*exportAttempt\.current = null/);
  assert.match(component, /if \(isEmergencyOutcomeUncertain\(error\)\)[\s\S]{0,300}else \{\s*commandAttempt\.current = null/);
  assert.match(emergencyProxy, /X-Nexion-Upstream-Outcome["']?:?\s*["']unknown/);
  assert.match(client, /isWrite && res\.headers\.get\("X-Nexion-Upstream-Outcome"\) === "unknown"/);
  assert.match(client, /throw new EmergencyOutcomeUncertainError/);
});

test("J3 contextual actions carry the selected account or cluster into C2 and K1", () => {
  assert.match(component, /focusClusterId: a\.cluster/);
  assert.match(component, /userCode: a\.userCode/);
  assert.match(component, /source: "J3"/);
  assert.match(component, /authorities\.includes\("user_c2_read"\)[\s\S]{0,100}user_c2_account_freeze/);
  // C2 now opens the server-authoritative action context in one request so the
  // deep link cannot render a stale account with mismatched sessions/lists.
  assert.match(c2Component, /fetchUserAccountActionContext\(focusUserCode\)/);
  assert.match(usersProxy, /account-actions" && parts\[1\] === "accounts"/);
  assert.match(usersProxy, /account-actions\/accounts\/\$\{encodeURIComponent\(parts\[2\]\)\}/);
  assert.match(usersProxy, /account-actions\/accounts\/\$\{encodeURIComponent\(parts\[2\]\)\}\/context/);
  assert.match(usersClient, /fetchUserAccountActionContext/);
  assert.match(usersClient, /class UsersRequestError extends Error/);
  assert.match(usersClient, /isUsersRequestNotFound/);
  assert.match(c2Component, /isUsersRequestNotFound\(lookupError\) \? "not-found" : "error"/);
  assert.match(c2Component, /focusLookupState === "not-found"/);
  assert.match(c2Component, /下方仍保留当前账户列表/);
  assert.match(c2Component, /setAcct\(null\)/);
  assert.match(c2Component, /user_c2_impersonate_start/);
  assert.match(c2Component, /canStartImpersonation &&/);
  assert.match(k1Component, /fetchK1MultiAccountOverview/);
  assert.match(k1Component, /while \(active\)/);
  assert.match(k1Component, /targetPage = Math\.floor\(absoluteIndex \/ clusterPageSize\) \+ 1/);
  assert.match(k1Component, /await ctx\.reloadKRisk\(\{[\s\S]{0,180}clusterPageNum: targetPage/);
  assert.match(k1Component, /setClusterPage\(targetPage\)/);
  assert.match(k1Component, /MAX_FOCUS_RELOCATIONS = 3/);
  assert.match(k1Component, /positioned\?\.clusters\.records\.findIndex/);
  assert.match(k1Component, /if \(positionedIndex >= 0\)/);
  assert.match(k1Component, /focusPageLoad\.current/);
  assert.match(k1Component, /focusLookupState === "not-found"/);
  assert.match(k1Component, /focusBlocksSelection \? undefined/);
  assert.match(k1Component, /!focusBlocksSelection && c\.status/);
  assert.match(k1Component, /退出定位后手动查看/);
  assert.match(k1Component, /focusLookupState !== "found"/);
  assert.match(k1Component, /网络异常或账户簇数据持续变化，未能稳定定位/);
  assert.match(kView, /const requestSequence = useRef\(0\)/);
  assert.match(kView, /fetchK1MultiAccountOverview\(query\.multiAccount\)/);
  assert.match(kView, /const sequence = \+\+requestSequence\.current/);
  assert.match(kView, /sequence === requestSequence\.current/);
  assert.match(kView, /tab !== "K6" && tab !== "K1"/);
  // K1 owns its focused deep-link error state, so the shell-level error branch
  // must exclude K1 even as the other K pages move to their own local states.
  assert.match(kView, /tab !== "K6" && tab !== "K1"[\s\S]{0,180}contentError/);
  assert.match(k1Component, /仅重试 K1/);
  assert.match(k1Component, /reloadKRisk\(\{ multiAccount: pageQuery \}\)\.catch/);
});

test("J3 distinguishes a committed config write from a failed follow-up refresh", () => {
  assert.match(component, /commandAttempt\.current = null;\s*try \{\s*await ctx\.actions\.reloadJEmergency\(\)/);
  assert.match(component, /监控配置已生效并已记审计，但页面刷新失败/);
  assert.doesNotMatch(component, /updateJ3AlertConfig\([\s\S]{0,300}reloadJEmergency\(\)[\s\S]{0,200}catch \(error\) \{\s*if \(isEmergencyOutcomeUncertain/);
});

test("J3 accepts valid empty coverage sets and rejects incomplete threshold previews", () => {
  assert.match(client, /requiredStringArrayAllowEmpty/);
  assert.match(client, /coverage\.activePaths/);
  assert.match(client, /coverage\.missingPaths/);
  assert.match(client, /expectedKeys = Array\.from\(\{ length: 100 \}/);
  assert.match(client, /sevenDayPreviewByThreshold\.keys/);
  assert.match(client, /!Number\.isInteger\(count\) \|\| count < 0/);
  assert.match(component, /previewAvailable/);
  assert.match(component, /预览不可用/);
  assert.match(component, /当前禁止提交/);
  assert.doesNotMatch(component, /sevenDayPreviewByThreshold\[String\(threshold\)\] \?\? 0/);
});

test("J3 config changes are readable from the persistent superadmin notification feed", () => {
  assert.match(controller, /@GetMapping\("\/tamper\/config-alerts"\)/);
  assert.match(controller, /hasAuthority\('emergency_j3_alert_config'\)/);
  assert.match(dashboardClient, /fetchJ3TamperConfigAlerts/);
  assert.match(dashboardClient, /useJ3TamperConfigAlerts/);
  assert.match(dashboardClient, /alert\.domain === "J3"/);
  assert.match(notificationBell, /authorities\?\.includes\("emergency_j3_alert_config"\)/);
  assert.match(notificationBell, /useJ3TamperConfigAlerts\(canReadJ3Alerts\)/);
  assert.match(notificationBell, /\.\.\.j3Alerts/);
  assert.match(notificationBell, /风险与应急告警/);
});

test("J3 empty account pages use a neutral feed state instead of a false warning", () => {
  assert.match(component, /TAMPER_ACCTS\.length === 0 \? "led dim"/);
  assert.match(component, /本页暂无高频账户/);
  assert.doesNotMatch(component, />\{fedCount\}\/\{TAMPER_ACCTS\.length\}/);
});

test("J3 preserves the selected window and account page across refresh and return navigation", () => {
  assert.match(jView, /readJ3LocationState/);
  assert.match(jView, /persistJ3LocationState/);
  assert.match(jView, /url\.searchParams\.set\("window", windowKey\)/);
  assert.match(jView, /url\.searchParams\.set\("accountPage", String\(page\)\)/);
  assert.match(jView, /fetchJEmergencyOverviews\(tab, j3State\.window, j3State\.page, j3State\.pageSize\)/);
  assert.match(jView, /persistJ3LocationState\(window, tamper\.accountPage\.page, tamper\.accountPage\.pageSize\)/);
  assert.doesNotMatch(component, /ctx\.emergency\.tamper!\.window !== "24h"/);
});

test("J3 records H2 trial state and charge tamper at the live controller boundary", () => {
  assert.match(canonicalBoundaryController, /return service\.rejectTrialStateTamper\(userId\)/);
  assert.match(canonicalBoundaryController, /return service\.chargeTrial\(\s*userId,\s*body\.chargeSucceeded\(\),\s*body\.chargeFailRate\(\),\s*idempotencyKey\)/);
  assert.match(canonicalBoundaryService, /rejectTrialStateTamper\(Long userId\)[\s\S]{0,280}"free_trial_state"/);
  assert.match(canonicalBoundaryService, /chargeTrial\([\s\S]{0,400}executeOnce\("TRIAL_CHARGE"/);
  assert.match(canonicalBoundaryService, /chargeTrialInternal\([\s\S]{0,400}"charge_fail_rate"/);
  assert.match(canonicalBoundaryService, /"\/api\/trial\/eligibility"/);
  assert.match(canonicalBoundaryService, /"\/api\/trial\/charge"/);
});

test("J3 acceptance artifacts can be routed into the restricted Run directory", () => {
  assert.match(independentAcceptance, /J3_EVIDENCE_DIR/);
});
