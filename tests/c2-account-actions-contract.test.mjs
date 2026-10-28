import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actionSource = readFileSync(new URL("../app/components/domain-views/c-tabs/c2-actions.tsx", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../lib/admin/user360-client.ts", import.meta.url), "utf8");
const errorMessageSource = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/impersonation/view/route.ts", import.meta.url), "utf8");
const usersRouteSource = readFileSync(new URL("../app/api/admin/users/[...path]/route.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../lib/admin/ops-dashboard-client.ts", import.meta.url), "utf8");
const notificationSource = readFileSync(new URL("../app/components/shell/notification-bell.tsx", import.meta.url), "utf8");

test("C2 renders exact permission gates and exact state transitions", () => {
  for (const permission of [
    "user_c2_account_freeze",
    "user_c2_account_unfreeze",
    "user_c2_session_revoke_all",
    "user_c2_impersonate_start",
    "user_c2_impersonate_terminate",
    "user_c2_blocklist_add",
  ]) assert.match(actionSource, new RegExp(permission));
  assert.match(actionSource, /status === "ACTIVE" && canFreeze/);
  assert.match(actionSource, /status === "FROZEN" && canUnfreeze/);
  assert.doesNotMatch(actionSource, /const locked = status !== "ACTIVE"/);
});

test("C2 rejects malformed 200 overview payloads instead of rendering false zeroes", () => {
  assert.match(clientSource, /function requireC2Overview\(/);
  assert.match(clientSource, /C2_RESPONSE_INVALID/);
  assert.match(clientSource, /return requireC2Overview\(await usersRequest<unknown>\("\/account-actions\/overview"\)\)/);
  assert.match(actionSource, /if \(!overview\) \{[\s\S]{0,900}数据暂不可用，已暂停显示和操作/);
});

test("C2 distinguishes A2 proposal-only actors from direct executors", () => {
  assert.match(actionSource, /platform_a2_proposal_create/);
  assert.match(actionSource, /platform_a2_operation_approve/);
  assert.match(actionSource, /session\?\.role === "finance"/);
  assert.match(actionSource, /const freezeProposalOnly = session\?\.role === "finance"/);
  assert.match(actionSource, /if \(!freezeProposalOnly\)/);
  assert.match(actionSource, /提交后需在「操作记录与审批」确认才生效/);
  assert.match(actionSource, /updateUserStatus\(id, "FROZEN", reasonCode/);
  assert.match(actionSource, /该用户在 \$\{activeCount\} 台设备上立即下线/);
  assert.match(actionSource, /revokeUserSessions\(id, reason, OPERATOR\(\)\)/);
});

test("C2 collects structured reasons, exact TTLs and expiry", () => {
  assert.match(actionSource, /RISK_HIT/);
  assert.match(actionSource, /USER_ISSUE_REPRO/);
  assert.match(actionSource, /options: \["5", "10", "15", "30"\]/);
  assert.match(actionSource, /expiryMode/);
  assert.match(actionSource, /reasonMin: 8/);
  assert.match(actionSource, /reasonMax: 200/);
});

test("impersonation uses a dedicated server token and read-only mirror", () => {
  assert.match(clientSource, /fetchImpersonationReadonlyView/);
  assert.match(routeSource, /Authorization/);
  assert.match(actionSource, /只能查看，所有修改都会被拒绝/);
  assert.match(actionSource, /data-testid="impersonation-countdown"/);
  assert.match(actionSource, /退出并结束只读查看/);
  assert.match(actionSource, /模拟登录已到期，已自动关闭/);
  assert.match(actionSource, /setMirrorToken\(""\)/);
  assert.match(actionSource, /maskedSessionId\(session\.refreshTokenId\)/);
  assert.doesNotMatch(actionSource, /<td[^>]*>\{text\(session\.refreshTokenId\)\}<\/td>/);
});

test("C2 canonical events reach a role-trimmed human-visible alert feed", () => {
  assert.match(usersRouteSource, /account-actions\/alerts/);
  assert.match(dashboardSource, /fetchC2HighRiskAlerts/);
  assert.match(dashboardSource, /useC2HighRiskAlerts/);
  assert.match(dashboardSource, /alert\.domain === "C2"/);
  assert.match(notificationSource, /const canReadC2Alerts = canReadC2HighRiskAlerts\(session\)/);
  assert.match(notificationSource, /\.\.\.c2Alerts/);
});

test("C2 account-list A4 registration rejection remains visible and actionable", () => {
  assert.match(actionSource, /upsertUserAccountList\(id, kind, reason, OPERATOR\(\), expiresAt\)/);
  assert.match(actionSource, /UsersRequestError/);
  assert.match(actionSource, /error\.code === "A4_SCHEMA_NOT_REGISTERED"/);
  assert.match(actionSource, /名单未生效：系统配置缺失，请联系技术人员处理后重试。/);
  assert.match(actionSource, /accountListErrorMessage/);
  assert.match(
    errorMessageSource,
    /A4_SCHEMA_NOT_REGISTERED: "系统事件登记不完整，操作未生效。请联系平台管理员修复配置后重试。"/,
  );
  assert.doesNotMatch(errorMessageSource, /A4 Schema Registry/);
});
