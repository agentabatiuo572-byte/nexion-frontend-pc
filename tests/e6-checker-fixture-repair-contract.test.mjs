import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const focusedRepair = readFileSync(
  new URL("./e2e/e6-checker-fixture-repair-current-20260729.spec.ts", import.meta.url),
  "utf8",
);
const sharedRepair = readFileSync(
  new URL("./e2e/domain-permission-fixture-role-repair.spec.ts", import.meta.url),
  "utf8",
);

test("E6 checker repair is explicit, loopback-only, and pinned to the isolated Run", () => {
  for (const name of [
    "E6_CHECKER_FIXTURE_REPAIR",
    "E6_CHECKER_FIXTURE_BASE_URL",
    "E6_CHECKER_FIXTURE_RUN_ID",
    "E6_CHECKER_FIXTURE_RESTRICTED_ROOT",
    "E6_CHECKER_FIXTURE_OPERATOR",
    "E6_CHECKER_FIXTURE_OPERATOR_PASSWORD",
  ]) {
    assert.match(focusedRepair, new RegExp(`(?:process\\.env\\.${name}|required\\("${name}"\\))`), name);
  }
  assert.match(focusedRepair, /checker fixture repair only permits a loopback admin endpoint/);
  assert.match(focusedRepair, /bug-pic\[\\\\\/\]\\\\?\.restricted/i);
  assert.match(focusedRepair, /fixture\.runId !== config\.runId/);
  assert.match(focusedRepair, /progress\.runId !== config\.runId/);
});

test("repair adds exactly E6 delegated approval permission without granting flag-toggle", () => {
  assert.match(sharedRepair, /const CHECKER_ONLY = \[[\s\S]*"device_e6_write"/);
  assert.match(focusedRepair, /const REQUIRED_E6_PERMISSION = "device_e6_write"/);
  assert.match(focusedRepair, /const FORBIDDEN_E6_PERMISSION = "device_e6_flag_toggle"/);
  assert.match(focusedRepair, /existingEWritePermissions/);
  assert.match(focusedRepair, /expect\(existingEWritePermissions\.filter[\s\S]*REQUIRED_E6_PERMISSION[\s\S]*\)\.toEqual\(\[\]\)/);
  assert.match(focusedRepair, /permissionCodes: targetPermissions/);
  assert.match(focusedRepair, /expect\(sameSet\(roleAfter\.permissionCodes[\s\S]*targetPermissions/);
  assert.match(focusedRepair, /expect\(checkerSession\.authorities\)\.not\.toContain\(FORBIDDEN_E6_PERMISSION\)/);
  assert.match(focusedRepair, /sameSet\(\(roleAfter\.menuIds[\s\S]*originalMenuIds/);
});

test("repair preserves two-person approval and never approves an E business operation", () => {
  assert.match(focusedRepair, /expect\(fixture\.accounts\.maker\.accountId\)\.not\.toBe\(fixture\.checker\.accountId\)/);
  assert.match(focusedRepair, /\/platform\/roles\/\$\{checkerRoleId\}\/grants/);
  assert.match(focusedRepair, /\/platform\/audit\/operations\/\$\{grantTicketId\}\/approve/);
  assert.match(focusedRepair, /selfApproval\.status\(\)\)\.toBe\(403\)/);
  assert.match(focusedRepair, /expect\(makerForbidden\.status\(\)\)\.toBe\(403\)/);
  assert.match(focusedRepair, /expect\(grantTicketId\)\.not\.toBe\(BLOCKED_E_BUSINESS_TICKET\)/);
  assert.match(focusedRepair, /const BLOCKED_E_BUSINESS_TICKET = "WO-260729180749943-300"/);
  assert.match(focusedRepair, /\/api\/admin\/platform\/audit\/overview/);
  assert.match(focusedRepair, /expect\(blockedBusinessOperationStatus\)\.toBe\("rejected"\)/);
  assert.doesNotMatch(
    focusedRepair,
    /platform\/audit\/operations\/\$\{BLOCKED_E_BUSINESS_TICKET\}\/approve/,
  );
});

test("repair revokes old sessions and verifies fresh MFA, refresh, relogin, menus, and negative APIs", () => {
  assert.match(focusedRepair, /\/platform\/accounts\/\$\{fixture\.checker\.accountId\}\/sessions\/revoke/);
  assert.match(focusedRepair, /await loginWithMfa/);
  assert.match(focusedRepair, /await checkerPage\.reload\(\{ waitUntil: "domcontentloaded" \}\)/);
  assert.match(focusedRepair, /await logout\(/);
  assert.match(focusedRepair, /const makerForbidden = await makerPage\.request\.post/);
  assert.match(focusedRepair, /expect\(makerForbidden\.status\(\)\)\.toBe\(403\)/);
  assert.match(focusedRepair, /const unrelatedWrite = await checkerPage\.request\.post/);
  assert.match(focusedRepair, /expect\(unrelatedWrite\.status\(\)\)\.toBe\(403\)/);
  assert.match(focusedRepair, /safe-e6-checker-repair-summary\.json/);
  assert.match(focusedRepair, /blockedEBusinessTicketStatus: blockedBusinessOperationStatus/);
  assert.match(focusedRepair, /writeFile\(temporary/);
  assert.match(focusedRepair, /rename\(temporary, file\)/);
});
