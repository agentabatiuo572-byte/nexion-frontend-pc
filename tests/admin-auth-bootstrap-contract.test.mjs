import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { completeInteractiveLogin } from "../lib/admin/login-completion.ts";
import { authoritativeAdminSessionPayload } from "../lib/admin/session-response.ts";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const hinted = {
  tokenType: "Bearer",
  session: {
    adminId: 11,
    username: "maker",
    operator: "Maker",
    role: "auditor",
    authorities: ["user_c1_read"],
  },
};

const authoritative = {
  tokenType: "Bearer",
  session: {
    ...hinted.session,
    authorities: ["user_c1_read", "user_c2_read"],
  },
};

test("interactive login commits only the follow-up authoritative server session", async () => {
  const calls = [];
  const result = await completeInteractiveLogin(
    (auth) => calls.push(["signIn", auth]),
    hinted,
    { readAuthoritativeSession: async () => {
      calls.push(["session"]);
      return authoritative;
    } },
  );

  assert.equal(result, authoritative);
  assert.deepEqual(calls, [["session"], ["signIn", authoritative]]);
});

test("interactive login fails closed when the cookie-backed session is absent or changes identity", async () => {
  let commits = 0;
  await assert.rejects(
    completeInteractiveLogin(
      () => { commits += 1; },
      hinted,
      { readAuthoritativeSession: async () => null },
    ),
    /ADMIN_SESSION_NOT_ESTABLISHED/,
  );
  await assert.rejects(
    completeInteractiveLogin(
      () => { commits += 1; },
      hinted,
      { readAuthoritativeSession: async () => ({
        ...authoritative,
        session: { ...authoritative.session, adminId: 12, username: "other" },
      }) },
    ),
    /ADMIN_SESSION_IDENTITY_MISMATCH/,
  );
  assert.equal(commits, 0);
});

test("only HTTP 401 is anonymous; malformed 200 and upstream failures remain fail-closed errors", () => {
  assert.equal(authoritativeAdminSessionPayload(401, false, { code: 401, data: null }), null);
  assert.equal(authoritativeAdminSessionPayload(200, true, { code: 0, data: { session: { adminId: 1 } } }).session.adminId, 1);
  assert.throws(() => authoritativeAdminSessionPayload(200, true, { code: 0, data: {} }), /ADMIN_SESSION_INVALID/);
  assert.throws(() => authoritativeAdminSessionPayload(200, true, { code: 0, data: null }), /ADMIN_SESSION_INVALID/);
  assert.throws(() => authoritativeAdminSessionPayload(403, false, { code: 403, data: null }), /ADMIN_SESSION_INVALID/);
  assert.throws(() => authoritativeAdminSessionPayload(503, false, { code: 503, data: null }), /ADMIN_SESSION_INVALID/);
});

test("shell bootstrap never renders the login form before the authoritative session decision", () => {
  const shell = read("app/components/shell/console-shell.tsx");
  const login = read("app/components/shell/login-gate.tsx");
  const authClient = read("lib/admin/auth-client.ts");

  assert.match(shell, /type AdminBootstrapState = "checking" \| "authenticated" \| "anonymous" \| "error"/);
  assert.match(shell, /function AdminSessionBootstrapGate\(\)/);
  assert.match(shell, /function AdminSessionRecoveryGate/);
  assert.match(shell, /bootstrapAttemptRef = useRef\(0\)/);
  assert.match(shell, /if \(!mounted \|\| bootstrapState === "checking"\) return <AdminSessionBootstrapGate \/>/);
  assert.match(shell, /if \(bootstrapState === "error"\) return <AdminSessionRecoveryGate/);
  assert.match(shell, /if \(bootstrapState === "anonymous"\) return <LoginGate onAuthenticated=/);
  assert.match(shell, /attempt !== bootstrapAttemptRef\.current/);
  assert.match(login, /await completeInteractiveLogin\(/);
  assert.match(login, /readAuthoritativeSession: currentAdminSession/);
  assert.doesNotMatch(authClient, /response\.status === 401 \|\| !result\?\.data\?\.session/);
});
