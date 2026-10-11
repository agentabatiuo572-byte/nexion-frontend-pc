import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextResponse } = require("next/server");
const root = new URL("../", import.meta.url);
const compiled = new Map();
const SESSION = { adminId: 11, username: "fixture-admin", passwordChangeRequired: false };
function load(path, { env = {}, imports = {}, fetchImpl } = {}) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const exports = {};
  new Function("require", "exports", "process", "fetch", compiled.get(path))((id) => {
    assert.ok(Object.hasOwn(imports, id), `unexpected fixture import ${id}`);
    return imports[id];
  }, exports, { env }, fetchImpl);
  return exports;
}
function harness(path, { disabled, namespace, entries = {}, upstream = async () => Response.json({ code: 0,
  data: path === "session" ? { ...SESSION, idleTimeoutDisabled: disabled }
    : { accessToken: "issued-fixture", session: { ...SESSION, idleTimeoutDisabled: disabled } },
}), timeoutMs = 100 } = {}) {
  const env = { NEXION_BACKEND_URL: "http://backend.invalid",
    ...(namespace === undefined ? {} : { NEXION_ADMIN_COOKIE_NAMESPACE: namespace }),
  };
  const guard = load("lib/admin/require-password-change-cleared.ts", { env });
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return upstream(url, init); };
  const imports = {
    "next/headers": { cookies: async () => ({ get: (name) => entries[name] ? { value: entries[name] } : undefined }) },
    "next/server": { NextResponse },
    "@/lib/admin/require-password-change-cleared": guard,
    "@/lib/admin/auth-deadline": { ...load("lib/admin/auth-deadline.ts", { fetchImpl }), ADMIN_AUTH_UPSTREAM_TIMEOUT_MS: timeoutMs },
  };
  return { guard, calls, route: load(`app/api/admin/auth/${path}/route.ts`, { env, imports, fetchImpl }) };
}
function request(path, body, headers = {}, url = "https://console.invalid") {
  return new Request(`${url}/api/admin/auth/${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function checkCookie(response, name, maxAge, secure = true) {
  const cookie = response.cookies.get(name);
  assert.ok(cookie, "expected cookie is present");
  assert.equal(cookie.maxAge, maxAge);
  assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, "strict");
  assert.equal(cookie.path, "/"); assert.equal(cookie.secure, secure);
  const header = response.headers.get("set-cookie")?.split(/,\s*(?=[^;,\s]+=)/).find((part) => part.startsWith(`${name}=`));
  assert.ok(header, "expected response header cookie is present");
  if (maxAge === undefined) {
    assert.equal(cookie.expires, undefined);
    assert.doesNotMatch(header, /(?:^|;)\s*(?:Max-Age|Expires)=/i);
  } else {
    assert.match(header, new RegExp(`(?:^|;)\\s*Max-Age=${maxAge}(?:;|$)`, "i"));
    if (maxAge > 0) assert.ok(cookie.expires instanceof Date);
  }
}

test("only the strict authenticated session flag disables the normal admin cookie deadline", () => {
  const guard = load("lib/admin/require-password-change-cleared.ts", { env: { NEXION_ADMIN_SESSION_IDLE_DISABLED: "true" } });
  for (const disabled of [undefined, false, "false", "true", "TRUE", 1, "", null, {}, true]) {
    assert.equal(guard.adminSessionCookieMaxAge({ idleTimeoutDisabled: disabled }), disabled === true ? undefined : 3600);
    assert.equal(guard.ADMIN_TOKEN_MAX_AGE_SECONDS, 3600, "restricted credential deadline stays fixed");
  }
  for (const unknown of [undefined, null, "true", 1, [], {}]) assert.equal(guard.adminSessionCookieMaxAge(unknown), 3600);
});

test("real login, MFA and password-change handlers share both modes while restricted issuance remains unchanged", async () => {
  const bodies = { login: { username: "fixture", password: "fixture" }, "mfa/verify": { challengeId: "fixture", code: "123456" },
    "password/change": { currentPassword: "fixture", newPassword: "fixture-next" } };
  for (const disabled of [false, true]) for (const namespace of [undefined, "preview_a"]) {
    const own = harness("session", { namespace }).guard;
    for (const [path, body] of Object.entries(bodies)) for (const restricted of [false, true]) {
      const fixture = harness(path, { disabled, namespace,
        entries: { [own.ADMIN_TOKEN_COOKIE]: "old-fixture", [own.ADMIN_PASSWORD_CHANGE_COOKIE]: "restricted-fixture" },
        upstream: async () => Response.json({ code: 0, data: { accessToken: "issued-fixture",
          session: { ...SESSION, idleTimeoutDisabled: disabled, passwordChangeRequired: restricted } } }),
      });
      const response = await fixture.route.POST(request(path, body));
      assert.equal(response.status, 200); assert.equal(fixture.calls.length, 1);
      checkCookie(response, own.ADMIN_TOKEN_COOKIE, restricted ? 0 : disabled === true ? undefined : 3600);
      checkCookie(response, own.ADMIN_PASSWORD_CHANGE_COOKIE, restricted ? 3600 : 0);
      assert.ok(response.cookies.get(own.ADMIN_TOKEN_COOKIE).value === (restricted ? "" : "issued-fixture"), "full cookie preserves privilege");
      assert.ok(response.cookies.get(own.ADMIN_PASSWORD_CHANGE_COOKIE).value === (restricted ? "issued-fixture" : ""), "restricted cookie preserves privilege");
      assert.deepEqual(response.cookies.getAll().map(({ name }) => name).sort(), [own.ADMIN_TOKEN_COOKIE, own.ADMIN_PASSWORD_CHANGE_COOKIE].sort());
      assert.equal(Object.hasOwn((await response.json()).data, "accessToken"), false);
    }
  }
});

test("real activity handler uses the same normal cookie policy without changing identity or secure checks", async () => {
  for (const disabled of [false, true]) for (const [url, headers, secure] of [
    ["http://console.invalid", {}, false], ["http://console.invalid", { "x-forwarded-proto": "https, http" }, true],
    ["https://console.invalid", { "x-forwarded-proto": "http" }, false],
  ]) {
    const fixture = harness("activity", { disabled, entries: { nexion_admin_token: "old-fixture" } });
    const response = await fixture.route.POST(request("activity", { expectedAdminId: 11 }, headers, url));
    assert.equal(response.status, 200); assert.equal(fixture.calls.length, 1);
    assert.deepEqual(JSON.parse(fixture.calls[0].init.body), { expectedAdminId: 11 });
    checkCookie(response, fixture.guard.ADMIN_TOKEN_COOKIE, disabled === true ? undefined : 3600, secure);
    assert.equal(Object.hasOwn((await response.json()).data, "accessToken"), false);
  }
});

test("both modes keep session GET cookie-free while returning the backend marker in its own namespace", async () => {
  for (const disabled of [undefined, false, true]) for (const namespace of [undefined, "preview_a"]) for (const [url, headers] of [
    ["https://console.invalid", {}], ["http://console.invalid", {}],
    ["http://console.invalid", { "x-forwarded-proto": "https, http" }],
  ]) {
    const own = harness("session", { namespace }).guard;
    const fixture = harness("session", { disabled, namespace,
      entries: { [own.ADMIN_TOKEN_COOKIE]: "verified-existing-fixture", nexion_admin_token__foreign: "foreign-fixture" } });
    const response = await fixture.route.GET(request("session", undefined, headers, url));
    assert.equal(response.status, 200); assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].url, "http://backend.invalid/api/admin/auth/me");
    assert.equal(fixture.calls[0].init.method, undefined, "session GET is a read, never activity");
    assert.ok(new Headers(fixture.calls[0].init.headers).get("Authorization") === "Bearer verified-existing-fixture", "same credential is validated");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(response.cookies.getAll(), []);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const expectedSession = disabled === undefined ? SESSION : { ...SESSION, idleTimeoutDisabled: disabled };
    assert.deepEqual((await response.json()).data, { tokenType: "Bearer", session: expectedSession });
  }
});

test("default session GET never writes or extends the old cookie", async () => {
  for (const disabled of [undefined, false]) {
    const fixture = harness("session", { disabled, entries: { nexion_admin_token: "old-expiring-fixture" } });
    const response = await fixture.route.GET(request("session"));
    assert.equal(response.status, 200); assert.equal(fixture.calls.length, 1);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("missing, false and invalid upstream flags keep the default deadline despite caller-supplied flags", async () => {
  for (const disabled of [undefined, false, "true", 1, null, {}, []]) {
    const login = harness("login", { disabled });
    const response = await login.route.POST(request("login", { username: "fixture", password: "fixture", idleTimeoutDisabled: true },
      { "x-nexion-admin-session-idle-disabled": "true" }));
    assert.equal(response.status, 200); checkCookie(response, login.guard.ADMIN_TOKEN_COOKIE, 3600);
    assert.deepEqual(JSON.parse(login.calls[0].init.body), { username: "fixture", password: "fixture" });
    const session = harness("session", { disabled, entries: { nexion_admin_token: "old-fixture" } });
    const read = await session.route.GET(request("session", undefined, { "x-nexion-admin-session-idle-disabled": "true" }));
    assert.equal(read.status, 200); assert.equal(read.headers.get("set-cookie"), null);
  }
});

test("anonymous and foreign session GET cannot fetch, and password-restricted GET remains cookie-free in both modes", async () => {
  for (const disabled of [false, true]) for (const entries of [{}, { nexion_admin_token__foreign: "foreign-fixture" }, { nexion_admin_pwd_change_token: "restricted-fixture" }]) {
    const fixture = harness("session", { disabled, entries });
    const response = await fixture.route.GET(request("session"));
    assert.equal(response.status, 401); assert.equal(fixture.calls.length, 0);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  for (const disabled of [false, true]) for (const [entries, session] of [
    [{ nexion_admin_token: "full-fixture", nexion_admin_pwd_change_token: "restricted-fixture" }, { ...SESSION, idleTimeoutDisabled: disabled }],
    [{ nexion_admin_token: "full-fixture" }, { ...SESSION, idleTimeoutDisabled: disabled, passwordChangeRequired: true }],
    [{ nexion_admin_token: "full-fixture" }, { ...SESSION, idleTimeoutDisabled: disabled, passwordChangeRequired: "required" }],
  ]) {
    const fixture = harness("session", { disabled, entries, upstream: async () => Response.json({ code: 0, data: session }) });
    const response = await fixture.route.GET(request("session"));
    assert.equal(response.status, 200); assert.equal(fixture.calls.length, 1);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("failed, unavailable, malformed or unknown-identity session GET remains cookie-free in both modes", async () => {
  for (const disabled of [false, true]) {
    const failures = [
      ...[401, 403, 503].map((status) => async () => Response.json({ code: status }, { status })),
      async () => Response.json({ code: 401, data: SESSION }),
      async () => new Response("not-json"),
      async () => { throw new Error("fixture-disconnect"); },
      ...[null, 7, [], "success", {}, { code: "0", data: SESSION }, { code: 0.5, data: SESSION }].map((value) => async () => Response.json(value)),
      ...[{}, [], true, "unknown", { adminId: "11" }, { adminId: 0 }, { adminId: -1 }, { adminId: 1.5 },
        { adminId: Number.MAX_SAFE_INTEGER + 1 }].map((data) => async () => Response.json({ code: 0,
          data: data && typeof data === "object" && !Array.isArray(data) ? { ...data, idleTimeoutDisabled: disabled } : data })),
    ];
    for (const upstream of failures) {
      const fixture = harness("session", { disabled, entries: { nexion_admin_token: "old-fixture" }, upstream });
      const response = await fixture.route.GET(request("session"));
      assert.equal(fixture.calls.length, 1); assert.equal(response.headers.get("set-cookie"), null);
    }
    const fixture = harness("session", { disabled, entries: { nexion_admin_token: "old-fixture" }, timeoutMs: 5,
      upstream: async (_url, init) => ({ text: () => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      }) }),
    });
    const response = await fixture.route.GET(request("session"));
    assert.equal(response.status, 503); assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("both cookie modes preserve explicit logout clearing and failed revocation retains the retry credential", async () => {
  for (const disabled of [false, true]) for (const status of [200, 401, 503]) {
    const fixture = harness("logout", { disabled, entries: { nexion_admin_token: "old-fixture" },
      upstream: async () => Response.json({ code: status === 200 ? 0 : status }, { status }) });
    const response = await fixture.route.POST(request("logout", {}));
    if (status === 503) {
      assert.equal(response.status, 503); assert.equal(response.headers.get("set-cookie"), null);
    } else {
      assert.equal(response.status, 200);
      for (const name of [fixture.guard.ADMIN_TOKEN_COOKIE, fixture.guard.ADMIN_PASSWORD_CHANGE_COOKIE]) {
        checkCookie(response, name, 0);
        assert.ok(response.cookies.get(name).value === "", "logout clears the credential");
      }
    }
  }
});
