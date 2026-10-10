import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(process.env.B4_FE_ROOT || root, "package.json"));
const ts = require("typescript");

function load(relative, dependencies = {}, globals = {}) {
  const compiled = ts.transpileModule(readFileSync(path.join(root, relative), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports,
    require: (name) => {
      assert.ok(name in dependencies, `unexpected dependency: ${name}`);
      return dependencies[name];
    },
    URLSearchParams, ...globals,
  }, { filename: relative });
  return module.exports;
}

const errors = load("lib/admin/error-messages.ts", {}, {
  fetch: (...args) => globalThis.fetch(...args),
});
const auth = load("lib/admin/auth-session.ts", {
  "./auth-lifecycle.ts": { beginAdminLogout() { throw new Error("unexpected logout"); } },
  "./logout-request.ts": { requestAdminLogout() { throw new Error("unexpected logout"); } },
});
const filters = { granularity: "MONTH", month: "3", phase: "P2" };

function client() {
  let resets = 0;
  const exports = load("lib/admin/b4-client.ts", {
    react: {},
    "@/lib/admin/auth-session": { ...auth, resetAdminSession() { resets++; } },
    "@/lib/admin/error-messages": errors,
    "@/lib/admin/b34-overview-contract": {},
  });
  return { ...exports, resets: () => resets };
}

function respond(t, response) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => { requests.push({ url, init }); return response; };
  t.after(() => { globalThis.fetch = original; });
  const readBlob = response.blob.bind(response);
  let blobs = 0;
  response.blob = () => { blobs++; return readBlob(); };
  return { requests, blobs: () => blobs };
}

for (const [code, message] of [[403, "无权限访问"], [500, "INTERNAL_SERVER_ERROR"]]) {
  test(`HTTP 200 JSON failure ${code} rejects before producing a download`, async (t) => {
    const response = new Response(JSON.stringify({ code, message, data: null }), {
      status: 200, headers: { "Content-Type": "application/json; charset=UTF-8" },
    });
    const observed = respond(t, response);
    const api = client();
    await assert.rejects(api.exportB4Distribution(filters), { message: errors.formatAdminApiError(message, "B4_EXPORT_FAILED") });
    assert.equal(observed.blobs(), 0);
    assert.equal(api.resets(), 0, "permission/query failure must preserve the authenticated session");
  });
}

test("HTTP 200 JSON 401 uses the existing auth reset and never returns a blob", async (t) => {
  const response = new Response(JSON.stringify({ code: 401, message: "UNAUTHORIZED", data: null }), {
    headers: { "Content-Type": "application/json" },
  });
  const observed = respond(t, response);
  const api = client();
  await assert.rejects(api.exportB4Distribution(filters));
  assert.equal(api.resets(), 1);
  assert.equal(observed.blobs(), 0);
});

test("CSV preserves bytes, scoped query, no-store and both existing filename forms", async (t) => {
  const csv = "\ufeffphase,userCount\r\nP2,12\r\n";
  for (const [disposition, filename] of [
    ['attachment; filename="b4-phases-20261010.csv"', "b4-phases-20261010.csv"],
    ["attachment; filename*=UTF-8''%E9%98%B6%E6%AE%B5.csv", "阶段.csv"],
    ["", "b4-phase-distribution.csv"],
  ]) {
    const response = new Response(csv, { headers: { "Content-Type": "text/csv; charset=UTF-8", "Content-Disposition": disposition } });
    const observed = respond(t, response);
    const result = await client().exportB4Distribution(filters);
    assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), new TextEncoder().encode(csv));
    assert.equal(result.fileName, filename);
    assert.equal(observed.blobs(), 1);
    assert.equal(observed.requests[0].url, "/api/admin/phase/distribution/export?granularity=MONTH&month=3&phase=P2");
    assert.equal(observed.requests[0].init.cache, "no-store");
  }
});

test("non-success HTTP retains its original error copy and auth-reset behavior", async (t) => {
  for (const [status, message] of [[401, "ADMIN_AUTH_REQUIRED"], [403, "无权限访问"], [503, "B4_PHASE_UNAVAILABLE"]]) {
    const response = new Response(JSON.stringify({ code: status, message, data: null }), {
      status, headers: { "Content-Type": "application/json" },
    });
    const observed = respond(t, response);
    const api = client();
    await assert.rejects(api.exportB4Distribution(filters), { message: errors.formatAdminApiError(message, "B4_EXPORT_FAILED") });
    assert.equal(api.resets(), status === 401 ? 1 : 0);
    assert.equal(observed.blobs(), 0);
  }
});

test("malformed JSON, JSON success and HTML cannot be relabelled as CSV", async (t) => {
  for (const [body, type] of [["{", "application/json"], ['{"code":0,"message":"OK","data":{}}', "application/json"], ["<html>gateway error</html>", "text/html"]]) {
    const response = new Response(body, { headers: { "Content-Type": type } });
    const observed = respond(t, response);
    await assert.rejects(client().exportB4Distribution(filters));
    assert.equal(observed.blobs(), 0);
  }
});

test("a JSON failure permits an explicit later CSV retry with the same filters", async (t) => {
  const response = new Response('{"code":500,"message":"INTERNAL_SERVER_ERROR"}', { headers: { "Content-Type": "application/json" } });
  const observed = respond(t, response);
  const api = client();
  await assert.rejects(api.exportB4Distribution(filters));
  globalThis.fetch = async (url, init) => {
    observed.requests.push({ url, init });
    return new Response("phase,userCount\r\nP2,12\r\n", { headers: { "Content-Type": "text/csv" } });
  };
  const result = await api.exportB4Distribution(filters);
  assert.match(await result.blob.text(), /P2,12/);
  assert.equal(observed.requests.length, 2, "the client must not automatically replay the export");
  assert.deepEqual(observed.requests[0], observed.requests[1]);
});

test("network failure keeps the existing recovery copy and permits a later retry", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const api = client();
  await assert.rejects(api.exportB4Distribution(filters), /网络连接失败或后台服务不可达/);
  globalThis.fetch = async () => new Response("phase,userCount\r\nP2,12\r\n", { headers: { "Content-Type": "text/csv" } });
  assert.match(await (await api.exportB4Distribution(filters)).blob.text(), /P2,12/);
  assert.equal(api.resets(), 0);
});
