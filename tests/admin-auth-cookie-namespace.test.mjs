import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const require = createRequire(import.meta.url);
const { NextResponse } = require("next/server");
const { RequestCookies } = require("next/dist/compiled/@edge-runtime/cookies");
const compiled = new Map();
function load(path, { env = {}, imports = {}, fetchImpl = async () => { throw new Error("UNEXPECTED_FIXTURE_FETCH"); } } = {}) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const exports = {};
  new Function("require", "exports", "process", "fetch", compiled.get(path))((id) => {
    assert.ok(Object.hasOwn(imports, id), `unexpected import: ${id}`);
    return imports[id];
  }, exports, { env }, fetchImpl);
  return exports;
}
const names = (namespace) => load("lib/admin/require-password-change-cleared.ts", {
  env: namespace === undefined ? {} : { NEXION_ADMIN_COOKIE_NAMESPACE: namespace },
});
const jar = (entries) => ({ get: (name) => Object.hasOwn(entries, name) ? { value: entries[name] } : undefined });
const NAMESPACES = [undefined, "preview_a", "preview_b"];
const foreignEntries = (own) => Object.fromEntries(NAMESPACES.map(names)
  .filter((other) => other.ADMIN_TOKEN_COOKIE !== own.ADMIN_TOKEN_COOKIE)
  .flatMap((other) => [[other.ADMIN_TOKEN_COOKIE, "foreign-full-fixture"], [other.ADMIN_PASSWORD_CHANGE_COOKIE, "foreign-restricted-fixture"]]));

