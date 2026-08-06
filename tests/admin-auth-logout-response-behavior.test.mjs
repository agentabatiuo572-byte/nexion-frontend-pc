import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import(`../lib/admin/logout-request.ts?behavior=${Date.now()}-${Math.random()}`);
}

test("a valid 200 is not confirmed until the complete success envelope is read", async () => {
  const { requestAdminLogout } = await loadSubject();
  let releaseBody;
  const body = new Promise((resolve) => { releaseBody = resolve; });
  let settled = false;
  const request = requestAdminLogout({
    fetchImpl: async () => ({ ok: true, status: 200, json: () => body }),
    timeoutMs: 100,
  }).finally(() => { settled = true; });

  await Promise.resolve();
  assert.equal(settled, false, "headers alone must never confirm logout");
  releaseBody({ code: 0, message: "OK", data: null });
  await request;
  assert.equal(settled, true);
});

test("401, 500, malformed 200, disconnect, and timeout all fail closed", async (t) => {
  const { AdminLogoutConfirmationError, requestAdminLogout } = await loadSubject();
  const cases = [
    ["401", async () => new Response(JSON.stringify({ code: 401 }), { status: 401 })],
    ["500", async () => new Response(JSON.stringify({ code: 500 }), { status: 500 })],
    ["malformed", async () => new Response("not-json", { status: 200 })],
    ["wrong envelope", async () => new Response(JSON.stringify({ code: 7 }), { status: 200 })],
    ["disconnect", async () => { throw new TypeError("network down with bearer secret"); }],
    ["timeout", async (_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    })],
  ];

  for (const [name, fetchImpl] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        requestAdminLogout({ fetchImpl, timeoutMs: name === "timeout" ? 5 : 100 }),
        (error) => error instanceof AdminLogoutConfirmationError
          && error.message === "ADMIN_LOGOUT_CONFIRMATION_FAILED",
      );
    });
  }
});

test("repeated clicks share one server revocation and allow retry after settlement", async () => {
  const { requestAdminLogout } = await loadSubject();
  let calls = 0;
  let release;
  const body = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, status: 200, json: () => body };
  };

  const first = requestAdminLogout({ fetchImpl, timeoutMs: 100 });
  const second = requestAdminLogout({ fetchImpl, timeoutMs: 100 });
  assert.equal(calls, 1);
  release({ code: 0, message: "OK", data: null });
  await Promise.all([first, second]);
  assert.equal(calls, 1);

  await requestAdminLogout({
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ code: 0, data: null }), { status: 200 });
    },
    timeoutMs: 100,
  });
  assert.equal(calls, 2, "a settled request must not poison a later retry");
});
