import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createAdminActivityTracker } from "../lib/admin/admin-activity.ts";
import { withAdminAuthCookieWrite } from "../lib/admin/auth-cookie-lane.ts";
import { withAdminAuthDeadline } from "../lib/admin/auth-deadline.ts";

const require = createRequire(import.meta.url);
const { NextResponse } = require("next/server");
const root = new URL("../", import.meta.url);
const input = (type = "pointerdown", isTrusted = true, key) => ({ type, isTrusted, key });
const tick = () => new Promise(setImmediate);
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
function load(path, { env = {}, imports = {}, fetchImpl } = {}) {
  const source = readFileSync(new URL(path, root), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", "process", "fetch", code)((id) => {
    assert.ok(Object.hasOwn(imports, id), `unexpected fixture import ${id}`);
    return imports[id];
  }, exports, { env }, fetchImpl);
  return exports;
}
function harness(entries = {}, upstream = async () => Response.json({ code: 0, data: {
  accessToken: "same-sid-fixture", tokenType: "Bearer", session: { adminId: 11, username: "fixture-admin" },
} }), { namespace, timeoutMs = 100 } = {}) {
  const env = { NEXION_BACKEND_URL: "http://backend.invalid", ...(namespace ? { NEXION_ADMIN_COOKIE_NAMESPACE: namespace } : {}) };
  const guard = load("lib/admin/require-password-change-cleared.ts", { env });
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return upstream(url, init); };
  const deadline = load("lib/admin/auth-deadline.ts", { fetchImpl });
  const imports = {
    "next/headers": { cookies: async () => ({ get: (name) => entries[name] ? { value: entries[name] } : undefined }) },
    "next/server": { NextResponse },
    "@/lib/admin/require-password-change-cleared": guard,
    "@/lib/admin/auth-deadline": { ...deadline, ADMIN_AUTH_UPSTREAM_TIMEOUT_MS: timeoutMs },
  };
  return { guard, calls, route: load("app/api/admin/auth/activity/route.ts", { env, imports, fetchImpl }),
    session: load("app/api/admin/auth/session/route.ts", { env, imports, fetchImpl }) };
}
const request = (...args) => new Request("http://console.invalid/api/admin/auth/activity", {
  method: "POST", headers: { "Content-Type": "application/json", ...(args[1] ?? {}) }, body: JSON.stringify({ expectedAdminId: args.length ? args[0] : 11 }),
});

test("only trusted visible intentional input triggers activity, with immediate first input", async () => {
  let calls = 0, visible = false;
  const tracker = createAdminActivityTracker({ touch: async () => { calls++; return true; }, eligible: () => visible });
  await tracker.input(input());
  visible = true;
  for (const type of ["focus", "mousemove", "visibilitychange", "pageshow", "popstate", "interval", "fetch", "message"]) await tracker.input(input(type));
  await tracker.input(input("pointerdown", false));
  await tracker.input(input("keydown", true, "Shift"));
  assert.equal(calls, 0);
  await tracker.input(input());
  assert.equal(calls, 1);
});

test("success-only throttle accepts near-idle input and continued work beyond eight hours without timer activity", async () => {
  let clock = 0, calls = 0;
  const tracker = createAdminActivityTracker({ touch: async () => { calls++; return true; }, eligible: () => true, now: () => clock });
  await tracker.input(input("touchstart"));
  clock = 59_999; await tracker.input(input("keydown", true, "Enter"));
  assert.equal(calls, 1);
  clock = 60_000; await tracker.input(input("wheel"));
  assert.equal(calls, 2);
  clock += 59 * 60_000 + 59_000;
  await tracker.input(input());
  assert.equal(calls, 3, "near 60 minutes must not be held by throttle");
  for (let i = 0; i < 9 * 60; i++) { clock += 60_000; await tracker.input(input("keydown", true, "ArrowDown")); }
  assert.equal(calls, 543);
  clock += 4 * 60 * 60_000;
  await tick();
  assert.equal(calls, 543, "elapsed time itself must never renew");
});

