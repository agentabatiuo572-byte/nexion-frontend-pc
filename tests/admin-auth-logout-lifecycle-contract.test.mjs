import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("authenticated background GETs share one browser-auth generation lifecycle", () => {
  const lifecycle = read("lib/admin/auth-lifecycle.ts");

  assert.match(lifecycle, /class AdminLogoutAbortError extends Error/);
  assert.match(lifecycle, /class AdminAuthEpochChangedError extends Error/);
  assert.match(lifecycle, /export function installAdminAuthFetchLifecycle/);
  assert.match(lifecycle, /pathname\.startsWith\("\/api\/admin\/"\)/);
  assert.match(lifecycle, /method !== "GET" && method !== "HEAD"/);
  assert.match(lifecycle, /AbortSignal\.any/);
  assert.match(lifecycle, /readsBlocked: boolean/);
  assert.doesNotMatch(lifecycle, /controller\.abort/);
  assert.match(lifecycle, /requestEpoch !== current\.epoch/);
  assert.match(lifecycle, /await response\.arrayBuffer\(\)/);
  assert.match(lifecycle, /x-nexion-admin-auth-stale/);
  assert.doesNotMatch(lifecycle, /status\s*===\s*401/);
  assert.doesNotMatch(lifecycle, /response\.status\s*===\s*401/);
});

test("logout confirmation precedes epoch advance, stale-result invalidation, local clear, and navigation", () => {
  const auth = read("lib/store/admin-auth.ts");
  const topbar = read("app/components/shell/topbar.tsx");
  const body = topbar.slice(topbar.indexOf("async function handleSignOut"));

  assert.match(auth, /logoutPending: boolean/);
  assert.match(auth, /beginLogout: \(\) => void/);
  assert.match(auth, /cancelLogout: \(message: string\) => void/);
  assert.match(auth, /failLogoutUnknown: \(message: string\) => void/);
  assert.match(auth, /cancelAdminLogout\(\)/);
  assert.match(auth, /completeAdminLogout\(\)/);
  assert.match(auth, /renewAdminAuthLifecycle\(\)/);
  assert.match(auth, /logoutPending: true/);
  assert.match(auth, /logoutPending: false/);
  assert.match(auth, /authEpoch: state\.authEpoch \+ 1/);

  const begin = body.indexOf("beginLogout()");
  const revoke = body.indexOf("requestAdminLogout(");
  const success = body.indexOf("signOut()");
  const failure = body.indexOf("cancelLogout(");
  assert.ok(begin >= 0 && begin < revoke, "logout lifecycle must begin before server revocation");
  assert.ok(revoke < success, "browser session may clear only after successful server revocation");
  assert.ok(failure > success, "revocation failure must cancel pending logout without signing out");
  assert.doesNotMatch(body, /finally\s*\{\s*signOut\(\)/);

  const beginBody = auth.slice(auth.indexOf("beginLogout:"), auth.indexOf("cancelLogout:"));
  assert.doesNotMatch(beginBody, /beginAdminLogout\(\)/);
  assert.doesNotMatch(beginBody, /authEpoch:\s*state\.authEpoch\s*\+\s*1/);
  const signOutBody = auth.slice(auth.indexOf("signOut:"));
  assert.match(signOutBody, /completeAdminLogout\(\)/);
  assert.match(signOutBody, /authEpoch:\s*state\.authEpoch\s*\+\s*1/);
  assert.match(body, /const auth = await currentAdminSession\(\)/);
  assert.match(body, /if \(auth\) cancelLogout\(/);
  assert.match(body, /failLogoutUnknown\(/);
  assert.match(body, /logoutAttemptRef\.current/);
  assert.doesNotMatch(body, /router\.replace\(/);
});

test("authoritative anonymous state wins over stale bootstrap errors and history restores revalidate", () => {
  const shell = read("app/components/shell/console-shell.tsx");
  const auth = read("lib/store/admin-auth.ts");
  const client = read("lib/admin/auth-client.ts");

  assert.match(auth, /sessionResolution:\s*"unknown"\s*\|\s*"authenticated"\s*\|\s*"anonymous"/);
  assert.match(auth, /sessionResolution:\s*"anonymous"/);
  assert.match(shell, /if \(sessionResolution === "anonymous"\) return <LoginGate/);
  assert.ok(
    shell.indexOf('sessionResolution === "anonymous"') < shell.indexOf('bootstrapState === "error"'),
    "an old error snapshot must not cover an authoritative anonymous session",
  );
  assert.match(shell, /addEventListener\("pageshow"/);
  assert.match(shell, /addEventListener\("popstate"/);
  assert.match(shell, /event\.persisted/);
  assert.match(shell, /if \(logoutUnknown\) return <AdminSessionRecoveryGate/);
  assert.match(client, /const requestEpoch = adminAuthLifecycleEpoch\(\)/);
  assert.match(client, /requestEpoch !== adminAuthLifecycleEpoch\(\)/);
  assert.match(client, /throw new AdminAuthEpochChangedError\(\)/);
});

test("shell hides authenticated data while logout is pending and renews on relogin", () => {
  const shell = read("app/components/shell/console-shell.tsx");
  const auth = read("lib/store/admin-auth.ts");

  assert.match(shell, /installAdminAuthFetchLifecycle\(\)/);
  assert.match(shell, /const logoutPending = useAdminAuth/);
  assert.match(shell, /if \(logoutPending\) return <AdminLogoutGate \/>/);
  assert.match(shell, /function AdminLogoutGate\(\)/);
  assert.match(auth, /if \(state\.logoutPending\) return state/);
  assert.match(auth, /if \(identityChanged\) renewAdminAuthLifecycle/);
  assert.match(auth, /renewAdminAuthLifecycle\(\)/);
});

test("ordinary non-logout 401s still fail closed and are never globally swallowed", () => {
  const lifecycle = read("lib/admin/auth-lifecycle.ts");
  const a8 = read("lib/admin/a8-client.ts");
  const a2 = read("lib/admin/a2-client.ts");

  assert.doesNotMatch(lifecycle, /401/);
  assert.match(a8, /isAdminAuthFailure\(response\.status, result\?\.message\)/);
  assert.match(a8, /resetAdminSession\(\)/);
  assert.match(a8, /throw new Error\(formatAdminApiError/);
  assert.match(a2, /if \(!response\.ok \|\| !result \|\| result\.code !== 0\)/);
  assert.match(a2, /throw new Error\(formatAdminApiError/);
});
