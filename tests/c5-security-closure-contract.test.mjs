import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const c5 = readFileSync(new URL("../app/components/domain-views/c-tabs/c5-security.tsx", import.meta.url), "utf8");
const cView = readFileSync(new URL("../app/components/domain-views/c-view.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/user360-client.ts", import.meta.url), "utf8");
const errors = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");
const usersProxy = readFileSync(new URL("../app/api/admin/users/[...path]/route.ts", import.meta.url), "utf8");
const kConfirm = readFileSync(new URL("../app/components/domain-views/k-tabs/confirm-modal.tsx", import.meta.url), "utf8");

test("C5 executes stop-loss actions immediately and sends structured identity evidence", () => {
  assert.doesNotMatch(c5, /usePropose|findHighOp|A2 待确认|A2 队列/);
  for (const call of ["revokeUserSession", "revokeUserSessions", "disableUserTwoFactor", "requestUserPasswordReset", "unlockUserSecurity"]) {
    assert.match(c5, new RegExp(`await ${call}`));
  }
  for (const field of ["operatorConfirmed", "lockKind"]) {
    assert.match(client, new RegExp(field));
  }
});

test("C5 gates every action by current authority and server state", () => {
  for (const permission of [
    "user_c5_session_revoke_one",
    "user_c5_session_revoke_all",
    "user_c5_2fa_disable",
    "user_c5_password_reset",
    "user_c5_unlock_short",
    "user_c5_unlock_long",
    "user_c5_write",
  ]) {
    assert.match(c5, new RegExp(permission));
  }
  assert.match(c5, /selectedUser\.twoFactorEnabled/);
  assert.match(c5, /selectedUser\.passwordResetRequired/);
  assert.match(c5, /activeSessionCount/);
  assert.match(c5, /row\.lockKind === "LONG"/);
});

test("C5 rejects malformed success payloads and never preserves stale target data", () => {
  assert.match(client, /function requireC5Overview/);
  assert.match(client, /C5_RESPONSE_INVALID/);
  assert.match(c5, /setOverview\(null\)/);
  assert.match(c5, /NO_USER_SELECTION/);
  assert.match(c5, /重新加载/);
});

test("C5 empty lookup cleanup never erases an overview load failure", () => {
  assert.match(c5, /setError\(\(current\) => current\?\.startsWith\("C5 用户搜索失败"\) \? null : current\)/);
  assert.doesNotMatch(c5, /if \(!keyword\) \{[\s\S]{0,360}setError\(null\)/);
});

test("C5 clears a stale user without erasing global statistics and credential parameters", () => {
  assert.match(c5, /function clearSelectedUserFromOverview/);
  assert.match(c5, /selectedUser: null/);
  assert.match(c5, /setOverview\(clearSelectedUserFromOverview\)/);
  assert.doesNotMatch(c5, /selectedUserKey === NO_USER_SELECTION[\s\S]{0,160}setOverview\(null\)/);
});

test("C5 keeps an explicitly selected user while the decorated display label is shown", () => {
  assert.match(c5, /selectedLookupUser && keyword === profileLabel\(selectedLookupUser\)/);
  assert.match(c5, /setUserOptions\(\[selectedLookupUser\]\)/);
});

test("C5 masks credential identifiers and validates numeric configuration bounds", () => {
  assert.match(c5, /function maskSessionId/);
  assert.match(c5, /kind: "number"/);
  assert.match(c5, /min: toNumber\(param\.min/);
  assert.match(c5, /max: toNumber\(param\.max/);
  assert.doesNotMatch(c5, />\{sessionId\(selectedSession\)\}<\/span>/);
});

test("C5 renders localized session labels instead of raw backend status codes", () => {
  assert.match(c5, /function sessionStatusLabel/);
  assert.match(c5, /ACTIVE.*活跃/s);
  assert.match(c5, /REVOKED.*已撤销/s);
  assert.doesNotMatch(c5, />\{text\(session\.status\)\}<\/span>/);
});

test("C5 starts without an implicit target and hashes exact phone lookups before the request", () => {
  assert.match(c5, /useState\(NO_USER_SELECTION\)/);
  assert.match(c5, /function isRawPhoneLookup/);
  assert.match(c5, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(c5, /phoneHash:/);
  assert.match(c5, /placeholder="搜索用户编码 \/ 用户名 \/ 推荐码 \/ 手机号"/);
  assert.doesNotMatch(c5, /fetchUserProfilesPage\(\{ keyword: keyword \|\| undefined/);
});

test("C5 preserves only an explicitly selected target across refresh", () => {
  assert.match(c5, /usePathname\(\)/);
  assert.match(c5, /useRouter\(\)/);
  assert.match(c5, /params\.set\("userCode", userCode\)/);
  assert.match(c5, /params\.delete\("userCode"\)/);
  assert.match(c5, /router\.replace\(destination, \{ scroll: false \}\)/);
  assert.match(c5, /replaceFocusUserCode\(key\)/);
  assert.match(c5, /replaceFocusUserCode\(\)/);
});

test("C5 does not reapply a stale URL target while the operator edits the lookup", () => {
  assert.match(c5, /if \(selectedUserKey === focusUserCode\) return;[\s\S]{0,180}\}, \[focusUserCode\]\);/);
  assert.doesNotMatch(c5, /\}, \[focusUserCode, selectedUserKey\]\);/);
});

test("C5 explains the empty session table before a user is selected", () => {
  assert.match(c5, /selectedUserId \? "该用户暂无会话记录" : "请先搜索并选择用户查看会话"/);
});

test("C5 translates high-risk rejection and internal failure codes", () => {
  for (const code of [
    "C5_RESPONSE_INVALID",
    "C5_ACTION_STATE_CHANGED",
    "C5_UNLOCK_ROLE_FORBIDDEN",
    "INTERNAL_SERVER_ERROR",
  ]) {
    assert.match(errors, new RegExp(code));
  }
});

test("C5 keeps structured confirmation input open after a rejected server action", () => {
  assert.match(c5, /return false/);
  assert.match(c5, /return true/);
  assert.doesNotMatch(c5, /void perform/);
  assert.match(cView, /const succeeded = await mc\.run/);
  assert.match(cView, /succeeded !== false/);
  assert.match(kConfirm, /succeeded !== false/);
});

test("C5 uses action-bound operator confirmation and exact server session totals", () => {
  assert.match(usersProxy, /security\/sessions\/revoke-all/);
  assert.match(c5, /serverVerification:/);
  assert.match(c5, /operatorConfirmed:/);
  assert.match(c5, /overview\?\.selectedActiveSessionCount/);
  assert.doesNotMatch(c5, /activeSessionCount\s*=\s*sessions\.filter/);
  assert.match(c5, /前 5 个紧急账户/);
});