test("in-flight inputs coalesce, failure does not hold retry, and stop prevents queued old activity", async () => {
  let calls = 0; const first = deferred();
  const tracker = createAdminActivityTracker({ eligible: () => true, now: () => 1,
    touch: async () => { calls++; return calls === 1 ? first.promise : true; } });
  const pending = tracker.input(input());
  await tracker.input(input()); await tracker.input(input("wheel"));
  assert.equal(calls, 1);
  first.resolve(false); await pending;
  await tracker.input(input("keydown", true, "a"));
  assert.equal(calls, 2, "failed acknowledgement must not start a cooldown");
  tracker.stop(); await tracker.input(input());
  assert.equal(calls, 2);
});

test("fallback Cookie lane drains actual body settlement before any later credential write and recovers from rejection", async () => {
  const body = deferred(); const order = [];
  const first = withAdminAuthCookieWrite(async () => { order.push("activity-headers"); await body.promise; order.push("activity-body"); });
  const second = withAdminAuthCookieWrite(async () => { order.push("logout"); });
  await tick(); assert.deepEqual(order, ["activity-headers"]);
  body.resolve(); await Promise.all([first, second]);
  assert.deepEqual(order, ["activity-headers", "activity-body", "logout"]);
  await assert.rejects(withAdminAuthCookieWrite(async () => { throw Error("fixture-failure"); }));
  assert.equal(await withAdminAuthCookieWrite(async () => "next-login"), "next-login");
});

test("UI timeout cannot release the Cookie lane while an abort-ignoring native response still settles", async () => {
  const body = deferred(); let laterSent = false;
  await assert.rejects(withAdminAuthDeadline(() => withAdminAuthCookieWrite(() => body.promise), { timeoutMs: 5 }));
  const later = withAdminAuthCookieWrite(async () => { laterSent = true; });
  await tick(); assert.equal(laterSent, false);
  body.resolve(); await later;
  assert.equal(laterSent, true);
});

test("two tab-local lanes share the native origin lock through full responses", async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let tail = Promise.resolve(); const names = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {
    request(name, options, callback) { names.push([name, options.mode]); const pending = tail.then(callback); tail = pending.then(() => undefined, () => undefined); return pending; },
  } } });
  try {
    const a = await import("../lib/admin/auth-cookie-lane.ts?tab=a");
    const b = await import("../lib/admin/auth-cookie-lane.ts?tab=b");
    const body = deferred(); const order = [];
    const activity = a.withAdminAuthCookieWrite(async () => { order.push("A-activity"); await body.promise; order.push("A-body"); });
    const login = b.withAdminAuthCookieWrite(async () => { order.push("B-login"); });
    await tick(); assert.deepEqual(order, ["A-activity"]);
    body.resolve(); await Promise.all([activity, login]);
    assert.deepEqual(order, ["A-activity", "A-body", "B-login"]);
    assert.equal(names.length, 2); assert.ok(names.every(([name, mode]) => name === "nexion-admin-auth-cookie-write" && mode === "exclusive"));
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else delete globalThis.window;
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator); else delete globalThis.navigator;
  }
});

test("activity BFF renews only own namespace after validated success and never exposes the upgrade token", async () => {
  for (const namespace of [undefined, "preview_a"]) {
    const name = namespace ? "nexion_admin_token__preview_a" : "nexion_admin_token";
    const fixture = harness({ [name]: "legacy-fixture" }, undefined, { namespace });
    const response = await fixture.route.POST(request(11, { "x-forwarded-proto": "https" }));
    assert.equal(response.status, 200); assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].url, "http://backend.invalid/api/admin/auth/activity");
    assert.deepEqual(JSON.parse(fixture.calls[0].init.body), { expectedAdminId: 11 });
    assert.equal(new Headers(fixture.calls[0].init.headers).get("Authorization"), "Bearer legacy-fixture");
    const cookie = response.cookies.get(name);
    assert.equal(cookie.value, "same-sid-fixture"); assert.equal(cookie.maxAge, 3600);
    assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, "strict"); assert.equal(cookie.secure, true); assert.equal(cookie.path, "/");
    const payload = await response.json();
    assert.equal(payload.data.session.adminId, 11); assert.equal(Object.hasOwn(payload.data, "accessToken"), false);
    assert.equal(JSON.stringify(payload).includes("same-sid-fixture"), false);
  }
});

