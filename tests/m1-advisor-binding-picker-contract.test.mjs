import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

const overview = read("app/components/domain-views/m-tabs/m1-overview.tsx");
const client = read("lib/admin/m-client.ts");
const roleModal = overview.slice(overview.indexOf("function SupportSeatRoleModal("), overview.indexOf("function SeatAssignmentModal("));
const assignmentModal = overview.slice(overview.indexOf("function SeatAssignmentModal("));

test("M1 dedicated-binding queries use the least-privilege advisor endpoint", () => {
  assert.match(client, /fetchMAdvisorBindingUsers[\s\S]*?\/support-workbench\/advisor-users/);
  assert.match(client, /fetchMSupportWorkbenchUsers[\s\S]*?fetchSupportUsersPage\("users", query\)/);
  for (const modal of [roleModal, assignmentModal]) {
    assert.match(modal, /fetchMAdvisorBindingUsers\(/);
    assert.doesNotMatch(modal, /fetchMSupportWorkbenchUsers\(/);
    assert.match(modal, /phoneMasked/);
    assert.doesNotMatch(modal, /console\.(?:log|info|warn|error)\(/);
  }
});

test("M1 binding uses the server userId and never derives identity from a display number", () => {
  assert.match(client, /type MAdvisorBindingUser = [\s\S]*?userId: number/);
  assert.match(client, /assertAdvisorBindingUser/);
  assert.match(client, /records: asArray<unknown>\(page\.records\)\.map\(assertAdvisorBindingUser\)/);
  assert.match(overview, /function userIdOf\(profile: MAdvisorBindingUser\)[\s\S]*?profile\.userId/);
  assert.doesNotMatch(overview, /numericUserId\(profile\.userNo\)/);
});

test("both M1 binding dialogs page server results, reset search, and retain selections", () => {
  for (const modal of [roleModal, assignmentModal]) {
    assert.match(modal, /const \[userPage, setUserPage\] = useState\(1\)/);
    assert.match(modal, /const \[userTotal, setUserTotal\] = useState\(0\)/);
    assert.match(modal, /pageNum: userPage, pageSize: SUPPORT_USER_PAGE_SIZE/);
    assert.match(modal, /setUserTotal\(page\.total\)/);
    assert.match(modal, /<Pager page=\{userPage\} total=\{userTotal\} pageSize=\{SUPPORT_USER_PAGE_SIZE\} onPage=\{setUserPage\}/);
    assert.match(modal, /setUserPage\(1\)/);
  }
});

test("both M1 binding dialogs are race-safe, recover empty pages, and allow retry", () => {
  for (const modal of [roleModal, assignmentModal]) {
    assert.match(modal, /let alive = true/);
    assert.match(modal, /if \(!alive\) return/);
    assert.match(modal, /const safePage = clampPage\(userPage, page\.total, SUPPORT_USER_PAGE_SIZE\)/);
    assert.match(modal, /if \(safePage !== userPage\) \{\s*setUsers\(\[\]\);\s*setUserTotal\(page\.total\);/);
    assert.match(modal, /setUserReload\(\(value\) => value \+ 1\)/);
    assert.match(modal, /暂无匹配用户/);
  }
});

test("M1 does not open or load dedicated-binding candidates for an unauthorized operator", () => {
  assert.match(overview, /const canManageSupportSeats = canWriteM1 &&/);
  assert.match(overview, /canManage=\{canManageSupportSeats\}/);
  assert.match(roleModal, /const canAssignSupportStaff = canManage &&/);
  assert.match(roleModal, /if \(!assigningDedicated \|\| !canAssignSupportStaff\)/);
  assert.match(assignmentModal, /if \(!canManage\)/);
});

test("selected candidates remain bindable through the existing audited assignment write", () => {
  for (const modal of [roleModal, assignmentModal]) {
    assert.match(modal, /const userIds = [\s\S]*?bindableSelectedUsers/);
  }
  assert.match(overview, /I\.support\.seatAssignment\.__update/);
  assert.match(overview, /I\.support\.advisorAssignment\.__create/);
});
