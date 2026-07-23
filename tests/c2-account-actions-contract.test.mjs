import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actionSource = readFileSync(new URL("../app/components/domain-views/c-tabs/c2-actions.tsx", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../lib/admin/user360-client.ts", import.meta.url), "utf8");
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

test("C2 distinguishes A2 proposal-only actors from direct executors", () => {
  assert.match(actionSource, /platform_a2_proposal_create/);
  assert.match(actionSource, /platform_a2_operation_approve/);
  assert.match(actionSource, /session\?\.role === "finance"/);
  assert.match(actionSource, /const freezeProposalOnly = session\?\.role === "finance"/);
  assert.match(actionSource, /if \(!freezeProposalOnly\)/);
  assert.match(actionSource, /确认(?:执行)?前业务状态不变/);
  assert.match(actionSource, /updateUserStatus\(id, "FROZEN", reasonCode/);
  assert.match(actionSource, /财务\/风控\/客服\/超管均直接执行/);
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
  assert.match(actionSource, /claim=\{text\(mirror\.claim\)\}/);
  assert.match(actionSource, /data-testid="impersonation-countdown"/);
  assert.match(actionSource, /退出并终止模拟会话/);
  assert.match(actionSource, /模拟会话已到期，只读镜像已自动关闭/);
  assert.match(actionSource, /setMirrorToken\(""\)/);
  assert.match(actionSource, /maskedSessionId\(session\.refreshTokenId\)/);
  assert.doesNotMatch(actionSource, /<td[^>]*>\{text\(session\.refreshTokenId\)\}<\/td>/);
});

test("C2 canonical events reach a role-trimmed human-visible alert feed", () => {
  assert.match(usersRouteSource, /account-actions\/alerts/);
  assert.match(dashboardSource, /fetchC2HighRiskAlerts/);
  assert.match(dashboardSource, /useC2HighRiskAlerts/);
  assert.match(dashboardSource, /alert\.domain === "C2"/);
  assert.match(notificationSource, /session\?\.role === "superadmin" \|\| state\.session\?\.role === "risk"/);
  assert.match(notificationSource, /\.\.\.c2Alerts/);
});
