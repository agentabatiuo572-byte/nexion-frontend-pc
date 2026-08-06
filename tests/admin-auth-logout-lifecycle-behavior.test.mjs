import assert from "node:assert/strict";
import test from "node:test";

test("logout lets concurrent reads settle naturally but discards their old-generation results", async () => {
  const calls = [];
  const pending = [];
  let immediateStatus = null;
  const nativeFetch = (input, init = {}) => {
    calls.push({ input: String(input), init });
    if (immediateStatus != null || init.method === "POST") {
      return Promise.resolve(new Response(null, { status: immediateStatus ?? 204 }));
    }
    return new Promise((resolve, reject) => {
      const record = { resolve, reject };
      pending.push(record);
      if (init.signal?.aborted) {
        reject(init.signal.reason);
        return;
      }
      init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  };

  globalThis.window = {
    location: { href: "http://admin.test/platform/audit", origin: "http://admin.test" },
    fetch: nativeFetch,
  };

  const lifecycle = await import(`../lib/admin/auth-lifecycle.ts?behavior=${Date.now()}`);
  lifecycle.installAdminAuthFetchLifecycle();
  const installedFetch = window.fetch;
  lifecycle.installAdminAuthFetchLifecycle();
  assert.equal(window.fetch, installedFetch, "repeated shell initialization must not stack fetch guards");

  const inflight200 = window.fetch(new Request("http://admin.test/api/admin/platform/audit/overview"));
  const inflight401 = window.fetch("/api/admin/platform/permissions");
  await Promise.resolve();
  lifecycle.beginAdminLogout();
  let inflightSettled = false;
  void Promise.allSettled([inflight200, inflight401]).then(() => { inflightSettled = true; });
  await Promise.resolve();
  assert.equal(inflightSettled, false, "reads already in flight must survive until revocation is confirmed");

  const callCount = calls.length;
  await assert.rejects(
    window.fetch("/api/admin/platform/permissions?pageNum=1"),
    (error) => error instanceof lifecycle.AdminLogoutAbortError,
  );
  assert.equal(calls.length, callCount, "a read started after logout must not reach the network");

  immediateStatus = 200;
  const publicRead = await window.fetch("https://status.test/api/admin/health");
  assert.equal(publicRead.status, 200, "cross-origin reads must bypass the admin lifecycle");

  immediateStatus = 204;
  const logout = await window.fetch("/api/admin/auth/logout", { method: "POST" });
  assert.equal(logout.status, 204, "the revocation command must bypass the read guard");
  lifecycle.completeAdminLogout();
  await assert.rejects(
    window.fetch("/api/admin/platform/audit/overview"),
    (error) => error instanceof lifecycle.AdminAuthEpochChangedError,
  );
  let lateBodiesConsumed = 0;
  const late200 = new Response(JSON.stringify({ code: 0 }), { status: 200 });
  const late401 = new Response(JSON.stringify({ code: 401 }), { status: 401 });
  for (const lateResponse of [late200, late401]) {
    const consume = lateResponse.arrayBuffer.bind(lateResponse);
    lateResponse.arrayBuffer = async () => {
      const body = await consume();
      lateBodiesConsumed += 1;
      return body;
    };
  }
  pending[0].resolve(late200);
  pending[1].resolve(late401);
  const stale200 = await inflight200;
  const stale401 = await inflight401;
  assert.equal(stale200.status, 409);
  assert.equal(stale401.status, 409);
  assert.equal(stale200.headers.get("x-nexion-admin-auth-stale"), "1");
  assert.equal(stale401.headers.get("x-nexion-admin-auth-stale"), "1");
  assert.deepEqual(await stale200.json(), { code: 409, message: "ADMIN_AUTH_EPOCH_CHANGED", data: null });
  assert.deepEqual(await stale401.json(), { code: 409, message: "ADMIN_AUTH_EPOCH_CHANGED", data: null });
  assert.equal(lateBodiesConsumed, 2, "late response bodies must finish before the stale outcome settles");
  assert.equal(inflightSettled, true, "both underlying 200 and 401 responses must finish without lifecycle abort");
  delete globalThis.window;
});

test("cancel, relogin epoch changes, cross-account races, and ordinary 401 stay fail-closed", async () => {
  const pending = [];
  let immediateStatus = 200;
  const nativeFetch = (_input, init = {}) => {
    if (immediateStatus != null) return Promise.resolve(new Response(null, { status: immediateStatus }));
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      if (init.signal?.aborted) {
        reject(init.signal.reason);
        return;
      }
      init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  };

  globalThis.window = {
    location: { href: "http://admin.test/platform/permissions", origin: "http://admin.test" },
    fetch: nativeFetch,
  };

  const lifecycle = await import(`../lib/admin/auth-lifecycle.ts?epoch=${Date.now()}`);
  lifecycle.installAdminAuthFetchLifecycle();
  lifecycle.beginAdminLogout();
  lifecycle.cancelAdminLogout();
  assert.equal((await window.fetch("/api/admin/platform/permissions")).status, 200);
  assert.equal(
    (await window.fetch(new URL("http://admin.test/api/admin/platform/audit/overview"))).status,
    200,
  );

  immediateStatus = null;
  const callerAbort = new AbortController();
  const callerCancelledRead = window.fetch("/api/admin/platform/permissions", {
    signal: callerAbort.signal,
  });
  const callerReason = new Error("CALLER_CANCELLED");
  callerAbort.abort(callerReason);
  await assert.rejects(callerCancelledRead, (error) => error === callerReason);

  const requestAbort = new AbortController();
  const requestCancelledRead = window.fetch(new Request(
    "http://admin.test/api/admin/platform/permissions",
    { signal: requestAbort.signal },
  ));
  const requestReason = new Error("REQUEST_CANCELLED");
  requestAbort.abort(requestReason);
  await assert.rejects(requestCancelledRead, (error) => error === requestReason);

  const oldAccountRead = window.fetch("/api/admin/platform/audit/overview");
  await Promise.resolve();
  lifecycle.renewAdminAuthLifecycle();
  pending.at(-1).resolve(new Response(null, { status: 401 }));
  const staleOldAccountRead = await oldAccountRead;
  assert.equal(staleOldAccountRead.status, 409);
  assert.equal(staleOldAccountRead.headers.get("x-nexion-admin-auth-stale"), "1");

  immediateStatus = 401;
  const unauthorized = await window.fetch("/api/admin/platform/permissions");
  assert.equal(unauthorized.status, 401, "a non-logout 401 must reach the caller unchanged");
  delete globalThis.window;
});
