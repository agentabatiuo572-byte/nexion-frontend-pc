import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(relative, require, fetch) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "fetch", "process", output)(require, exports, fetch,
    { env: { NEXION_BACKEND_URL: "http://upstream.fixture" } });
  return exports;
}

const guard = load("../lib/admin/require-password-change-cleared.ts", () => { throw new Error("Unexpected guard import"); });
const overview = { policy: { revision: 0, current: null, scheduled: null }, pendingHardware: [], computeUnit: "platform" };
function gateway({ entries = { nexion_admin_token: "fixture-token" }, upstream = async () => Response.json({ code: 0, data: overview }) } = {}) {
  const calls = [];
  const route = load("../app/api/admin/config/[...path]/route.ts", id => {
    if (id === "next/headers") return { cookies: async () => ({ get: name => entries[name] ? { value: entries[name] } : undefined }) };
    if (id.endsWith("require-password-change-cleared")) return guard;
    throw new Error(`Unexpected route import: ${id}`);
  }, async (url, init) => { calls.push({ url, init }); return upstream(url, init); });
  return {
    calls,
    request: async (path, method = "GET", body) => {
      assert.equal(typeof route[method], "function", `${method} must be reachable through the BFF`);
      return route[method](new Request(`http://pc.fixture/api/admin/config/${path}`, {
        method, ...(body === undefined ? {} : { body, headers: { "Content-Type": "application/json", "Idempotency-Key": "fixture-request" } }),
      }), { params: Promise.resolve({ path: path ? path.split("/") : [] }) });
    },
  };
}

test("the real phone client reads and previews through the authenticated config BFF", async () => {
  const preview = { expectedRevision: 0, match: { status: "MATCHED" },
    impact: { matched: 1, changed: 1, pending: 0, appliesTo: "NEXT_CALIBRATION", historicalSettlementChanged: false } };
  const fixture = gateway({ upstream: async url => Response.json({ code: 0, data: url.endsWith("/preview") ? preview : overview }) });
  const client = load("../lib/admin/phone-calibration-client.ts", id => {
    if (id.endsWith("error-messages")) return {
      formatAdminApiError: (message, fallback) => message || fallback,
      guardedFetch: (url, init) => fixture.request(url.replace("/api/admin/config/", ""), init.method, init.body),
    };
    throw new Error(`Unexpected client import: ${id}`);
  });
  const proposal = { expectedRevision: 0, effectiveAt: 0, thresholds: [19, 25, 35, 47], rules: [] };
  assert.deepEqual(await client.fetchPhoneCalibration(), overview);
  assert.deepEqual(await client.previewPhoneCalibration(proposal, { platform: "android", model: "fixture" }), preview);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[0].url, "http://upstream.fixture/api/admin/config/phone-calibration");
  assert.equal(fixture.calls[0].init.method, "GET");
  assert.equal(fixture.calls[0].init.body, undefined);
  assert.equal(fixture.calls[1].url, "http://upstream.fixture/api/admin/config/phone-calibration/preview");
  assert.equal(fixture.calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(fixture.calls[1].init.body).proposal, proposal);
  for (const { init } of fixture.calls) {
    assert.equal(init.headers.get("Authorization"), "Bearer fixture-token");
    assert.equal(init.cache, "no-store");
  }
  assert.equal(fixture.calls[1].init.headers.get("Content-Type"), "application/json");
  assert.equal(fixture.calls[1].init.headers.get("Idempotency-Key"), "fixture-request");
});

test("only the two phone route and method pairs are forwarded; existing config GET and PUT still work", async () => {
  const fixture = gateway();
  for (const path of ["task-pricing", "phone-tiers", "phone-tiers/comparison"]) {
    for (const method of ["GET", "PUT"]) assert.equal((await fixture.request(path, method)).status, 200);
    assert.equal((await fixture.request(path, "POST")).status, 405);
  }
  for (const [path, methods] of [["phone-calibration", ["POST", "PUT"]], ["phone-calibration/preview", ["GET", "PUT"]]]) {
    for (const method of methods) assert.equal((await fixture.request(path, method)).status, 405);
  }
  assert.equal(fixture.calls.length, 6, "rejected methods must not reach the backend");
});

test("unknown, publish and nested config paths remain unavailable for every exposed method", async () => {
  const fixture = gateway();
  for (const path of ["", "unknown", "phone-calibration/publish", "phone-calibration/preview/extra", "phone-calibration/../task-pricing"]) {
    for (const method of ["GET", "POST", "PUT"]) {
      const response = await fixture.request(path, method);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).message, "E2_CONFIG_ROUTE_NOT_FOUND");
    }
  }
  assert.equal(fixture.calls.length, 0);
});

test("phone read and preview preserve missing-session and actual password-change guards", async () => {
  for (const [entries, status, message] of [
    [{}, 401, "ADMIN_AUTH_REQUIRED"],
    [{ nexion_admin_pwd_change_token: "restricted-fixture" }, 403, "ADMIN_PASSWORD_CHANGE_REQUIRED"],
    [{ nexion_admin_token: "fixture-token", nexion_admin_pwd_change_token: "restricted-fixture" }, 403, "ADMIN_PASSWORD_CHANGE_REQUIRED"],
  ]) {
    const fixture = gateway({ entries });
    for (const [path, method] of [["phone-calibration", "GET"], ["phone-calibration/preview", "POST"]]) {
      const response = await fixture.request(path, method);
      assert.equal(response.status, status);
      assert.equal((await response.json()).message, message);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
    assert.equal(fixture.calls.length, 0);
  }
});

test("upstream authentication, permission, version and validation errors retain status and body", async () => {
  for (const [status, message] of [[401, "AUTH_REQUIRED"], [403, "ADMIN_PERMISSION_DENIED"],
    [409, "PHONE_CALIBRATION_VERSION_CONFLICT"], [422, "PHONE_CALIBRATION_POLICY_INVALID"], [503, "PHONE_CALIBRATION_CONFIG_UNAVAILABLE"]]) {
    const body = JSON.stringify({ code: status, message, data: null });
    const fixture = gateway({ upstream: async () => new Response(body, { status, headers: { "Content-Type": "application/json;charset=UTF-8" } }) });
    for (const [path, method] of [["phone-calibration", "GET"], ["phone-calibration/preview", "POST"]]) {
      const response = await fixture.request(path, method);
      assert.equal(response.status, status);
      assert.equal(await response.text(), body);
      assert.equal(response.headers.get("Content-Type"), "application/json;charset=UTF-8");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  }
});

test("a failed upstream request or body can be retried without caching the failure", async () => {
  for (const failure of [async () => { throw new Error("offline fixture"); },
    async () => ({ text: async () => { throw new Error("interrupted body fixture"); } })]) {
    let attempts = 0;
    const fixture = gateway({ upstream: async () => ++attempts === 1 ? failure() : Response.json({ code: 0, data: overview }) });
    const failed = await fixture.request("phone-calibration");
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).message, "E2_CONFIG_BACKEND_UNAVAILABLE");
    assert.equal(failed.headers.get("Cache-Control"), "no-store");
    assert.equal((await fixture.request("phone-calibration")).status, 200);
    assert.equal(fixture.calls.length, 2);
  }
});
