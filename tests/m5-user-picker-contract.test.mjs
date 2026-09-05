import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("app/components/domain-views/m-tabs/m5-scripts.tsx", "utf8");
const modal = page.slice(page.indexOf("function AdvisorAssignModal("));

test("M5 candidate users have server pagination rather than an inaccessible first eight", () => {
  assert.match(modal, /fetchMAdvisorBindingUsers\(/);
  assert.doesNotMatch(modal, /fetchMSupportWorkbenchUsers\(/);
  assert.match(modal, /pageNum: userPage/);
  assert.match(modal, /setUserTotal\(page.total\)/);
  assert.match(modal, /<Pager page=\{userPage\} total=\{userTotal\}/);
  assert.doesNotMatch(modal, /pageNum: 1, pageSize: 8/);
});

test("M5 phone search resets pagination and explains suffix matching", () => {
  assert.match(modal, /setKeyword\(e.target.value\);\s*setUserPage\(1\)/);
  assert.match(modal, /手机号.*后.*4.*位/);
  assert.match(modal, /\[keyword, userPage, userReload\]/);
});

test("M5 user selection survives paging and failed searches can retry", () => {
  assert.match(modal, /setUserReload\(\(value\) => value \+ 1\)/);
  assert.match(modal, /if \(!alive\) return/);
  assert.doesNotMatch(modal.slice(modal.indexOf("useEffect("), modal.indexOf("const toggleUser")), /setSelectedUsers/);
  assert.match(modal, /user.phoneMasked/);
});

test("M5 page shrink recovery keeps stale candidates hidden until the corrected page returns", () => {
  assert.match(modal, /if \(safePage !== userPage\) \{\s*setUsers\(\[\]\);\s*setUserTotal\(page.total\);\s*pageRedirected = true;/);
  assert.match(modal, /if \(alive && !pageRedirected\) setLoading\(false\)/);
});
