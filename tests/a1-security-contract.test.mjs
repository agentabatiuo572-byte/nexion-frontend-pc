import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("A1 login keeps MFA as the default and permits only the explicit temporary server bypass", () => {
  const client = read("lib/admin/auth-client.ts");
  const gate = read("app/components/shell/login-gate.tsx");
  const loginRoute = read("app/api/admin/auth/login/route.ts");

  assert.match(client, /verifyAdminMfa/);
  assert.match(client, /mfa\/verify/);
  assert.match(client, /loginResult/);
  assert.match(gate, /mfaChallenge/);
  assert.match(gate, /result\.loginResult/);
  assert.match(gate, /一次性验证码/);
  assert.match(gate, /catch \(err\)/);
  assert.doesNotMatch(gate, /catch \{\s*setError\("账号或密码不正确"\)/);
  assert.match(loginRoute, /nexion_admin_token/);
  assert.match(loginRoute, /httpOnly:\s*true/);
  assert.match(loginRoute, /sameSite:\s*"strict"/);
});

test("logout revokes the server session and cookies never outlive eight hours", () => {
  const logout = read("app/api/admin/auth/logout/route.ts");
  const login = read("app/api/admin/auth/login/route.ts");
  const verify = read("app/api/admin/auth/mfa/verify/route.ts");

  assert.match(logout, /Authorization/);
  assert.match(logout, /\/auth\/logout/);
  assert.doesNotMatch(login + verify, /60 \* 60 \* 12/);
  assert.match(verify, /60 \* 60 \* 8/);
});

test("logout fails closed and preserves the retry token when server revocation is unavailable", () => {
  const logout = read("app/api/admin/auth/logout/route.ts");
  const topbar = read("app/components/shell/topbar.tsx");
  const logoutRequest = read("lib/admin/logout-request.ts");

  assert.doesNotMatch(logout, /catch\(\(\) => null\)/);
  assert.match(logout, /status:\s*503/);
  assert.match(logout, /ADMIN_LOGOUT_UNAVAILABLE/);
  assert.ok(
    logout.indexOf("ADMIN_LOGOUT_UNAVAILABLE") < logout.indexOf("response.cookies.set"),
    "a failed server revocation must return before the retry credential cookie is cleared",
  );
  assert.match(logoutRequest, /if \(!response\.ok \|\| !isConfirmedLogoutEnvelope\(envelope\)\)/);
  assert.match(logoutRequest, /ADMIN_LOGOUT_CONFIRMATION_FAILED/);
  assert.match(topbar, /await requestAdminLogout\(\)/);
  assert.match(topbar, /beginLogoutVerification\(\)/);
  assert.match(topbar, /if \(auth\) cancelLogout\("服务端会话仍有效，退出未完成，请重试"\)/);
  assert.match(topbar, /failLogoutUnknown\("服务端会话状态无法确认，已停止进入后台"\)/);
  assert.doesNotMatch(topbar, /finally\s*\{\s*signOut\(\)/);
});

test("A1 creation defaults to no role and destructive delete is absent", () => {
  const page = read("app/components/domain-views/a-tabs/a1-accounts.tsx");
  const client = read("lib/admin/a1-client.ts");

  assert.match(page, /暂不分配/);
  assert.match(page, /const defaultRole\s*=\s*""/);
  assert.doesNotMatch(page, /generateDefaultInitialPassword/);
  assert.doesNotMatch(page, /setInitialPassword/);
  assert.match(page, /服务端生成 20 位四类强临时密码/);
  assert.match(client, /A1OutcomeUncertainError/);
  assert.match(client, /X-Nexion-Upstream-Outcome/);
  assert.doesNotMatch(page, /deleteAccount\(/);
  assert.doesNotMatch(page, /删除账号/);
});

test("role changes expose A6 permission differences and disable no-op submission", () => {
  const page = read("app/components/domain-views/a-tabs/a1-accounts.tsx");

  assert.match(page, /grantsByRole/);
  assert.match(page, /actions:/);
  assert.match(page, /roleStr\s*===\s*op\.role/);
});

test("role changes fail closed when the A6 permission difference cannot be loaded", () => {
  const page = read("app/components/domain-views/a-tabs/a1-accounts.tsx");

  assert.match(page, /permissionDiffReady/);
  assert.match(page, /!permissionDiffReady/);
  assert.match(page, /权限差异预览不可用/);
});

test("A1 prevents impossible MFA reset and effective-super reduction in the UI", () => {
  const page = read("app/components/domain-views/a-tabs/a1-accounts.tsx");

  assert.match(page, /!op\.tfa\)\s*return\s*"该账号尚未绑定双因子/);
  assert.match(page, /effectiveSupers\s*<=\s*2/);
  assert.match(page, /reset2faBlockReason\(op\)/);
  assert.match(page, /disableAccountBlockReason\(op\)/);
});

test("A1 renders the server's English lock baseline instead of a blank trigger count", () => {
  const page = read("app/components/domain-views/a-tabs/a1-accounts.tsx");

  assert.match(page, /times\|次/);
  assert.doesNotMatch(page, /四条锁死,四项可调/);
  assert.match(page, /lock_long_cnt/);
  assert.match(page, /lock_long_hour/);
});

test("A1 account details expose server-backed role history", () => {
  const client = read("lib/admin/a1-client.ts");
  const page = read("app/components/domain-views/a-tabs/a1-accounts.tsx");

  assert.match(client, /roleHistory/);
  assert.match(page, /角色变更记录/);
  assert.match(page, /CURRENT_ASSIGNMENT/);
});

test("A1 single-session revocation is mapped through the platform BFF", () => {
  const client = read("lib/admin/a1-client.ts");
  const platformRoute = read("app/api/admin/platform/[...path]/route.ts");

  assert.match(client, /accounts\/\$\{encodeURIComponent\(accountId\)\}\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/revoke/);
  assert.match(platformRoute, /parts\.length\s*===\s*5/);
  assert.match(platformRoute, /parts\[2\]\s*===\s*"sessions"/);
  assert.match(platformRoute, /parts\[4\]\s*===\s*"revoke"/);
  assert.match(platformRoute, /accounts\/\$\{encodeURIComponent\(parts\[1\]\)\}\/sessions\/revoke/);
  assert.match(platformRoute, /accounts\/\$\{encodeURIComponent\(parts\[1\]\)\}\/sessions\/\$\{encodeURIComponent\(parts\[3\]\)\}\/revoke/);
});

test("A1 empty mutation bodies are not forwarded as text/plain commands", () => {
  const platformRoute = read("app/api/admin/platform/[...path]/route.ts");

  assert.match(platformRoute, /const rawBody = hasBody \? await request\.text\(\) : undefined/);
  assert.match(platformRoute, /body: rawBody \? rawBody : undefined/);
});

test("MFA verification and first password change preserve browser session metadata", () => {
  const verify = read("app/api/admin/auth/mfa/verify/route.ts");
  const passwordChange = read("app/api/admin/auth/password/change/route.ts");

  for (const route of [verify, passwordChange]) {
    assert.match(route, /User-Agent/);
    assert.match(route, /X-Nexion-Client-IP/);
  }
});