test("missing, foreign, restricted Cookies and invalid IDs refuse before upstream auth", async () => {
  for (const [entries, status] of [[{}, 401], [{ nexion_admin_token__foreign: "foreign-fixture" }, 401],
    [{ nexion_admin_token: "full", nexion_admin_pwd_change_token: "restricted" }, 403]]) {
    const fixture = harness(entries); const response = await fixture.route.POST(request());
    assert.equal(response.status, status); assert.equal(fixture.calls.length, 0); assert.equal(response.headers.get("set-cookie"), null);
  }
  for (const id of [undefined, null, "11", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const fixture = harness({ nexion_admin_token: "full" }); const response = await fixture.route.POST(request(id));
    assert.equal(response.status, 422); assert.equal(fixture.calls.length, 0); assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("401, 409 identity conflict, disabled, store failure, malformed success and missing authoritative fields cannot renew", async () => {
  const failures = [
    () => new Response("not-json", { status: 401 }),
    () => Response.json({ code: 409, message: "ADMIN_ACTIVITY_IDENTITY_MISMATCH", data: { accessToken: "must-not-escape" } }, { status: 409 }),
    () => Response.json({ code: 403, message: "ADMIN_DISABLED" }, { status: 403 }),
    () => Response.json({ code: 503, message: "ADMIN_SESSION_STORE_UNAVAILABLE" }, { status: 503 }),
    () => new Response("not-json", { status: 200 }),
    ...[{ session: { adminId: 11 } }, { accessToken: "token" }, { accessToken: "token", session: { adminId: 12 } },
      { accessToken: "token", session: { adminId: 11, passwordChangeRequired: true } }].map((data) => () => Response.json({ code: 0, data })),
  ];
  for (const upstream of failures) {
    const fixture = harness({ nexion_admin_token: "full" }, upstream); const response = await fixture.route.POST(request());
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await response.text()).includes("must-not-escape"), false);
  }
});

test("upstream body timeout is bounded, Cookie-free, and an ordinary session GET does not use activity", async () => {
  const fixture = harness({ nexion_admin_token: "full" }, async (_url, init) => ({ text: () => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }) }), { timeoutMs: 5 });
  const timedOut = await fixture.route.POST(request());
  assert.equal(timedOut.status, 503); assert.equal(timedOut.headers.get("set-cookie"), null);
  const read = harness({ nexion_admin_token: "full" }, async () => Response.json({ code: 0, data: { adminId: 11 } }));
  const session = await read.session.GET();
  assert.equal(session.status, 200); assert.equal(session.headers.get("set-cookie"), null);
  assert.equal(read.calls[0].url, "http://backend.invalid/api/admin/auth/me");
});

test("non-object or missing integer API codes fail closed before Cookie renewal", async () => {
  for (const value of [null, 7, [], "success", {}, { code: "0" }, { code: 0.5 }]) {
    const fixture = harness({ nexion_admin_token: "full" }, async () => Response.json(value));
    const response = await fixture.route.POST(request());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), { code: 503, message: "ADMIN_SESSION_UNAVAILABLE", data: null });
  }
});

test("old-tab expected ID reaches the backend after a new login and conflict preserves the new Cookie", async () => {
  const entries = { nexion_admin_token: "new-B-fixture" };
  const fixture = harness(entries, async (_url, init) => {
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer new-B-fixture");
    assert.equal(JSON.parse(init.body).expectedAdminId, 11);
    return Response.json({ code: 409, message: "ADMIN_ACTIVITY_IDENTITY_MISMATCH", data: null }, { status: 409 });
  });
  const response = await fixture.route.POST(request(11));
  assert.equal(response.status, 409); assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(entries.nexion_admin_token, "new-B-fixture");
});
