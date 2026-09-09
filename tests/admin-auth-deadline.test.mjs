import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fetchAdminAuthBffResponse, fetchAdminAuthResponse, withAdminAuthDeadline } from "../lib/admin/auth-deadline.ts";

const root = process.cwd();
const read = (path) => readFileSync(`${root}/${path}`, "utf8");

test("admin-auth deadline aborts a request that never returns response headers", async () => {
  let observedAbort = false;

  await assert.rejects(
    () => withAdminAuthDeadline(
      (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          observedAbort = true;
          reject(signal.reason);
        }, { once: true });
      }),
      { timeoutMs: 15 },
    ),
    (error) => error instanceof DOMException && error.name === "TimeoutError" && error.message === "NETWORK_FAILURE",
  );

  assert.equal(observedAbort, true);
});

test("admin-auth deadline remains live while the upstream response body hangs", async () => {
  let enteredBodyReader = false;
  let observedAbort = false;

  await assert.rejects(
    () => fetchAdminAuthResponse(
      "http://auth.invalid/login",
      { method: "POST" },
      async (response) => {
        enteredBodyReader = true;
        return response.text();
      },
      {
        timeoutMs: 15,
        fetchImpl: async (_input, init) => ({
          text: () => new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              observedAbort = true;
              reject(init.signal.reason);
            }, { once: true });
          }),
        }),
      },
    ),
    (error) => error instanceof DOMException && error.name === "TimeoutError" && error.message === "NETWORK_FAILURE",
  );

  assert.equal(enteredBodyReader, true);
  assert.equal(observedAbort, true);
});

test("admin-auth deadline rejects pre-aborted callers without invoking the operation", async () => {
  const caller = new AbortController();
  const reason = new DOMException("page left before request", "AbortError");
  caller.abort(reason);
  let invocations = 0;

  await assert.rejects(
    () => withAdminAuthDeadline(async () => {
      invocations += 1;
      return "must not run";
    }, { signal: caller.signal }),
    (error) => error === reason,
  );
  assert.equal(invocations, 0);
});

test("admin-auth deadline rejects a late success after timeout", async () => {
  await assert.rejects(
    () => withAdminAuthDeadline(
      () => new Promise((resolve) => setTimeout(() => resolve("late success"), 30)),
      { timeoutMs: 15 },
    ),
    (error) => error instanceof DOMException && error.name === "TimeoutError",
  );
});

test("admin-auth deadline preserves a caller cancellation and cleans up after success", async () => {
  const caller = new AbortController();
  const callerReason = new DOMException("page left", "AbortError");
  let receivedSignal;

  const pending = withAdminAuthDeadline(
    (signal) => new Promise((_resolve, reject) => {
      receivedSignal = signal;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    { timeoutMs: 100, signal: caller.signal },
  );
  caller.abort(callerReason);
  await assert.rejects(pending, (error) => error === callerReason);

  let successfulSignal;
  assert.equal(
    await withAdminAuthDeadline(async (signal) => {
      successfulSignal = signal;
      return "ok";
    }, { timeoutMs: 15 }),
    "ok",
  );
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(receivedSignal.aborted, true);
  assert.equal(successfulSignal.aborted, false);
});

test("BFF auth timeout returns a 503 without issuing a cookie", async () => {
  const result = await fetchAdminAuthBffResponse(
    "http://auth.invalid/login",
    { method: "POST" },
    (response) => response.text(),
    {
      timeoutMs: 15,
      fetchImpl: async (_input, init) => ({
        text: () => new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        }),
      }),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.response.status, 503);
  assert.equal(result.response.headers.get("set-cookie"), null);
  assert.deepEqual(await result.response.json(), { code: 503, message: "ADMIN_AUTH_UNAVAILABLE", data: null });
});

test("all auth BFF upstream routes use the bounded response reader", () => {
  const routes = [
    "app/api/admin/auth/login/route.ts",
    "app/api/admin/auth/mfa/verify/route.ts",
    "app/api/admin/auth/session/route.ts",
    "app/api/admin/auth/password/change/route.ts",
  ];
  for (const route of routes) {
    const source = read(route);
    assert.match(source, /fetchAdminAuthBffResponse\(/, `${route} must bound response headers and body`);
    assert.match(source, /ADMIN_AUTH_UPSTREAM_TIMEOUT_MS/, `${route} must use the shorter BFF deadline`);
  }
  assert.match(read("lib/admin/auth-client.ts"), /withAdminAuthDeadline\(/, "browser auth requests need a final recovery deadline");
});