function gateway(path, namespace, entries = {}, upstream = async () => Response.json({ code: 0, data: { assetId: "fixture" } })) {
  const guard = names(namespace);
  const env = { NEXION_BACKEND_URL: "http://backend.fixture", ...(namespace === undefined ? {} : { NEXION_ADMIN_COOKIE_NAMESPACE: namespace }) };
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return upstream(url, init); };
  const route = load(`app/api/admin/${path}`, { env, fetchImpl, imports: {
    "next/headers": { cookies: async () => jar(entries) },
    "next/server": { NextResponse },
    "@/lib/admin/require-password-change-cleared": guard,
    "@/lib/admin/auth-deadline": load("lib/admin/auth-deadline.ts", { fetchImpl }),
    "@/lib/admin/support-image-proxy": load("lib/admin/support-image-proxy.ts"),
  } });
  return { route, guard, calls };
}
function request(method = "GET", body, url = "http://127.0.0.1:33041/api/admin/fixture", headers = {}) {
  return new Request(url, { method, headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const AUTH = ["login", "mfa/verify", "password/change", "logout", "session"];
const BUSINESS = {
  "bi/[...path]/route.ts": ["overview"],
  "bills/[[...path]]/route.ts": [],
  "config/[...path]/route.ts": { GET: ["task-pricing"], PUT: ["task-pricing"], POST: ["phone-calibration", "preview"] },
  "content/[...path]/route.ts": ["conversations"],
  "content/conversations/stream/route.ts": [],
  "developer/[...path]/route.ts": ["docs"],
  "devices/[...path]/route.ts": ["overview"],
  "devices/route.ts": [],
  "e1/[...path]/route.ts": ["generation-gates"],
  "emergency/[...path]/route.ts": ["kill-switches"],
  "finance/[...path]/route.ts": ["withdrawals"],
  "funnel/[[...path]]/route.ts": [],
  "growth/[...path]/route.ts": ["phases"],
  "janus/[...path]/route.ts": { GET: ["dashboard"], POST: ["strategies"], PUT: ["strategies", "fixture"], DELETE: ["strategies", "fixture"] },
  "legal-terms/[...path]/route.ts": ["list"],
  "market/[...path]/route.ts": ["staking"],
  "media/[...path]/route.ts": ["uploads", "fixture", "preview-url"],
  "phase/[[...path]]/route.ts": ["overview"],
  "platform/[...path]/route.ts": ["accounts"],
  "regulatory/[[...path]]/route.ts": ["options"],
  "risk/[...path]/route.ts": ["overview"],
  "teams/[...path]/route.ts": ["ranks"],
  "treasury/[...path]/route.ts": ["overview"],
  "users/[...path]/route.ts": ["overview"],
  "withdraw/[[...path]]/route.ts": ["limits"],
};

test("default names stay compatible; distinct namespaces and cookie types cannot collide", () => {
  assert.equal(names().ADMIN_TOKEN_COOKIE, "nexion_admin_token");
  assert.equal(names().ADMIN_PASSWORD_CHANGE_COOKIE, "nexion_admin_pwd_change_token");
  const all = [undefined, "preview_a", "preview_b", "preview_a_pwd_change"].map(names)
    .flatMap((guard) => [guard.ADMIN_TOKEN_COOKIE, guard.ADMIN_PASSWORD_CHANGE_COOKIE]);
  assert.equal(new Set(all).size, all.length);
  assert.equal(names("preview_a").ADMIN_TOKEN_COOKIE, "nexion_admin_token__preview_a");
});

test("explicit empty or invalid config fails closed without echoing the supplied value", () => {
  for (const invalid of ["", " ", "UPPER", "a/b", "a;b", "a=b", "a\r\nb", "a".repeat(33), "-a", "_a"]) {
    assert.throws(() => names(invalid), { message: "ADMIN_COOKIE_NAMESPACE_INVALID" });
  }
  assert.ok(names("a_1-b"));
});

test("server config is evaluated at module load and is not a Next public/static env value", () => {
  const env = { NEXION_ADMIN_COOKIE_NAMESPACE: "preview_a" };
  const loaded = load("lib/admin/require-password-change-cleared.ts", { env });
  env.NEXION_ADMIN_COOKIE_NAMESPACE = "preview_b";
  assert.equal(loaded.ADMIN_TOKEN_COOKIE, "nexion_admin_token__preview_a");
  assert.equal(load("lib/admin/require-password-change-cleared.ts", { env }).ADMIN_TOKEN_COOKIE, "nexion_admin_token__preview_b");
  const nextEnv = load("node_modules/next/dist/lib/static-env.js", { env }).getStaticEnv({ env: {} }, "fixture");
  assert.equal(Object.hasOwn(nextEnv, "process.env.NEXION_ADMIN_COOKIE_NAMESPACE"), false);
});

test("every cookie route imports the shared name and the complete expected route set remains present", () => {
  const paths = readdirSync(join(ROOT, "app/api/admin"), { recursive: true })
    .map((path) => path.replace(/\\/g, "/")).filter((path) => path.endsWith("route.ts"))
    .filter((path) => /next\/headers|response\.cookies/.test(read(`app/api/admin/${path}`))).sort();
  assert.deepEqual(paths, [...Object.keys(BUSINESS), ...AUTH.map((path) => `auth/${path}/route.ts`)].sort());
  for (const path of paths) {
    const source = read(`app/api/admin/${path}`);
    assert.match(source, /import \{[^}]*ADMIN_TOKEN_COOKIE[^}]*\} from "@\/lib\/admin\/require-password-change-cleared"/, path);
    assert.doesNotMatch(source, /["']nexion_admin_(?:token|pwd_change_token)["']/, path);
    assert.doesNotMatch(source, /(?:const|let|var)\s+ADMIN_TOKEN_COOKIE\s*=/, path);
  }
});

test("every real business handler rejects foreign cookies, preserves its guard, and forwards only its own full token", async () => {
  for (const namespace of NAMESPACES) for (const [path, sample] of Object.entries(BUSINESS)) {
    const own = names(namespace);
    const foreign = foreignEntries(own);
    const methods = Object.keys(gateway(path, namespace).route).filter((method) => /^(GET|HEAD|POST|PATCH|PUT|DELETE)$/.test(method));
    assert.ok(methods.length, path);
    for (const method of methods) {
      const context = { params: Promise.resolve({ path: Array.isArray(sample) ? sample : sample[method] }) };
      for (const [entries, status] of [
        [foreign, 401],
        [{ ...foreign, [own.ADMIN_TOKEN_COOKIE]: "own-full-fixture" }, 200],
        [{ ...foreign, [own.ADMIN_PASSWORD_CHANGE_COOKIE]: "own-restricted-fixture" }, 403],
        [{ [own.ADMIN_TOKEN_COOKIE]: "own-full-fixture", [own.ADMIN_PASSWORD_CHANGE_COOKIE]: "own-restricted-fixture" }, 403],
      ]) {
        const fixture = gateway(path, namespace, entries);
        const response = await fixture.route[method](request(method), context);
        assert.equal(response.status, status, `${namespace ?? "default"} ${path} ${method}`);
        assert.equal(fixture.calls.length, status === 200 ? 1 : 0, `${path} must not forward denied requests`);
        if (status === 200) {
          assert.equal(new Headers(fixture.calls[0].init.headers).get("Authorization"), "Bearer own-full-fixture");
          if (path === "platform/[...path]/route.ts") assert.equal(fixture.calls[0].init.body, undefined, "empty commands must remain absent");
        }
        if (status === 403 && method !== "HEAD") assert.equal((await response.json()).message, "ADMIN_PASSWORD_CHANGE_REQUIRED");
      }
      for (const status of [401, 503]) {
        const fixture = gateway(path, namespace, { [own.ADMIN_TOKEN_COOKIE]: "own-full-fixture" }, async () => Response.json({ code: status }, { status }));
        assert.equal((await fixture.route[method](request(method), context)).status, status, `${path} upstream status must survive`);
      }
    }
  }
});

test("real auth issuers, session, password change and logout keep names, privilege, lifetime and revocation aligned", async () => {
  const bodies = { login: { username: "fixture", password: "fixture" }, "mfa/verify": { challengeId: "fixture", code: "123456" },
    "password/change": { currentPassword: "fixture-old", newPassword: "fixture-new" } };
  for (const namespace of NAMESPACES) {
    const own = names(namespace), foreign = foreignEntries(own);
    for (const [path, body] of Object.entries(bodies)) for (const restricted of [false, true]) for (const secure of [false, true]) {
      const fixture = gateway(`auth/${path}/route.ts`, namespace, { ...foreign, [own.ADMIN_TOKEN_COOKIE]: "own-full-fixture", [own.ADMIN_PASSWORD_CHANGE_COOKIE]: "own-restricted-fixture" },
        async () => Response.json({ code: 0, data: { accessToken: "issued-fixture", session: { passwordChangeRequired: restricted } } }));
      const response = await fixture.route.POST(request("POST", body, undefined, secure ? { "x-forwarded-proto": "https" } : {}));
      assert.equal(response.status, 200, path);
      assert.deepEqual(response.cookies.getAll().map((cookie) => cookie.name).sort(), [own.ADMIN_TOKEN_COOKIE, own.ADMIN_PASSWORD_CHANGE_COOKIE].sort());
      for (const [name, active] of [[own.ADMIN_TOKEN_COOKIE, !restricted], [own.ADMIN_PASSWORD_CHANGE_COOKIE, restricted]]) {
        const cookie = response.cookies.get(name);
        assert.equal(cookie.value, active ? "issued-fixture" : "");
        assert.equal(cookie.maxAge, active ? 8 * 60 * 60 : 0);
        assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, "strict"); assert.equal(cookie.path, "/"); assert.equal(cookie.secure, secure);
      }
      if (path === "password/change") assert.equal(new Headers(fixture.calls[0].init.headers).get("Authorization"), "Bearer own-restricted-fixture");
    }
    const missingSession = gateway("auth/session/route.ts", namespace, foreign);
    assert.equal((await missingSession.route.GET()).status, 401); assert.equal(missingSession.calls.length, 0);
    const session = gateway("auth/session/route.ts", namespace, { ...foreign, [own.ADMIN_TOKEN_COOKIE]: "own-full-fixture" });
    assert.equal((await session.route.GET()).status, 200); assert.equal(new Headers(session.calls[0].init.headers).get("Authorization"), "Bearer own-full-fixture");
    const missingChange = gateway("auth/password/change/route.ts", namespace, foreign);
    assert.equal((await missingChange.route.POST(request("POST", bodies["password/change"]))).status, 401); assert.equal(missingChange.calls.length, 0);
    for (const entries of [foreign, { ...foreign, [own.ADMIN_TOKEN_COOKIE]: "own-full-fixture", [own.ADMIN_PASSWORD_CHANGE_COOKIE]: "own-restricted-fixture" }]) {
      const logout = gateway("auth/logout/route.ts", namespace, entries);
      const response = await logout.route.POST(request("POST"));
      assert.equal(response.status, 200);
      assert.deepEqual(response.cookies.getAll().map((cookie) => cookie.name).sort(), [own.ADMIN_TOKEN_COOKIE, own.ADMIN_PASSWORD_CHANGE_COOKIE].sort());
      assert.ok(response.cookies.getAll().every((cookie) => cookie.value === "" && cookie.maxAge === 0));
      assert.equal(logout.calls.length, entries === foreign ? 0 : 1);
      if (logout.calls.length) assert.equal(new Headers(logout.calls[0].init.headers).get("Authorization"), "Bearer own-restricted-fixture");
    }
    const failedLogout = gateway("auth/logout/route.ts", namespace, { [own.ADMIN_TOKEN_COOKIE]: "own-full-fixture" }, async () => { throw new Error("fixture unavailable"); });
    const failed = await failedLogout.route.POST(request("POST"));
    assert.equal(failed.status, 503); assert.equal(failed.headers.get("Set-Cookie"), null);
  }
});

test("offline Chromium keeps legacy and two preview logins across reload and clears only the matching login", { timeout: 30_000 }, async () => {
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const origins = ["http://127.0.0.1:33029", "http://127.0.0.1:33041", "http://127.0.0.1:33042"];
    await context.route("**/*", async (route) => {
      const incoming = route.request(), url = new URL(incoming.url());
      const index = origins.indexOf(url.origin);
      if (index < 0) return route.abort();
      if (!url.pathname.startsWith("/api/admin/auth/")) return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Offline cookie fixture</title>" });
      const path = url.pathname.replace("/api/admin/", "") + "/route.ts";
      const incomingCookies = new RequestCookies(new Headers(await incoming.allHeaders()));
      const entries = Object.fromEntries(incomingCookies.getAll().map((cookie) => [cookie.name, cookie.value]));
      const fixture = gateway(path, NAMESPACES[index], entries, async (target, init) => {
        if (target.endsWith("/me")) return Response.json({ code: 0, data: { actor: "fixture" } });
        if (target.endsWith("/logout")) return Response.json({ code: 0 });
        const restricted = target.endsWith("/login") && JSON.parse(init.body).username === "restricted-fixture";
        return Response.json({ code: 0, data: { accessToken: `fixture-${index}`, session: { passwordChangeRequired: restricted } } });
      });
      const response = await fixture.route[incoming.method()](new Request(incoming.url(), {
        method: incoming.method(), headers: await incoming.allHeaders(), ...(incoming.postData() ? { body: incoming.postData() } : {}),
      }));
      const headers = Object.fromEntries(response.headers);
      if (response.headers.getSetCookie().length) headers["set-cookie"] = response.headers.getSetCookie().join("\n");
      delete headers["x-middleware-set-cookie"];
      await route.fulfill({ status: response.status, headers, body: await response.text() });
    });
    const pages = await Promise.all(origins.map(() => context.newPage()));
    const call = (page, path, body) => page.evaluate(async ({ path, body }) => {
      const response = await fetch(`/api/admin/auth/${path}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return response.status;
    }, { path, body });
    for (const [index, page] of pages.entries()) {
      await page.goto(origins[index]);
      assert.equal(await call(page, "login", { username: "fixture", password: "fixture" }), 200);
    }
    for (const page of pages) { await page.reload(); assert.equal(await call(page, "session"), 200); }
    assert.equal((await context.cookies()).filter((cookie) => cookie.name.startsWith("nexion_admin_token")).length, 3);
    assert.equal(await call(pages[0], "logout", {}), 200);
    assert.equal(await call(pages[0], "session"), 401);
    for (const page of pages.slice(1)) { await page.reload(); assert.equal(await call(page, "session"), 200); }
    assert.equal(await call(pages[1], "logout", {}), 200);
    assert.equal(await call(pages[1], "session"), 401); assert.equal(await call(pages[2], "session"), 200);
    assert.equal(await call(pages[1], "login", { username: "restricted-fixture", password: "fixture" }), 200);
    await pages[1].reload();
    assert.equal(await call(pages[1], "session"), 401); assert.equal(await call(pages[2], "session"), 200);
    assert.ok((await context.cookies()).some((cookie) => cookie.name === names("preview_a").ADMIN_PASSWORD_CHANGE_COOKIE));
    assert.equal(await call(pages[1], "password/change", { currentPassword: "fixture-old", newPassword: "fixture-new" }), 200);
    await pages[1].reload();
    assert.equal(await call(pages[1], "session"), 200); assert.equal(await call(pages[2], "session"), 200);
    assert.ok(!(await context.cookies()).some((cookie) => cookie.name === names("preview_a").ADMIN_PASSWORD_CHANGE_COOKIE));
  } finally { await browser.close(); }
});
