import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { normalizeSupportReadModes, supportIdentityLabel } from "../lib/admin/session-role.ts";
import { adminShellSessionKey } from "../lib/admin/shell-authorities.ts";

test("support identity follows actual qualifications, including both and neither", () => {
  assert.equal(supportIdentityLabel("support", ["PERSONAL"]), "专属客服");
  assert.equal(supportIdentityLabel("support", ["MANAGED"]), "客服主管");
  assert.equal(supportIdentityLabel("support", ["MANAGED", "PERSONAL"]), "客服主管 · 兼专属客服");
  assert.equal(supportIdentityLabel("support", []), "客服账号 · 未启用服务");
  assert.equal(supportIdentityLabel("support", undefined), "客服账号");
  assert.equal(supportIdentityLabel("superadmin", ["ALL"]), undefined);
  for (const role of ["finance", "risk", "content", "growth", "config", "auditor", "custom"]) {
    assert.equal(supportIdentityLabel(role, []), undefined);
    assert.equal(supportIdentityLabel(role, ["MANAGED"]), "兼客服主管");
  }
});

test("session support modes preserve missing versus empty and reject malformed authority", () => {
  assert.equal(normalizeSupportReadModes(undefined), undefined);
  assert.deepEqual(normalizeSupportReadModes([]), []);
  assert.deepEqual(normalizeSupportReadModes(["PERSONAL", "ALL", "MANAGED"]), ["ALL", "MANAGED", "PERSONAL"]);
  for (const value of [null, "PERSONAL", {}, ["UNKNOWN"], ["PERSONAL", "PERSONAL"], [null]]) {
    assert.throws(() => normalizeSupportReadModes(value), /ADMIN_SESSION_INVALID/);
  }
});

test("same account qualification or grant changes invalidate old UI reads without changing command ownership", () => {
  const nativeRequire = createRequire(import.meta.url);
  const module = { exports: {} }, claimedOwners = [];
  let renewals = 0;
  const source = readFileSync(new URL("../lib/store/admin-auth.ts", import.meta.url), "utf8");
  const mocks = {
    "@/lib/admin/auth-lifecycle": {
      renewAdminAuthLifecycle: () => { renewals++; }, beginAdminLogout() {}, cancelAdminLogout() {}, completeAdminLogout() {},
    },
    "@/lib/admin/pending-mutation-store": { claimPendingCommandOwner: owner => claimedOwners.push(owner) },
    "@/lib/admin/shell-authorities": { adminShellSessionKey },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => mocks[name] ?? nativeRequire(name) });
  const store = module.exports.useAdminAuth;
  const base = { adminId: 1456, username: "qualified", operator: "Qualified", role: "support",
    authorities: ["service_m1_read", "service_m3_read"], menuCodes: ["M1", "M3"], supportReadModes: ["MANAGED", "PERSONAL"] };
  const signIn = session => store.getState().signIn({ tokenType: "Bearer", session });
  signIn(base);
  const first = store.getState().authEpoch;
  signIn({ ...base, authorities: [...base.authorities].reverse(), supportReadModes: [...base.supportReadModes].reverse() });
  assert.equal(store.getState().authEpoch, first, "equivalent grants do not reset work");
  let previous = first;
  for (const session of [
    { ...base, supportReadModes: ["PERSONAL"] },
    { ...base, supportReadModes: [] },
    { ...base, supportReadModes: undefined },
    { ...base, menuCodes: [] },
    { ...base, menuCodes: undefined },
    { ...base, role: "auditor", authorities: [], menuCodes: [] },
  ]) {
    signIn(session);
    assert.equal(store.getState().authEpoch, ++previous);
  }
  assert.equal(renewals, 7);
  assert.ok(claimedOwners.every(owner => owner === "1456"), "permission refresh retains same operator's pending commands");
});
