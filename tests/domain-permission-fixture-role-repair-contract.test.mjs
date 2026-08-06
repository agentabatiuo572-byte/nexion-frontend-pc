import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./e2e/domain-permission-fixture-role-repair.spec.ts", import.meta.url),
  "utf8",
);

test("role repair is explicit, loopback-only, and run-scoped", () => {
  for (const name of [
    "DOMAIN_ROLE_REPAIR",
    "DOMAIN_ROLE_REPAIR_BASE_URL",
    "DOMAIN_ROLE_REPAIR_RUN_ID",
    "DOMAIN_ROLE_REPAIR_RESTRICTED_ROOT",
    "DOMAIN_ROLE_REPAIR_OPERATOR",
    "DOMAIN_ROLE_REPAIR_OPERATOR_PASSWORD",
  ]) {
    assert.match(source, new RegExp(`(?:process\\.env\\.${name}|required\\("${name}"\\))`), name);
  }
  assert.match(source, /fixture role repair only permits a loopback admin endpoint/);
  assert.match(source, /bug-pic\[\\\\\/\]\\\\?\.restricted/i);
});

test("all A-M domains use exact menu, read, and maker allowlists", () => {
  for (const domain of "ABCDEFGHIJKLM") {
    assert.match(source, new RegExp(`${domain}: \\{`), domain);
  }
  assert.match(source, /modules: \["G1", "G2", "G3", "G4", "G7"\]/);
  assert.match(source, /modules: \["H1", "H2", "H3", "H4", "H5", "H7", "H8"\]/);
  assert.match(source, /modules: \["I1", "I2", "I3", "I4", "I5", "I6"\]/);
  assert.match(source, /platform_a2_operation_approve/);
  assert.match(source, /user_c3_adjust_approve/);
  assert.match(source, /finance_d2_withdrawal_approve/);
  assert.match(source, /bi_l5_task_approve/);
  assert.match(source, /bi_l5_decrypt_export/);
  assert.match(source, /const CHECKER_ONLY = \[[\s\S]*"device_e6_write"/);
  assert.match(source, /const CHECKER_REQUIRED_MUTATIONS = \["platform_a6_role_grants_update"\]/);
});

test("repair uses two-person grants, fresh CAS, and exact post-login snapshots", () => {
  assert.match(source, /\/platform\/roles\/\$\{plan\.roleId\}\/grants/);
  assert.match(source, /grants:\$\{grantFingerprint\}/);
  assert.match(source, /progress\.roles\[plan\.key\]\.approved = false/);
  assert.match(source, /persistedGrant\.ticketId && persistedGrant\.approved !== true && plan\.key !== "CHECKER\.checker"/);
  assert.match(source, /plan\.ticketId = persistedGrant\.ticketId/);
  assert.match(source, /\/platform\/audit\/operations\/\$\{ticketId\}\/approve/);
  assert.match(source, /approve:\$\{approvalFingerprint\}/);
  assert.match(source, /expectedVersion: String\(current\.version\)/);
  assert.match(source, /role:\$\{desiredRole\}:v\$\{current\.version\}/);
  assert.match(source, /pre-elevation-revoke:v\$\{current\.version\}/);
  assert.match(source, /desiredRole\.toLowerCase\(\) === "super"/);
  assert.match(source, /\/platform\/accounts\/\$\{accountId\}\/role/);
  assert.match(source, /sameSet\(session\.authorities, expectedPermissions\)/);
  assert.match(source, /sameSet\(session\.menuCodes, expectedMenuCodes\)/);
  assert.match(source, /roleCode: "unassigned", permissions: \[\], menuCodes: \[\]/);
});

test("repair is resumable and extends cleanup metadata without exposing credentials", () => {
  assert.match(source, /test\.use\(\{ trace: "off", video: "off", screenshot: "off" \}\)/);
  assert.match(source, /MFA_VERIFY_FAILED status=\$\{verification\.status\(\)\} code=\$\{payload\?\.code/);
  assert.doesNotMatch(source, /MFA_VERIFY_FAILED[\s\S]{0,200}response\.text/);
  assert.match(source, /MFA_VERIFY_SESSION_NOT_ESTABLISHED/);
  assert.match(source, /const authDeadline = Date\.now\(\) \+ 15_000/);
  assert.match(source, /const sessionDeadline = Date\.now\(\) \+ 15_000/);
  assert.match(source, /browserSession\.status < 400 && browserSession\.code === 0 && browserSession\.sessionPresent/);
  assert.match(source, /const explicitEnvelopeFailure = typeof payload\?\.code === "number" && payload\.code !== 0/);
  assert.doesNotMatch(source, /for \(let attempt = 0; attempt < 2/);
  assert.match(source, /const lastTotpStepBySecretHash = new Map<string, number>\(\)/);
  assert.match(source, /await freshTotpWindow\(account\.totpSecret\)/);
  assert.match(source, /createHash\("sha256"\)\.update\(secret\)\.digest\("hex"\)/);
  assert.match(source, /page\.evaluate\(async \(\) =>/);
  assert.match(source, /accessTokenExposed=\$\{accessTokenExposed\}/);
  assert.match(source, /requestForwardedProto=\$\{cookieState\.requestForwardedProto/);
  assert.match(source, /cookiePresent=\$\{cookieState\.cookiePresent\} setCookiePresent=\$\{cookieState\.setCookiePresent\}/);
  assert.match(source, /ensureAdminCookieFromVerifyResponse/);
  assert.match(source, /await verification\.allHeaders\(\)/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^)]*(?:setCookie|token)/);
  assert.match(source, /await page\.reload\(\{ waitUntil: "domcontentloaded" \}\)/);
  assert.match(source, /role-repair-progress\.json/);
  assert.match(source, /safe-role-summary\.json/);
  assert.match(source, /cleanup-manifest\.json/);
  assert.match(source, /writeFile\(temporary/);
  assert.match(source, /rename\(temporary, file\)/);
  assert.doesNotMatch(source, /Admin@123456/);
  assert.doesNotMatch(source, /A123456789Z/);
});

test("repair fails closed before approvals and bootstraps a least-privilege checker", () => {
  const quarantine = source.indexOf("await quarantineDomainAccounts");
  const ensureRoles = source.indexOf("await ensureRoleAndGrant");
  const checkerApproval = source.indexOf("await bootstrapIndependentChecker");
  const domainApproval = source.indexOf("plans.filter((plan) => plan.kind !== \"checker\")");
  assert.ok(quarantine > 0 && quarantine < ensureRoles);
  assert.ok(checkerApproval > ensureRoles);
  assert.ok(checkerApproval < domainApproval);
  assert.match(source, /async function bootstrapIndependentChecker[\s\S]*"CHECKER\.checker"[\s\S]*restricted = true/);
  assert.match(source, /platform_a2_operation_approve/);
  assert.match(source, /const failures: string\[\] = \[\]/);
  assert.match(source, /fail-closed quarantine incomplete; no role may be approved/);
  assert.match(source, /const quarantinedDomainAssignments = DOMAINS\.flatMap/);
  assert.match(source, /CHECKER\.failclosed/);
  assert.match(source, /checker bootstrap failed and fail-closed cleanup also failed/);
});

test("repair rejects path and role collisions before mutating grants", () => {
  assert.match(source, /await realpath\(path\.resolve\("D:\/workspace\/bug-pic\/\.restricted"\)\)/);
  assert.match(source, /path\.relative\(allowedBase, canonicalRoot\)/);
  assert.match(source, /createHash\("sha256"\)\.update\(config\.runId\)/);
  assert.match(source, /roleCode collision with a foreign or builtin role/);
  assert.match(source, /persisted role identity does not belong to this Run/);
  assert.match(source, /await validatePlanPermissions\(page, plans\)/);
  assert.match(source, /await recordRoleCleanup\(config, plan\)/);
});
